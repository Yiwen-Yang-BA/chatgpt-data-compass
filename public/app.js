import {
  $,
  escape,
  toast,
  download,
  csv,
  init,
  run,
  busy,
  resultMeta,
  fileText,
} from "./ui.js";
import { bars, num } from "./charts.js";
const sample =
  "date,region,category,revenue,cost\n2026-01-03,华东,软件,12000,6000\n2026-01-06,华北,软件,8500,4100\n2026-01-08,华南,服务,6400,3200\n2026-02-03,华东,服务,9800,4500\n2026-02-06,华北,软件,10200,4800\n2026-02-08,华南,软件,11500,5400\n2026-03-03,华东,软件,14800,6900\n2026-03-06,华北,服务,7300,3500\n2026-03-08,华南,服务,8200,4100\n2026-03-09,华西,软件,,2500\n";
let dataset = null;
let result = null;
let pending = false;
let dirty = true;
function lock(on) {
  pending = on;
  document
    .querySelectorAll("input,select,textarea,#sample,#inspect,#analyze")
    .forEach((el) => (el.disabled = on));
  $("#analyze").disabled = on || !dataset || dirty;
  $("#group").disabled = on || !dataset;
  $("#metric").disabled = on || !dataset || $("#operation").value === "count";
  $("#filter-column").disabled = on || !dataset;
  $("#filter-value").disabled = on || !$("#filter-column").value;
}
function table(columns, rows) {
  return `<table class="data-table"><thead><tr>${columns.map((c) => `<th>${escape(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
async function inspect() {
  if (pending) return;
  lock(true);
  const source = $("#csv").value;
  busy($("#inspect"), true, "读取中…");
  try {
    const r = await run({ action: "inspect", csv: source }, { mode: "demo" });
    dataset = { ...r.data, csv: source };
    dirty = false;
    const options = dataset.columns
      .map((c) => `<option value="${escape(c)}">${escape(c)}</option>`)
      .join("");
    $("#group").innerHTML = options;
    $("#metric").innerHTML = options;
    $("#filter-column").innerHTML =
      '<option value="">不筛选</option>' + options;
    $("#group").value = dataset.columns.includes("region")
      ? "region"
      : dataset.columns[0];
    $("#metric").value = dataset.columns.includes("revenue")
      ? "revenue"
      : dataset.columns.find((_, i) =>
          dataset.preview.some(
            (r) => r[i] !== "" && Number.isFinite(Number(r[i])),
          ),
        ) || dataset.columns[0];
    $("#preview").innerHTML = table(dataset.columns, dataset.preview);
    $("#dataset-status").textContent =
      `${dataset.summary.rows} 行 · ${dataset.columns.length} 列`;
    if (result) $("#result-label").textContent = "上一轮结果 · 请重新分析";
  } catch (err) {
    dirty = true;
    toast(err.message, true);
  } finally {
    busy($("#inspect"), false);
    lock(false);
  }
}
$("#inspect").onclick = inspect;
$("#csv").oninput = () => {
  dirty = true;
  $("#analyze").disabled = true;
  $("#dataset-status").textContent = "内容已更改，请重新读取";
};
$("#sample").onclick = async () => {
  $("#csv").value = sample;
  dirty = true;
  await inspect();
};
$("#operation").onchange = () => lock(false);
$("#filter-column").onchange = () => lock(false);
$("#file").onchange = async (e) => {
  if (pending) return;
  lock(true);
  let ok = false;
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) throw Error("请选择 CSV 文件");
    const text = await fileText(f, 750000);
    if (text.length > 250000) throw Error("CSV 超过 250,000 字符");
    $("#csv").value = text;
    dirty = true;
    ok = true;
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = "";
    lock(false);
  }
  if (ok) await inspect();
};
$("#analysis-form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending || dirty || !dataset) return;
  const settings = {
    groupBy: $("#group").value,
    metric: $("#operation").value === "count" ? "" : $("#metric").value,
    operation: $("#operation").value,
    filterColumn: $("#filter-column").value,
    filterValue: $("#filter-value").value,
    question: $("#question").value,
  };
  lock(true);
  busy($("#analyze"), true, "计算与解读中…");
  try {
    const r = await run({ csv: dataset.csv, ...settings });
    result = { ...r.data, settings, meta: r.meta };
    const s = result.summary;
    $("#metrics").innerHTML = [
      [
        "整体" +
          { sum: "合计", mean: "均值", count: "计数" }[settings.operation],
        num(s.total),
      ],
      ["匹配行数", num(s.matchedRows, 0)],
      ["分组数量", num(s.groups, 0)],
      ["空指标数", num(s.missingMetrics, 0)],
    ]
      .map(
        ([label, value]) =>
          `<div class="metric-card"><span>${escape(label)}</span><strong>${value}</strong></div>`,
      )
      .join("");
    $("#chart").innerHTML = result.table.length
      ? bars(
          result.table.map((r) => ({
            label: r.group === null ? "∅ 缺失值" : r.group,
            value: r.value,
          })),
          { label: settings.groupBy + "分组统计" },
        )
      : '<p class="muted">当前筛选下没有可聚合数据。</p>';
    $("#result-table").innerHTML = table(
      [
        settings.groupBy,
        settings.operation === "count"
          ? "行数"
          : settings.metric + " · " + settings.operation,
        "参与计算行数",
      ],
      result.table.map((r) => [
        r.group === null ? "∅ 缺失值" : r.group,
        num(r.value),
        r.count,
      ]),
    );
    $("#warnings").textContent =
      result.warnings.join("\n") +
      (result.table.length > 20
        ? "\n图表仅显示前 20 组，完整结果见表格或导出。"
        : "");
    $("#insight").textContent = result.insight;
    $("#meta").innerHTML = resultMeta(r.meta);
    $("#result-label").textContent =
      `${settings.groupBy} / ${settings.operation}`;
    $("#exports").hidden = false;
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy($("#analyze"), false);
    lock(false);
  }
};
$("#export-csv").onclick = () => {
  if (result)
    download(
      "grouped-analysis.csv",
      csv([
        [result.settings.groupBy, result.settings.operation, "count"],
        ...result.table.map((r) => [r.group ?? "", r.value, r.count]),
      ]),
      "text/csv;charset=utf-8",
    );
};
$("#export-json").onclick = () => {
  if (result) {
    const { preview, ...report } = result;
    download(
      "data-compass-report.json",
      JSON.stringify(report, null, 2),
      "application/json",
    );
  }
};
await init();
lock(false);
