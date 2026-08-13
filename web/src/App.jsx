import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Circle,
  CloudArrowUp,
  Database,
  DownloadSimple,
  FileXls,
  LockKey,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { STAGES } from "./lib/constants.js";
import {
  applySupplement,
  buildInitialReport,
  classifyStageFile,
} from "./lib/funnel.js";
import {
  createMissingCsv,
  createReportBlob,
  downloadBlob,
  parseStageFile,
  parseSupplementFile,
} from "./lib/excel.js";

const number = new Intl.NumberFormat("zh-CN");
const stageLabel = Object.fromEntries(STAGES.map((stage) => [stage.key, stage.label]));

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function StepRail({ activeStep }) {
  const steps = ["上传", "初版", "补数", "最终"];
  return (
    <aside className="step-rail" aria-label="处理步骤">
      {steps.map((label, index) => {
        const step = index + 1;
        return (
          <div className={`rail-step ${activeStep >= step ? "is-active" : ""}`} key={label}>
            <span className="rail-dot">{step}</span>
            <span>{label}</span>
          </div>
        );
      })}
    </aside>
  );
}

function StageRows({ files, onRemove }) {
  return (
    <div className="stage-list">
      {STAGES.map((stage) => {
        const item = files[stage.key];
        return (
          <div className="stage-row" key={stage.key}>
            <span className={`status-icon ${item ? "ready" : ""}`}>
              {item ? <CheckCircle weight="fill" /> : <Circle weight="regular" />}
            </span>
            <strong>{stage.label}</strong>
            <span className="requirement">{stage.required ? "必传" : "可选"}</span>
            <span className="file-name">
              {item ? <FileXls weight="fill" /> : null}
              {item?.fileName ?? "等待上传"}
            </span>
            <span className="row-count">{item ? `${number.format(item.rows.length)} 行` : "—"}</span>
            {item ? (
              <button
                type="button"
                className="icon-button"
                aria-label={`移除${stage.label}文件`}
                onClick={() => onRemove(stage.key)}
              >
                <Trash />
              </button>
            ) : (
              <span className="icon-spacer" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DownloadButton({ children, onClick, primary = false, disabled = false }) {
  return (
    <button
      type="button"
      className={`download-button ${primary ? "primary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <DownloadSimple weight="bold" />
      {children}
    </button>
  );
}

export function App() {
  const stageInput = useRef(null);
  const supplementInput = useRef(null);
  const [stageFiles, setStageFiles] = useState({});
  const [initialResult, setInitialResult] = useState(null);
  const [supplementMap, setSupplementMap] = useState(new Map());
  const [supplementFiles, setSupplementFiles] = useState([]);
  const [finalResult, setFinalResult] = useState(null);
  const [excludeMode, setExcludeMode] = useState(false);
  const [excludedUins, setExcludedUins] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [supplementDragging, setSupplementDragging] = useState(false);
  const [error, setError] = useState("");
  const [finalDownloaded, setFinalDownloaded] = useState(false);

  const requiredReady = STAGES.filter((stage) => stage.required).every(
    (stage) => stageFiles[stage.key],
  );
  const activeStep = finalDownloaded ? 4 : finalResult ? 3 : initialResult ? 2 : 1;
  const finalRows = useMemo(
    () => finalResult?.rows.filter((row) => !excludedUins.has(row.UIN)) ?? [],
    [finalResult, excludedUins],
  );

  async function acceptStageFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const next = { ...stageFiles };
      for (const file of files) {
        if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} 超过 100MB`);
        const stage = classifyStageFile(file.name);
        if (!stage) {
          throw new Error(`无法从文件名识别阶段：${file.name}`);
        }
        next[stage] = await parseStageFile(file);
      }
      setStageFiles(next);
      const ready = STAGES.filter((stage) => stage.required).every((stage) => next[stage.key]);
      if (ready) {
        setInitialResult(buildInitialReport(next));
        setSupplementMap(new Map());
        setSupplementFiles([]);
        setFinalResult(null);
        setExcludeMode(false);
        setExcludedUins(new Set());
        setFinalDownloaded(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文件处理失败");
    } finally {
      setBusy(false);
      if (stageInput.current) stageInput.current.value = "";
    }
  }

  function removeStage(stage) {
    const next = { ...stageFiles };
    delete next[stage];
    setStageFiles(next);
    setInitialResult(null);
    setSupplementMap(new Map());
    setSupplementFiles([]);
    setFinalResult(null);
    setExcludedUins(new Set());
    setFinalDownloaded(false);
  }

  function resetAll() {
    setStageFiles({});
    setInitialResult(null);
    setSupplementMap(new Map());
    setSupplementFiles([]);
    setFinalResult(null);
    setExcludeMode(false);
    setExcludedUins(new Set());
    setError("");
    setFinalDownloaded(false);
  }

  async function acceptSupplementFiles(fileList) {
    if (!initialResult) return;
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const nextMap = new Map(supplementMap);
      const nextFiles = [...supplementFiles];
      for (const file of files) {
        if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} 超过 100MB`);
        const parsed = await parseSupplementFile(file);
        for (const [uin, value] of parsed.map) nextMap.set(uin, value);
        const withoutSameName = nextFiles.filter((item) => item.fileName !== file.name);
        nextFiles.length = 0;
        nextFiles.push(...withoutSameName, parsed);
      }
      const result = applySupplement(initialResult.rows, nextMap);
      setSupplementMap(nextMap);
      setSupplementFiles(nextFiles);
      setFinalResult(result);
      setExcludeMode(false);
      setExcludedUins(new Set());
      setFinalDownloaded(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "补充表处理失败");
    } finally {
      setBusy(false);
      if (supplementInput.current) supplementInput.current.value = "";
    }
  }

  async function downloadReport(rows, prefix, excluded = new Set()) {
    setBusy(true);
    try {
      const blob = await createReportBlob(rows, excluded);
      downloadBlob(blob, `${prefix}_${todayStamp()}.xlsx`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "报表生成失败");
    } finally {
      setBusy(false);
    }
  }

  function chooseExcludeMode(enabled) {
    setExcludeMode(enabled);
    setExcludedUins(
      enabled ? new Set(finalResult?.unresolved.map((row) => row.UIN) ?? []) : new Set(),
    );
  }

  function toggleExcluded(uin) {
    setExcludedUins((current) => {
      const next = new Set(current);
      if (next.has(uin)) next.delete(uin);
      else next.add(uin);
      return next;
    });
  }

  return (
    <main className="app-shell">
      <div className="content-column">
        <header className="page-header">
          <div>
            <div className="title-line">
              <h1>SEM 漏斗生成器</h1>
              <span className="privacy-label"><LockKey weight="bold" /> 无需 AI · 数据不离开浏览器</span>
            </div>
            <p>上传各阶段 Excel，生成初版和待补 UIN；补充 Impala 数据后下载最终表。</p>
          </div>
          {(Object.keys(stageFiles).length > 0 || initialResult) && (
            <button type="button" className="reset-button" onClick={resetAll}>
              <Trash /> 重置本次处理
            </button>
          )}
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <WarningCircle weight="fill" />
            <span>{error}</span>
          </div>
        )}

        <section className="workflow-section upload-section">
          <div className="section-heading">
            <h2>1. 上传阶段文件</h2>
            <span>支持同时上传多个 Excel</span>
          </div>
          <div
            className={`drop-zone ${dragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              acceptStageFiles(event.dataTransfer.files);
            }}
            onClick={() => stageInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") stageInput.current?.click();
            }}
          >
            <CloudArrowUp className="upload-icon" weight="regular" />
            <div>
              <strong>将 Excel 文件拖到此处，或 <span>点击选择文件</span></strong>
              <p>支持 .xlsx / .xls，单个文件 ≤ 100MB</p>
            </div>
            <input
              ref={stageInput}
              type="file"
              accept=".xlsx,.xls"
              multiple
              hidden
              onChange={(event) => acceptStageFiles(event.target.files)}
            />
          </div>
          <StageRows files={stageFiles} onRemove={removeStage} />
          {!requiredReady && (
            <p className="helper-text">文件名需包含 paid、tested、trial、registered；created 可选。</p>
          )}
        </section>

        <section className={`workflow-section ${initialResult ? "" : "is-muted"}`}>
          <div className="section-heading">
            <h2>2. 初版生成结果</h2>
            {!initialResult && <span>四张必传表齐全后自动处理</span>}
          </div>
          {initialResult ? (
            <>
              <div className="funnel-summary">
                <div><strong>{number.format(initialResult.stats.totalInput)}</strong><span>原始</span></div>
                <ArrowRight />
                <div><strong>{number.format(initialResult.stats.deduped)}</strong><span>去重</span></div>
                <ArrowRight />
                <div><strong>{number.format(initialResult.stats.channelRows)}</strong><span>Google/Bing</span></div>
                <ArrowRight />
                <div className="accent-metric"><strong>{number.format(initialResult.stats.missing)}</strong><span>待补</span></div>
              </div>
              <div className="action-row">
                <DownloadButton onClick={() => downloadReport(initialResult.rows, "SEM用户漏斗报表_初版")} disabled={busy}>
                  下载初版 XLSX
                </DownloadButton>
                <DownloadButton
                  onClick={() => downloadBlob(createMissingCsv(initialResult.unresolved), `missing_uins_${todayStamp()}.csv`)}
                  disabled={busy}
                >
                  下载待补 UIN CSV
                </DownloadButton>
                <span className="channel-note">Google {number.format(initialResult.stats.google)} · Bing {number.format(initialResult.stats.bing)}</span>
              </div>
            </>
          ) : (
            <div className="empty-result">上传完整文件后，这里会显示合并、去重和待补数量。</div>
          )}
        </section>

        <section className={`workflow-section ${initialResult ? "" : "is-muted"}`}>
          <div className="section-heading">
            <h2>3. 补充 Impala 数据并匹配</h2>
            <span>支持连续补充多个查询结果</span>
          </div>
          <div
            className={`drop-zone supplement-zone ${supplementDragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setSupplementDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setSupplementDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setSupplementDragging(false);
              acceptSupplementFiles(event.dataTransfer.files);
            }}
            onClick={() => initialResult && supplementInput.current?.click()}
            role="button"
            tabIndex={initialResult ? 0 : -1}
          >
            <Database className="upload-icon" weight="regular" />
            <div>
              <strong>上传 Impala 补充文件（Excel）</strong>
              <p>需包含 user_id / first_utm_campaign / first_utm_content / first_utm_term</p>
              {supplementFiles.length > 0 && (
                <span className="uploaded-files">已载入：{supplementFiles.map((file) => file.fileName).join("、")}</span>
              )}
            </div>
            <input
              ref={supplementInput}
              type="file"
              accept=".xlsx,.xls"
              multiple
              hidden
              disabled={!initialResult}
              onChange={(event) => acceptSupplementFiles(event.target.files)}
            />
          </div>

          {finalResult && (
            <>
              <div className="match-summary">
                <div><span>已匹配</span><strong>{number.format(finalResult.stats.matched)}</strong></div>
                <div><span>有效回填</span><strong>{number.format(finalResult.stats.filled)}</strong></div>
                <div className={finalResult.unresolved.length ? "danger-metric" : "success-metric"}>
                  <span>仍缺失</span><strong>{number.format(finalResult.unresolved.length)}</strong>
                </div>
              </div>

              {finalResult.unresolved.length > 0 && (
                <div className="exceptions-panel">
                  <div className="exception-table-wrap">
                    <h3>仍缺失的 UIN（{finalResult.unresolved.length}）</h3>
                    <div className="exception-table">
                      <div className="exception-header"><span>排除</span><span>UIN</span><span>来源阶段</span><span>原因</span></div>
                      {finalResult.unresolved.slice(0, 30).map((row) => (
                        <label className="exception-row" key={row.UIN}>
                          <span>
                            <input
                              type="checkbox"
                              disabled={!excludeMode}
                              checked={excludedUins.has(row.UIN)}
                              onChange={() => toggleExcluded(row.UIN)}
                            />
                          </span>
                          <span>{row.UIN}</span>
                          <span>{stageLabel[row._sourceStage] ?? row._sourceStage}</span>
                          <span>Impala 中无有效 UTM</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="handling-choice">
                    <h3>处理方式</h3>
                    <label>
                      <input type="radio" checked={!excludeMode} onChange={() => chooseExcludeMode(false)} />
                      <span>保留空值（推荐）</span>
                    </label>
                    <label>
                      <input type="radio" checked={excludeMode} onChange={() => chooseExcludeMode(true)} />
                      <span>排除选中的 UIN</span>
                    </label>
                    {excludeMode && <p>将排除 {excludedUins.size} 条，其余保留。</p>}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="final-button"
                disabled={busy}
                onClick={async () => {
                  await downloadReport(finalResult.rows, "SEM用户漏斗报表_最终", excludedUins);
                  setFinalDownloaded(true);
                }}
              >
                <DownloadSimple weight="bold" />
                生成并下载最终表（{number.format(finalRows.length)} 条）
              </button>
            </>
          )}
        </section>
      </div>

      <StepRail activeStep={activeStep} />
      {busy && <div className="busy-indicator" role="status">正在本地处理 Excel…</div>}
    </main>
  );
}
