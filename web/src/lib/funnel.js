import { CHANNELS, PRIORITY, STAGES } from "./constants.js";

const mojibakeRules = [
  [/通�+词/g, "通用词"],
  [/�+用词/g, "通用词"],
  [/通用�+(?=-)/g, "通用词"],
  [/�+牌词/g, "品牌词"],
  [/竞�+词/g, "竞品词"],
  [/�+南-/g, "越南-"],
  [/越�+-/g, "越南-"],
  [/�+马泰新印/g, "越马泰新印"],
  [/�+澳台/g, "港澳台"],
  [/�+度-/g, "印度-"],
  [/�+加坡/g, "新加坡"],
];

export function normalizeUin(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\.0$/, "");
}

export function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

export function normalizeSqlValue(value) {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  return text.toUpperCase() === "NULL" ? null : value;
}

export function classifyStageFile(fileName) {
  const normalized = fileName.toLowerCase();
  return STAGES.find(({ key }) =>
    new RegExp(`(^|[_\\-\\s])${key}([_\\-\\s.]|$)`, "i").test(normalized),
  )?.key ?? null;
}

export function parseCampaignContent(content) {
  if (typeof content !== "string" || !content.includes("-Search-")) {
    return { region: "", keywordClass: "", subClass: "" };
  }
  const [rawRegion, rest] = content.split("-Search-", 2);
  const parts = rest.split("-");
  return {
    region: rawRegion.replace(/-+$/, ""),
    keywordClass: parts[0] ?? "",
    subClass: parts[1] ?? "",
  };
}

export function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const sourceDate = new Date(excelEpoch + value * 86_400_000);
    return Number.isNaN(sourceDate.getTime())
      ? null
      : new Date(
          Date.UTC(
            sourceDate.getUTCFullYear(),
            sourceDate.getUTCMonth(),
            sourceDate.getUTCDate(),
            12,
          ),
        );
  }
  if (isBlank(value)) return null;
  const text = String(value).trim();
  const dateParts = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (dateParts) {
    return new Date(
      Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]), 12),
    );
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareRows(left, right) {
  const leftTime = left["首次访问时间"]?.getTime?.() ?? Number.POSITIVE_INFINITY;
  const rightTime = right["首次访问时间"]?.getTime?.() ?? Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.UIN.localeCompare(right.UIN, "en", { numeric: true });
}

function toOutputRow(raw, stage) {
  const content = raw["广告系列内容"] ?? null;
  const parsed = parseCampaignContent(content);
  return {
    投放渠道: CHANNELS[String(raw["广告系列来源"] ?? "").trim()],
    UIN: normalizeUin(raw.UIN),
    首次访问时间: toDate(raw["首次访问时间"]),
    广告系列名称: raw["广告系列名称"] ?? null,
    广告系列内容: content,
    区域: parsed.region,
    关键词类: parsed.keywordClass,
    细分词类: parsed.subClass,
    广告系列字词: raw["广告系列字词"] ?? null,
    浏览器语言: raw["浏览器语言"] ?? null,
    "注册用户-神策": 1,
    创建应用: isBlank(raw["创建/领取时间"]) ? 0 : 1,
    "消耗用户数-神策": isBlank(raw["首次测试消耗时间"]) ? 0 : 1,
    "付费用户-神策": isBlank(raw["首次付费时间"]) ? 0 : 1,
    _sourceStage: stage,
  };
}

export function buildInitialReport(stageFiles) {
  const required = STAGES.filter((stage) => stage.required).map((stage) => stage.key);
  const missingStages = required.filter((key) => !stageFiles[key]);
  if (missingStages.length) {
    throw new Error(`缺少必传文件：${missingStages.join("、")}`);
  }

  const totalInput = Object.values(stageFiles).reduce(
    (total, file) => total + file.rows.length,
    0,
  );
  const deduped = new Map();
  for (const stage of PRIORITY) {
    const input = stageFiles[stage];
    if (!input) continue;
    for (const raw of input.rows) {
      const uin = normalizeUin(raw.UIN);
      if (!uin) throw new Error(`${input.fileName} 存在空 UIN`);
      if (!deduped.has(uin)) deduped.set(uin, { raw, stage });
    }
  }

  const rows = [];
  for (const { raw, stage } of deduped.values()) {
    const source = String(raw["广告系列来源"] ?? "").trim();
    if (!(source in CHANNELS)) continue;
    rows.push(toOutputRow(raw, stage));
  }
  rows.sort(compareRows);

  const google = rows.filter((row) => row["投放渠道"] === "谷歌").length;
  const bing = rows.filter((row) => row["投放渠道"] === "必应").length;
  const unresolved = rows.filter((row) => isBlank(row.区域));
  return {
    rows,
    unresolved,
    stats: {
      totalInput,
      deduped: deduped.size,
      channelRows: rows.length,
      google,
      bing,
      missing: unresolved.length,
    },
  };
}

function campaignMode(rows) {
  const counts = new Map();
  for (const row of rows) {
    const content = row["广告系列内容"];
    if (
      typeof content !== "string" ||
      !content.includes("-Search-") ||
      content.includes("�")
    ) {
      continue;
    }
    const campaign = String(row["广告系列名称"] ?? "");
    if (!campaign) continue;
    const values = counts.get(campaign) ?? new Map();
    values.set(content, (values.get(content) ?? 0) + 1);
    counts.set(campaign, values);
  }
  const result = new Map();
  for (const [campaign, values] of counts) {
    const ranked = [...values.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
    result.set(campaign, ranked[0][0]);
  }
  return result;
}

function inferMissingTimes(rows) {
  let count = 0;
  for (const channel of ["谷歌", "必应"]) {
    const channelRows = rows.filter((row) => row["投放渠道"] === channel);
    const known = channelRows.filter((row) => row["首次访问时间"] instanceof Date);
    for (const row of channelRows) {
      if (row["首次访问时间"] instanceof Date || known.length === 0) continue;
      const prefix = row.UIN.slice(0, 4);
      const samePrefix = known.filter((candidate) => candidate.UIN.startsWith(prefix));
      const pool = samePrefix.length ? samePrefix : known;
      let nearest = pool[0];
      let nearestDistance = uinDistance(row.UIN, nearest.UIN);
      for (const candidate of pool.slice(1)) {
        const distance = uinDistance(row.UIN, candidate.UIN);
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      }
      row["首次访问时间"] = new Date(nearest["首次访问时间"]);
      count += 1;
    }
  }
  return count;
}

function uinDistance(left, right) {
  try {
    const distance = BigInt(left) - BigInt(right);
    return distance < 0n ? -distance : distance;
  } catch {
    return BigInt(Number.MAX_SAFE_INTEGER);
  }
}

export function applySupplement(initialRows, supplementMap) {
  const rows = initialRows.map((row) => ({ ...row }));
  const unresolvedBefore = rows.filter((row) => isBlank(row.区域));
  const idToContent = campaignMode(rows);
  const stats = {
    matched: unresolvedBefore.filter((row) => supplementMap.has(row.UIN)).length,
    filled: 0,
    campaign: 0,
    sitelink: 0,
    mojibake: 0,
    time: 0,
  };

  for (const row of rows) {
    const emptyContent =
      isBlank(row["广告系列内容"]) ||
      String(row["广告系列内容"]).trim() === "{campaign}";
    const supplement = supplementMap.get(row.UIN);
    if (emptyContent && supplement?.content) {
      row["广告系列名称"] = supplement.campaign ?? row["广告系列名称"];
      row["广告系列内容"] = supplement.content;
      if (supplement.term !== null) row["广告系列字词"] = supplement.term;
      stats.filled += 1;
    }
  }

  for (const row of rows) {
    if (String(row["广告系列内容"] ?? "").trim() === "{campaign}") {
      const replacement = idToContent.get(String(row["广告系列名称"] ?? ""));
      if (replacement) {
        row["广告系列内容"] = replacement;
        stats.campaign += 1;
      }
    }
  }

  const withoutSitelinks = rows.filter((row) => {
    const isSitelink = String(row["广告系列字词"] ?? "")
      .toLowerCase()
      .includes("sitelink");
    if (isSitelink) stats.sitelink += 1;
    return !isSitelink;
  });

  for (const row of withoutSitelinks) {
    let content = row["广告系列内容"];
    if (typeof content === "string" && content.includes("�")) {
      const replacement = idToContent.get(String(row["广告系列名称"] ?? ""));
      if (replacement) {
        content = replacement;
      } else {
        for (const [pattern, value] of mojibakeRules) content = content.replace(pattern, value);
      }
      row["广告系列内容"] = content;
      stats.mojibake += 1;
    }
  }

  stats.time = inferMissingTimes(withoutSitelinks);
  for (const row of withoutSitelinks) {
    const parsed = parseCampaignContent(row["广告系列内容"]);
    row.区域 = parsed.region;
    row.关键词类 = parsed.keywordClass;
    row.细分词类 = parsed.subClass;
  }
  withoutSitelinks.sort(compareRows);
  const unresolved = withoutSitelinks.filter((row) => isBlank(row.区域));
  return { rows: withoutSitelinks, unresolved, stats };
}
