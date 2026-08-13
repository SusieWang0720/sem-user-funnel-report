import assert from "node:assert/strict";
import test from "node:test";
import {
  applySupplement,
  buildInitialReport,
  classifyStageFile,
  parseCampaignContent,
  toDate,
} from "../src/lib/funnel.js";

function raw(overrides = {}) {
  return {
    UIN: "450200000001",
    广告系列来源: "google",
    首次访问时间: "2026-08-01 10:00:00",
    广告系列名称: "23000000001",
    广告系列内容: "美国-Search-品牌词-TRTC-0801",
    广告系列字词: "tencent rtc",
    浏览器语言: "en-us",
    "创建/领取时间": null,
    首次测试消耗时间: null,
    首次付费时间: null,
    ...overrides,
  };
}

test("按文件名识别五个阶段", () => {
  assert.equal(classifyStageFile("用户明细_paid_2026-08-06.xlsx"), "paid");
  assert.equal(classifyStageFile("用户明细_registered_2026-08-06.xlsx"), "registered");
  assert.equal(classifyStageFile("query-impala-2317.xlsx"), null);
});

test("广告系列内容按 -Search- 解析并兼容双横线", () => {
  assert.deepEqual(parseCampaignContent("巴西--Search-品牌词-TRTC-0416"), {
    region: "巴西",
    keywordClass: "品牌词",
    subClass: "TRTC",
  });
});

test("日期固定在 UTC 中午，导出时不跨日", () => {
  assert.equal(toDate("2024-08-27 01:20:00").toISOString(), "2024-08-27T12:00:00.000Z");
});

test("漏斗按付费优先并接受 created 可选表", () => {
  const shared = "450200000001";
  const stageFiles = {
    paid: { fileName: "paid.xlsx", rows: [raw({ UIN: shared, 首次付费时间: "2026-08-02" })] },
    tested: { fileName: "tested.xlsx", rows: [raw({ UIN: shared, 首次测试消耗时间: "2026-08-02" })] },
    trial: { fileName: "trial.xlsx", rows: [raw({ UIN: shared })] },
    created: { fileName: "created.xlsx", rows: [raw({ UIN: shared, "创建/领取时间": "2026-08-01" })] },
    registered: {
      fileName: "registered.xlsx",
      rows: [
        raw({ UIN: shared }),
        raw({ UIN: "450200000002", 广告系列来源: "bingmkt" }),
      ],
    },
  };
  const result = buildInitialReport(stageFiles);
  assert.equal(result.stats.totalInput, 6);
  assert.equal(result.stats.deduped, 2);
  assert.equal(result.stats.google, 1);
  assert.equal(result.stats.bing, 1);
  assert.equal(result.rows.find((row) => row.UIN === shared)["付费用户-神策"], 1);
});

test("补充数据只填空内容并删除 sitelink", () => {
  const initial = buildInitialReport({
    paid: { fileName: "paid.xlsx", rows: [] },
    tested: { fileName: "tested.xlsx", rows: [] },
    trial: { fileName: "trial.xlsx", rows: [] },
    registered: {
      fileName: "registered.xlsx",
      rows: [
        raw({ UIN: "450200000010", 广告系列内容: null, 广告系列名称: null }),
        raw({ UIN: "450200000011", 广告系列字词: "hero-sitelink" }),
      ],
    },
  });
  const supplement = new Map([
    [
      "450200000010",
      {
        campaign: "23000000002",
        content: "印度-Search-通用词-RTC-0801",
        term: "video sdk",
      },
    ],
  ]);
  const result = applySupplement(initial.rows, supplement);
  assert.equal(result.stats.matched, 1);
  assert.equal(result.stats.filled, 1);
  assert.equal(result.stats.sitelink, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].区域, "印度");
  assert.equal(result.unresolved.length, 0);
});
