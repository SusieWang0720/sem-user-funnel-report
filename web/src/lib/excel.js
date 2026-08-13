import { OUTPUT_HEADERS, QUERY_HEADERS, REQUIRED_HEADERS } from "./constants.js";
import { normalizeSqlValue, normalizeUin } from "./funnel.js";

let excelModulePromise;

async function getExcelJs() {
  excelModulePromise ??= import("exceljs").then((module) => module.default ?? module);
  return excelModulePromise;
}

function plainValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || value instanceof Date) return value;
  if ("result" in value) return plainValue(value.result);
  if ("text" in value) return value.text;
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  return String(value);
}

async function loadFirstSheet(buffer) {
  const ExcelJS = await getExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Excel 中没有工作表");
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = String(plainValue(cell.value) ?? "").trim();
  });
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    headers.forEach((header, index) => {
      if (header) item[header] = plainValue(row.getCell(index + 1).value);
    });
    if (Object.values(item).some((value) => value !== null && value !== "")) rows.push(item);
  });
  return { headers, rows, sheetName: sheet.name };
}

export async function parseStageBuffer(buffer, fileName) {
  const parsed = await loadFirstSheet(buffer);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !parsed.headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`${fileName} 缺少字段：${missingHeaders.join("、")}`);
  }
  return { fileName, rows: parsed.rows, headers: parsed.headers };
}

export async function parseStageFile(file) {
  return parseStageBuffer(await file.arrayBuffer(), file.name);
}

export async function parseSupplementBuffer(buffer, fileName) {
  const parsed = await loadFirstSheet(buffer);
  const missingHeaders = QUERY_HEADERS.filter((header) => !parsed.headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`${fileName} 缺少字段：${missingHeaders.join("、")}`);
  }
  const map = new Map();
  for (const row of parsed.rows) {
    const uin = normalizeUin(row.user_id);
    if (!uin) continue;
    map.set(uin, {
      campaign: normalizeSqlValue(row.first_utm_campaign),
      content: normalizeSqlValue(row.first_utm_content),
      term: normalizeSqlValue(row.first_utm_term),
    });
  }
  return { fileName, rows: parsed.rows.length, map };
}

export async function parseSupplementFile(file) {
  return parseSupplementBuffer(await file.arrayBuffer(), file.name);
}

function addReportSheet(workbook, sheetName, rows, channel) {
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = [
    { header: "投放渠道", key: "投放渠道", width: 10 },
    { header: "UIN", key: "UIN", width: 16 },
    { header: "首次访问时间", key: "首次访问时间", width: 13 },
    { header: "广告系列名称", key: "广告系列名称", width: 16 },
    { header: "广告系列内容", key: "广告系列内容", width: 38 },
    { header: "区域", key: "区域", width: 18 },
    { header: "关键词类", key: "关键词类", width: 11 },
    { header: "细分词类", key: "细分词类", width: 14 },
    { header: "广告系列字词", key: "广告系列字词", width: 30 },
    { header: "浏览器语言", key: "浏览器语言", width: 12 },
    { header: "注册用户-神策", key: "注册用户-神策", width: 14 },
    { header: "创建应用", key: "创建应用", width: 11 },
    { header: "消耗用户数-神策", key: "消耗用户数-神策", width: 17 },
    { header: "付费用户-神策", key: "付费用户-神策", width: 15 },
  ];
  for (const row of rows.filter((item) => item["投放渠道"] === channel)) {
    const clean = Object.fromEntries(OUTPUT_HEADERS.map((header) => [header, row[header] ?? null]));
    const numericUin = Number(clean.UIN);
    if (Number.isSafeInteger(numericUin)) clean.UIN = numericUin;
    sheet.addRow(clean);
  }
  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A1A" } };
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    row.getCell(2).numFmt = Number.isSafeInteger(row.getCell(2).value) ? "0" : "@";
    row.getCell(3).numFmt = "yyyy/m/d";
  });
  sheet.autoFilter = { from: "A1", to: `N${Math.max(1, sheet.rowCount)}` };
}

export async function createReportBlob(rows, excludedUins = new Set()) {
  const ExcelJS = await getExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SEM Funnel Generator";
  workbook.created = new Date();
  const filtered = rows.filter((row) => !excludedUins.has(row.UIN));
  addReportSheet(workbook, "Google", filtered, "谷歌");
  addReportSheet(workbook, "Bing", filtered, "必应");
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createMissingCsv(rows) {
  const content = [
    ["UIN", "广告系列名称", "广告系列内容"],
    ...rows.map((row) => [row.UIN, row["广告系列名称"], row["广告系列内容"]]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new Blob([`\uFEFF${content}\r\n`], { type: "text/csv;charset=utf-8" });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
