import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Braces,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Database,
  FileDown,
  FolderKanban,
  GitFork,
  HardDrive,
  History,
  Layers3,
  LayoutGrid,
  ListFilter,
  Network,
  Play,
  Plus,
  Radio,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TriangleAlert,
  Upload,
  X,
  Zap,
} from "lucide-react";
import seed from "./demo.json";
import {
  capacity,
  clone,
  cost,
  hardware,
  LIMITS,
  NETWORK_DIMENSIONS,
  searchEnabled,
  dimensionValues,
  activeDimensions,
  validateLimits,
  targetUplinkCounts,
  topology,
  traffic,
  validate,
} from "./engine.js";
import { normalizeNetworkData, normalizeMatrix } from "./network-format.js";
import { SERVICE_FIELDS, prepareService, serviceProfile } from "./service.js";
import {
  ObjectResources,
  ObjectGraphView,
  ObjectHeatmap,
} from "./object-resources.jsx";
import { inspectModel, applyObjectChanges } from "./topology-model.js";
import { readObjectWorkbook, singleClusterBundle } from "./topology-io.js";
import "./style.css";

const MODULES = [
  ["projects", "项目中心", FolderKanban, "01"],
  ["resources", "资源与网络建模", Network, "02"],
  ["workload", "业务负载建模", Layers3, "03"],
  ["simulation", "评估工作台", Activity, "04"],
];
const STORAGE = "cluster-network-demo-v2";
const format = (n, d = 1) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("zh-CN", { maximumFractionDigits: d });
const stamp = (t) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(t);
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);
const summary = (r) => {
  const { links, series, ...rest } = r;
  return rest;
};
const snapshot = (p, config = p.config) => ({
  config: clone(config),
  workload: clone(p.workload),
  limits: clone(p.limits),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const colors = ["#2866ed", "#12a795", "#eea03c", "#835ce7", "#ee696f"];
const DEFAULT_DISPLAY = {
  domains: { D01: "网络域 01", D02: "网络域 02" },
  assigned: "沿用",
};
function readDisplay(value, current) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("展示配置须为对象");
  const domains = Object.fromEntries(
    Object.keys(current.domains).map((id) => {
      const name = value.domains?.[id] ?? current.domains[id];
      if (typeof name !== "string" || !name.trim() || name.trim().length > 24)
        throw Error("网络域名称须为 1–24 个字符");
      return [id, name.trim()];
    }),
  );
  if (new Set(Object.values(domains)).size !== Object.keys(domains).length)
    throw Error("请使用不同的网络域名称");
  const assigned = value.assigned ?? current.assigned;
  if (
    typeof assigned !== "string" ||
    !assigned.trim() ||
    assigned.trim().length > 12
  )
    throw Error("设备状态标签须为 1–12 个字符");
  return { domains, assigned: assigned.trim() };
}
const ROLE_STYLE = { existing: "gray", assigned: "teal", added: "blue" };
const DisplayContext = createContext(DEFAULT_DISPLAY);
function useProjectNames() {
  const display = useContext(DisplayContext);
  const domain = (key) => display.domains[key] || key || "共享";
  const role = (key) =>
    ({
      existing: "存量",
      assigned: display.assigned,
      added: "新增",
    })[key];
  const label = (text) =>
    text.replace(/D0[12](?=\s|$)|利旧/g, (key) =>
      key === "利旧" ? role("assigned") : domain(key),
    );
  return { display, domain, role, label };
}
function restoreProject(p) {
  const display =
    p.display ??
    (p.id === seed.id || p.name.startsWith(seed.name)
      ? seed.display
      : DEFAULT_DISPLAY);
  let workload = p.workload;
  if (p.id === seed.id && !workload.services) {
    workload = {
      ...workload,
      seconds: seed.workload.seconds,
      services: clone(seed.workload.services),
      mode: workload.mode === "matrix" ? "matrix" : "service",
    };
  }
  if (workload.mode === "inference") {
    workload = { ...workload, mode: workload.previousMode ?? "profile" };
  }
  const old = (item) => item.input?.workload.mode === "inference";
  const archived = [...p.history.filter(old), ...p.plans.filter(old)];
  return {
    ...p,
    workload,
    display,
    history: p.history.filter((item) => !old(item)),
    plans: p.plans.filter((item) => !old(item)),
    ...(archived.length
      ? { archivedInference: [...(p.archivedInference ?? []), ...archived] }
      : {}),
  };
}
function load() {
  try {
    const d = normalizeNetworkData(JSON.parse(localStorage.getItem(STORAGE)));
    if (d?.projects?.length) {
      const retired = d.projects.find((p) => p.id === "pd-inference");
      const projects = d.projects
        .filter((p) => p.id !== "pd-inference")
        .map(restoreProject);
      if (!projects.length) projects.push(clone(seed));
      return {
        ...d,
        projects,
        active: projects.some((p) => p.id === d.active)
          ? d.active
          : projects[0].id,
        ...(retired ? { retiredExample: retired } : {}),
      };
    }
  } catch {}
  return { projects: [clone(seed)], active: seed.id };
}
function download(filename, data, mime = "text/plain") {
  const url = URL.createObjectURL(
    new Blob([data], { type: mime + ";charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 300);
}
const csv = (rows) =>
  "\uFEFF" +
  rows
    .map((row) =>
      row
        .map((value) => '"' + String(value ?? "").replaceAll('"', '""') + '"')
        .join(","),
    )
    .join("\n");
function Status({ pass, children }) {
  return (
    <span className={"status " + (pass ? "success" : "warn")}>
      {pass ? <Check size={13} /> : <TriangleAlert size={13} />}{" "}
      {children ?? (pass ? "通过" : "需关注")}
    </span>
  );
}
function Badge({ children, tone = "blue" }) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Btn({ children, icon: Icon, primary = false, ...rest }) {
  return (
    <button className={"btn " + (primary ? "primary" : "")} {...rest}>
      {Icon && <Icon size={16} />} {children}
    </button>
  );
}
function Field({
  label,
  suffix,
  value,
  onChange,
  type = "number",
  min,
  max,
  step = 1,
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div>
        <input
          type={type}
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          onChange={(e) =>
            onChange(
              type === "number"
                ? e.target.value === ""
                  ? ""
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="select">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option
              key={Array.isArray(o) ? o[0] : o}
              value={Array.isArray(o) ? o[0] : o}
            >
              {Array.isArray(o) ? o[1] : o}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </div>
    </label>
  );
}
function Panel({ title, sub, icon: Icon, action, children, className = "" }) {
  return (
    <section className={"panel " + className}>
      <div className="panel-head">
        <div>
          <h2>
            {Icon && <Icon size={17} />} {title}
          </h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({ icon: Icon = Activity, title, detail, children }) {
  return (
    <div className="empty">
      <div>
        <Icon size={27} />
      </div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {children}
    </div>
  );
}
function Heading({ tag, title, description, actions }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <span />
          {tag}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
function Modal({ title, close, children }) {
  useEffect(() => {
    const f = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [close]);
  return (
    <div className="modal-scrim" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Timeline({ result, hot }) {
  const [mode, setMode] = useState("util");
  const [pointer, setPointer] = useState(null);
  const rows = result.series;
  const lines =
    mode === "util"
      ? hot.map((l, i) => ({
          name: shortLink(l),
          values: l.series,
          color: colors[i],
        }))
      : [
          {
            name:
              mode === "rate"
                ? "传输速率"
                : mode === "latency"
                  ? "当步完成消息 P99"
                  : "全网待传量",
            values: rows.map((r) => r[mode]),
            color: colors[0],
          },
        ];
  const top =
    mode === "util"
      ? 100
      : Math.max(1, Math.ceil(Math.max(...lines[0].values) / 4) * 4);
  const W = 680,
    H = 223,
    x0 = 49,
    y0 = 14,
    w = 611,
    h = 171;
  const index =
    pointer == null ? null : Math.min(rows.length - 1, Math.max(0, pointer));
  const x = (i) => x0 + (i * w) / Math.max(1, rows.length - 1);
  const y = (n) => y0 + h * (1 - n / top);
  const points = (line) =>
    line.values
      .flatMap((n, i) =>
        n == null ? [] : [x(i).toFixed(1) + "," + y(n).toFixed(1)],
      )
      .join(" ");
  const units = { util: "%", rate: " GB/s", queue: " MB", latency: " ms" };
  return (
    <Panel
      title="带宽与时延时序"
      sub="按仿真时间观察热点链路、消息完成时延与积压"
      action={
        <div className="segmented">
          {[
            ["util", "链路利用率"],
            ["rate", "传输速率"],
            ["latency", "P99 时延"],
            ["queue", "待传量"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={mode === key ? "selected" : ""}
              onClick={() => {
                setMode(key);
                setPointer(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="随时间变化的仿真指标折线图"
          onMouseLeave={() => setPointer(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const a = ((e.clientX - rect.left) * W) / rect.width;
            setPointer(Math.round(((a - x0) * (rows.length - 1)) / w));
          }}
        >
          <defs>
            <linearGradient id="timeline-fill" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#3b76ff" stopOpacity=".20" />
              <stop offset="1" stopColor="#3b76ff" stopOpacity=".015" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1={x0}
                x2={x0 + w}
                y1={y((top * i) / 4)}
                y2={y((top * i) / 4)}
                stroke="#e8edf5"
                strokeDasharray={i ? "4 4" : undefined}
              />
              <text x={x0 - 8} y={y((top * i) / 4) + 4} textAnchor="end">
                {format((top * i) / 4, 0)}
                {mode === "util" ? "%" : ""}
              </text>
            </g>
          ))}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <text key={i} x={x0 + (w * i) / 6} y="207" textAnchor="middle">
              {format(((rows.at(-1)?.t || 0) * i) / 6, 0)} ms
            </text>
          ))}
          {lines[0] && mode !== "latency" && (
            <polygon
              fill="url(#timeline-fill)"
              points={`${x0},${y(0)} ${points(lines[0])} ${x0 + w},${y(0)}`}
            />
          )}
          {lines.map((line) => (
            <polyline
              key={line.name}
              points={points(line)}
              fill="none"
              stroke={line.color}
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {index != null && rows[index] && (
            <g>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={y0}
                y2={y0 + h}
                stroke="#7b8ba6"
                strokeDasharray="4 4"
              />
              {lines
                .filter((line) => line.values[index] != null)
                .map((line) => (
                  <circle
                    key={line.name}
                    cx={x(index)}
                    cy={y(line.values[index])}
                    r="4"
                    fill={line.color}
                    stroke="white"
                  />
                ))}
            </g>
          )}
        </svg>
        {index != null && rows[index] && (
          <div className="chart-tooltip">
            <strong>{rows[index].t} ms</strong>
            {lines.map((line) => (
              <div key={line.name}>
                {line.name}
                <b>
                  {format(line.values[index])}
                  {units[mode]}
                </b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="legend">
        {lines.map((l) => (
          <span key={l.name}>
            <i style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </div>
    </Panel>
  );
}
const shortLink = (l) =>
  l.a.replace(/^D0[12]-/, "") + " ↔ " + l.b.replace(/^D0[12]-/, "");
const heatColor = (n) =>
  n >= 90
    ? "#ed655c"
    : n >= 75
      ? "#f29a54"
      : n >= 55
        ? "#f7bd68"
        : n >= 35
          ? "#6ea2f4"
          : n >= 15
            ? "#a8c8ff"
            : n > 0
              ? "#d6e6ff"
              : "#edf2fa";
function Heatmap({ result, onPick }) {
  const names = useProjectNames();
  const [domain, setDomain] = useState("D02");
  const [kind, setKind] = useState("上联");
  const links = result.links.filter(
    (l) => l.plane === domain && l.type === kind,
  );
  const leafIds = [
    ...new Set(
      links.map((l) =>
        kind === "上联" ? l.a : [l.a, l.b].find((x) => /-[CS]L/.test(x)),
      ),
    ),
  ].sort();
  const cols =
    kind === "上联" ? [...new Set(links.map((l) => l.b))].sort() : ["端点接入"];
  const map = new Map(
    links.map((l) => [
      (kind === "上联" ? l.a : [l.a, l.b].find((x) => /-[CS]L/.test(x))) +
        "|" +
        (kind === "上联" ? l.b : "端点接入"),
      l,
    ]),
  );
  if (result.objectModel)
    return <ObjectHeatmap result={result} onPick={onPick} />;
  return (
    <Panel
      title="网络负载热力图"
      sub="各链路在本次仿真中的峰值利用率"
      action={
        <div className="heat-select">
          <select
            aria-label="热力图网络域"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          >
            {Object.keys(result.domains).map((id) => (
              <option key={id} value={id}>
                {names.domain(id)}
              </option>
            ))}
          </select>
          <select
            aria-label="链路类型"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option>上联</option>
            <option>接入</option>
          </select>
        </div>
      }
    >
      <div className="heat-scroll">
        <div
          className="heat-grid"
          style={{
            gridTemplateColumns: `44px repeat(${cols.length}, minmax(15px, 1fr))`,
          }}
        >
          <span />
          {cols.map((c) => (
            <span key={c} className="heat-axis">
              {c.replace(domain + "-", "")}
            </span>
          ))}
          {leafIds.map((leaf) => (
            <React.Fragment key={leaf}>
              <span className="heat-axis row-axis">{leaf.split("-")[1]}</span>
              {cols.map((col) => {
                const l = map.get(leaf + "|" + col);
                return l ? (
                  <button
                    key={col}
                    className={"heat-cell " + (l.down ? "down" : "")}
                    title={
                      l.a +
                      " ↔ " +
                      l.b +
                      " · " +
                      (l.down ? "故障" : l.peak + "%")
                    }
                    aria-label={l.a + " 到 " + l.b + " " + l.peak + "%"}
                    style={{ background: heatColor(l.peak) }}
                    onClick={() => onPick(l)}
                  />
                ) : (
                  <span key={col} className="heat-cell absent" />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="heat-legend">
        <span>低负载</span>
        {[0, 18, 40, 60, 80, 98].map((n) => (
          <i key={n} style={{ background: heatColor(n) }} />
        ))}
        <span>饱和</span>
        <span className="legend-hint">点击查看链路</span>
      </div>
    </Panel>
  );
}
function Metrics({ result }) {
  const metrics = [
    [
      "最大链路利用率",
      result.util,
      "%",
      Activity,
      "峰值 · 单向最大利用率",
      result.checks.find((x) => x.key === "util").pass ? "blue" : "amber",
    ],
    [
      "P99 通信完成时延",
      result.p99,
      "ms",
      Clock3,
      "取各网络域中较大的 P99",
      result.checks.find((x) => x.key === "p99")?.pass === false
        ? "amber"
        : "blue",
    ],
    [
      "有效吞吐",
      result.throughput,
      "GB/s",
      Zap,
      "各网络域完成流量合计",
      "teal",
    ],
    [
      "性能约束",
      result.checks.filter((x) => x.pass).length,
      "/ " + result.checks.length,
      ShieldCheck,
      result.pass ? "全部约束达标" : "存在未通过的校验项",
      result.pass ? "teal" : "amber",
    ],
  ];
  return (
    <div className="metrics">
      {metrics.map(([label, value, unit, Icon, help, tone]) => (
        <div key={label} className="metric">
          <div className={"metric-icon " + tone}>
            <Icon size={17} />
          </div>
          <div className="metric-label">{label}</div>
          <div className="metric-value">
            {format(value, 2)} <span>{unit}</span>
          </div>
          <div className="metric-help">{help}</div>
        </div>
      ))}
    </div>
  );
}
function Diagnostics({ result, onPick, comparison }) {
  const names = useProjectNames();
  const hot = result.links.filter((l) => l.peak > 0).slice(0, 6);
  const dom = result.domains;
  return (
    <>
      <div className="diagnostic-grid">
        <Panel
          title="热点链路排行"
          sub="按峰值利用率排序，支持查看流量归因"
          icon={ListFilter}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>链路</th>
                  <th>类型</th>
                  <th>峰值利用率</th>
                  <th>待传压力</th>
                </tr>
              </thead>
              <tbody>
                {hot.map((l, i) => (
                  <tr key={l.id}>
                    <td>
                      <span className={"rank " + (i === 0 ? "first" : "")}>
                        {i + 1}
                      </span>
                    </td>
                    <td>
                      <button className="text-button" onClick={() => onPick(l)}>
                        {l.a} ↔ {l.b}
                      </button>
                    </td>
                    <td>{l.type}</td>
                    <td>
                      <span className="table-bar">
                        <i
                          style={{
                            width: l.peak + "%",
                            background: heatColor(l.peak),
                          }}
                        />
                      </span>
                      <b>{l.peak}%</b>
                    </td>
                    <td>{format(l.queue, 0)} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel
          title="瓶颈诊断"
          sub="根据未完成流量遇到的资源饱和情况归因"
          icon={TriangleAlert}
        >
          <div className="diagnosis">
            <div className="diagnosis-card">
              <TriangleAlert size={19} />
              <div>
                <strong>
                  {result.storagePressure > result.networkPressure
                    ? "存储侧竞争更显著"
                    : result.networkPressure
                      ? "网络侧竞争更显著"
                      : "未观测到持续资源竞争"}
                </strong>
                <p>
                  网络 {format(result.networkPressure, 0)} · 存储{" "}
                  {format(result.storagePressure, 0)} 消息·ms（可重叠）
                </p>
              </div>
            </div>
            {hot[0] && (
              <div className="diagnosis-row">
                <span>峰值热点</span>
                <button className="text-button" onClick={() => onPick(hot[0])}>
                  {hot[0].a} ↔ {hot[0].b} <ChevronRight size={13} />
                </button>
              </div>
            )}
            {hot[0] && (
              <div className="diagnosis-row">
                <span>热点主流量</span>
                <b>
                  {Object.entries(hot[0].types).sort(
                    (a, b) => b[1] - a[1],
                  )[0]?.[0] || "—"}
                </b>
              </div>
            )}
            <div className="diagnosis-row">
              <span>全网最大待传量</span>
              <b>{format(result.waiting, 0)} MB</b>
            </div>
            <div className="diagnosis-row">
              <span>未完成 / 无路由</span>
              <b>
                {format(result.unfinished, 0)} / {format(result.dropped, 0)} 条
              </b>
            </div>
            {comparison && (
              <>
                <div className="diagnosis-row">
                  <span>正常 → 故障 P99</span>
                  <b>
                    {format(comparison.normal.p99, 2)} →{" "}
                    {format(comparison.fault.p99, 2)} ms
                  </b>
                </div>
                <div className="diagnosis-row">
                  <span>正常 → 故障有效吞吐</span>
                  <b>
                    {format(comparison.normal.throughput)} →{" "}
                    {format(comparison.fault.throughput)} GB/s
                  </b>
                </div>
              </>
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title="分域性能与约束校验"
        sub="容量与存储画像独立配置，时延包含网络传输与存储服务"
        icon={ShieldCheck}
      >
        <div className="domain-cards">
          {Object.entries(dom).map(([name, d]) => (
            <div key={name}>
              <Badge>{names.domain(name)}</Badge>
              <span>
                容量 <b>{d.capacity} PB</b>
              </span>
              <span>
                吞吐 <b>{format(d.throughput)} GB/s</b>
              </span>
              <span>
                IOPS <b>{format(d.iops, 0)}</b>
              </span>
              <span>
                P95 / P99{" "}
                <b>
                  {format(d.p95, 2)} / {format(d.p99, 2)} ms
                </b>
              </span>
            </div>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>校验项</th>
                <th>仿真结果</th>
                <th>目标</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {result.checks.map((c) => (
                <tr key={c.key}>
                  <td>{names.label(c.label)}</td>
                  <td>
                    {format(c.value, 3)} {c.unit}
                  </td>
                  <td>
                    {c.max || ["p99", "util"].includes(c.key) ? "≤" : "≥"}{" "}
                    {format(c.limit, 3)} {c.unit}
                  </td>
                  <td>
                    <Status pass={c.pass} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function SimPage({
  project,
  run,
  task,
  result,
  plan,
  setPlan,
  fault,
  setFault,
  details,
  setDetails,
  openHistory,
  selectedPlan,
  setObjective,
  tab,
  setTab,
  changePage,
  results,
  reports,
  onBaselineDetail,
  baselineAvailable,
}) {
  const names = useProjectNames();
  const data = result?.result;
  const selected = selectedPlan;
  const config = selected?.input.config ?? project.config;
  const dimensions = activeDimensions(project.config, project.search);
  const faultName = config.model
    ? config.model.faultDevices?.join("、")
    : "SP01";
  const searching = !selected && dimensions.length > 0;
  const stale =
    result && !same(result.input, selected?.input ?? snapshot(project));
  const prev = project.history.find(
    (x) => x.fault !== result?.fault && same(x.input, result?.input),
  );
  const comparison = prev &&
    data && {
      fault: result.fault ? data : prev.summary,
      normal: result.fault ? prev.summary : data,
    };
  return (
    <>
      <Heading
        tag="04 / EVALUATION"
        title="评估工作台"
        description="使用固定业务负载评估当前组网，并比较资源页放开的候选配置。"
        actions={
          <>
            <Btn icon={History} onClick={openHistory}>
              历史任务
            </Btn>
            <Btn icon={Play} primary disabled={!!task} onClick={() => run()}>
              {task ? "评估进行中…" : "运行评估"}
            </Btn>
          </>
        }
      />
      <div className="module-tabs">
        <button
          className={tab === "results" ? "selected" : ""}
          onClick={() => setTab("results")}
        >
          评估结果
        </button>
        <button
          className={tab === "reports" ? "selected" : ""}
          onClick={() => setTab("reports")}
        >
          方案与报告 · {project.plans.length}
        </button>
      </div>
      {tab === "reports" ? (
        reports
      ) : (
        <>
          <div className="runbar">
            <div className="runbar-icon">
              <SlidersHorizontal size={19} />
            </div>
            <Select
              label="评估输入"
              value={plan}
              onChange={setPlan}
              options={[
                ["", "项目基线 · 当前配置"],
                ...project.plans.map((p) => [p.id, p.name]),
                ...(selected?.preview
                  ? [[selected.id, selected.name + " · 诊断预览"]]
                  : []),
              ]}
            />
            <Select
              label="运行场景"
              value={fault ? "fault" : "normal"}
              onChange={(v) => setFault(v === "fault")}
              options={[
                ["normal", "正常场景"],
                ...(faultName
                  ? [["fault", "故障场景 · " + faultName + " 下线"]]
                  : []),
              ]}
            />
            {searching && (
              <Select
                label="方案排序目标"
                value={project.search.objective}
                options={Object.entries({
                  ...objectiveNames,
                  throughput:
                    project.workload.mode === "service"
                      ? "最大化达标请求吞吐"
                      : objectiveNames.throughput,
                })}
                onChange={setObjective}
              />
            )}
            <div className="run-meta">
              <span
                className={"dot " + (task ? "pulse" : data ? "green" : "")}
              />
              {task
                ? "正在计算路径与竞争"
                : data
                  ? "最近运行 " + stamp(result.time)
                  : "等待运行"}
            </div>
          </div>
          <div className="evaluation-scope">
            <Badge tone={searching ? "blue" : "gray"}>
              {searching ? "比较基线与候选" : "单方案评估"}
            </Badge>
            <span>
              {selected
                ? "使用所选方案的配置和负载快照。"
                : searching
                  ? "资源页已开放 " +
                    dimensions.length +
                    " 个维度，本次会筛选并比较合法组合。"
                  : "当前资源维度全部锁定，仅评估导入或编辑后的基线。"}
            </span>
            <button
              className="text-button"
              onClick={() => changePage("resources")}
            >
              查看资源与可调配置 <ArrowRight size={14} />
            </button>
          </div>
          {results}
          {data ? (
            <>
              {(stale || result.fault !== fault || result.plan !== plan) && (
                <div className="notice">
                  <TriangleAlert size={16} />{" "}
                  当前显示已评估的快照。点击「运行评估」应用所选输入。
                </div>
              )}
              <div className="section-label" id="evaluation-diagnostics">
                <span>
                  <span className="section-mark" />
                  方案诊断
                </span>
                <span className="run-detail">
                  {result.label} <i /> {result.fault ? "故障场景" : "正常场景"}{" "}
                  <i />{" "}
                  {data.service
                    ? format(
                        data.service.profiles.reduce(
                          (total, profile) => total + profile.requests,
                          0,
                        ),
                        0,
                      ) + " 个推理请求"
                    : format(data.flowCount, 0) + " 条消息"}
                </span>
              </div>
              {data.service && (
                <ServiceMetrics service={data.service} names={names} />
              )}
              <Metrics result={data} />
              {result.partial ? (
                <Panel title="链路诊断">
                  <Empty
                    title="已复用保存的评估指标"
                    detail="按需计算链路热力图和时序明细。"
                  >
                    <Btn onClick={onBaselineDetail} disabled={!!task}>
                      查看链路明细
                    </Btn>
                  </Empty>
                </Panel>
              ) : (
                <>
                  <div className="chart-grid">
                    <Timeline
                      result={data}
                      hot={data.links
                        .filter((l) => l.type === "上联" && l.peak > 0)
                        .slice(0, 3)}
                    />
                    <Heatmap result={data} onPick={setDetails} />
                  </div>
                  <Diagnostics
                    result={data}
                    onPick={setDetails}
                    comparison={comparison}
                  />
                </>
              )}
            </>
          ) : (
            <Panel title="仿真结果">
              <Empty
                title={
                  task
                    ? "正在评估配置"
                    : baselineAvailable
                      ? "已复用基线指标"
                      : "等待运行评估"
                }
                detail={
                  baselineAvailable
                    ? "候选对比已使用保存的基线指标，链路明细可以按需生成。"
                    : "运行评估后查看服务性能、热点链路和约束校核。"
                }
              >
                {baselineAvailable && (
                  <Btn onClick={onBaselineDetail} disabled={!!task}>
                    查看基线诊断
                  </Btn>
                )}
              </Empty>
            </Panel>
          )}
        </>
      )}
      {details && (
        <Modal title="链路详情" close={() => setDetails(null)}>
          <div className="modal-body">
            <Badge>
              {names.domain(details.plane)} · {details.type}
            </Badge>
            <h3>
              {details.a} ↔ {details.b}
            </h3>
            <p>
              {details.aPort && (
                <>
                  {details.aPort} ↔ {details.bPort}　
                </>
              )}
              容量 {format(details.gbps)} Gbps　峰值利用率 {details.peak}
              %　最大经由待传量 {format(details.queue)} MB
            </p>
            <h4>经过链路的流量组成</h4>
            {Object.entries(details.types)
              .sort((a, b) => b[1] - a[1])
              .map(([type, mb]) => (
                <div className="diagnosis-row" key={type}>
                  <span>{type}</span>
                  <b>{format(mb / 1000, 3)} GB</b>
                </div>
              ))}
            {!Object.keys(details.types).length && (
              <p>此链路在本次仿真中无有效流量。</p>
            )}
            {!!details.sources?.length && (
              <>
                <h4>流量来源 Top 5</h4>
                {details.sources.map(([source, mb]) => (
                  <div className="diagnosis-row" key={source}>
                    <span>{source}</span>
                    <b>{format(mb / 1000, 3)} GB</b>
                  </div>
                ))}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function ProjectPage({ projects, active, open, create, duplicate, navigate }) {
  const [query, setQuery] = useState("");
  const matching = projects.filter((p) =>
    (p.name + p.kind).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading
        tag="01 / PROJECTS"
        title="项目中心"
        description="组织不同场景的拓扑、业务负载、仿真任务和方案版本。"
        actions={
          <Btn primary icon={Plus} onClick={create}>
            新建项目
          </Btn>
        }
      />
      <Panel
        title="全部项目"
        sub={projects.length + " 个规划项目"}
        action={
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="搜索项目或场景"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        }
      >
        <div className="project-grid">
          {matching.map((p) => (
            <article
              className={"project-card " + (p.id === active ? "current" : "")}
              key={p.id}
            >
              <div className="project-card-top">
                <div className="module-icon">
                  <Database size={21} />
                </div>
                {p.id === active ? (
                  <Badge>当前项目</Badge>
                ) : (
                  <Badge tone="gray">{p.kind}</Badge>
                )}
              </div>
              <h3>{p.name}</h3>
              <p>{p.description || p.kind}</p>
              <div className="project-stats">
                <span>
                  <Network size={15} />{" "}
                  {p.config.model
                    ? p.config.model.clusters.length + " 个集群"
                    : p.config.spines * 2 + " 台 Spine"}
                </span>
                <span>
                  <History size={15} /> {p.history.length} 次仿真
                </span>
                <span>
                  <GitFork size={15} /> {p.plans.length} 个方案
                </span>
              </div>
              <div className="project-card-footer">
                <button className="text-button" onClick={() => open(p.id)}>
                  打开工作台 <ArrowRight size={15} />
                </button>
                <Btn icon={Copy} onClick={() => duplicate(p)}>
                  复制
                </Btn>
              </div>
            </article>
          ))}
        </div>
        {!matching.length && (
          <Empty
            icon={Search}
            title="未找到匹配的项目"
            detail="试试其他项目名称或场景关键词。"
          />
        )}
      </Panel>
      <Panel
        title="当前项目快捷操作"
        sub={projects.find((p) => p.id === active)?.name}
      >
        <div className="workspace-shortcuts">
          {MODULES.slice(1).map(([key, label, Icon]) => (
            <button
              key={key}
              className="shortcut"
              onClick={() => navigate(key)}
            >
              <div className="module-icon">
                <Icon size={19} />
              </div>
              <div>
                <strong>{label}</strong>
                <small>
                  {
                    {
                      resources: "编辑设备、连接及资源池",
                      workload: "配置画像、矩阵及性能目标",
                      simulation: "评估基线、比较候选并导出报告",
                    }[key]
                  }
                </small>
              </div>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </Panel>
    </>
  );
}
const profileFields = [
  ["model", "业务 / 模型", "text"],
  ["instances", "实例数"],
  ["peak", "峰值并发"],
  ["messageMB", "单消息大小", "number", "MB"],
  ["interval", "发送间隔", "number", "ms"],
  ["checkpoint", "持久化周期", "number", "ms"],
  ["hotspot", "热点比例", "number", "%"],
  ["loadShare", "启动阶段模型加载", "number", "%"],
  ["readShare", "常规读取占比", "number", "%"],
];
function ServiceLoad({ workload, update, names }) {
  const services = workload.services ?? [];
  const change = (index, patch) =>
    update({
      services: services.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  const field = (definition, item, index) => {
    const [key, label, suffix, min, max, step] = definition;
    return (
      <Field
        key={key}
        label={label}
        suffix={suffix}
        min={min}
        max={max}
        step={step}
        value={item[key]}
        onChange={(value) => change(index, { [key]: value })}
      />
    );
  };
  return (
    <>
      <div className="form-top">
        <Field
          label="持续施压"
          suffix="秒"
          min={2}
          max={30}
          value={workload.seconds}
          onChange={(seconds) => update({ seconds })}
        />
        <span className="muted">
          按固定请求速率持续投放。搜索中的负载和部署配置保持固定。
        </span>
      </div>
      <div className="form-grid two">
        {services.map((item, index) => (
          <section className="inner-card" key={index}>
            <div className="inner-head">
              <Badge>
                {names.domain(item.domain)} · 服务 {index + 1}
              </Badge>
              <button
                className="icon-btn"
                aria-label="移除推理服务"
                disabled={services.length === 1}
                onClick={() =>
                  update({ services: services.filter((_, i) => i !== index) })
                }
              >
                <X size={16} />
              </button>
            </div>
            <div className="form-grid three">
              <Select
                label="网络域"
                value={item.domain}
                options={Object.entries(names.display.domains)}
                onChange={(domain) => change(index, { domain })}
              />
              <Field
                label="部署模型"
                type="text"
                value={item.model}
                onChange={(model) => change(index, { model })}
              />
              {field(SERVICE_FIELDS[0], item, index)}
            </div>
            <details className="service-details">
              <summary>固定部署、存储依赖和服务目标</summary>
              <div className="form-grid three">
                {SERVICE_FIELDS.slice(1).map((def) => field(def, item, index))}
              </div>
            </details>
          </section>
        ))}
      </div>
      <div className="form-top">
        <Btn
          icon={Plus}
          disabled={services.length >= 8}
          onClick={() =>
            update({
              services: [
                ...services,
                serviceProfile(Object.keys(names.display.domains).at(-1)),
              ],
            })
          }
        >
          添加推理服务
        </Btn>
      </div>
    </>
  );
}

function ServiceMetrics({ service, names }) {
  return (
    <Panel
      title="推理服务表现"
      sub="按服务统计实际完成的请求。尾部拆分用于区分存储依赖等待和算力排队。"
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>网络域 / 模型</th>
              <th>完成请求</th>
              <th>P99 首 token</th>
              <th>P99 TPOT</th>
              <th>达标吞吐</th>
              <th>尾部读取等待</th>
              <th>尾部算力排队</th>
              <th>校核</th>
            </tr>
          </thead>
          <tbody>
            {service.profiles.map((row, index) => (
              <tr key={index}>
                <td>
                  <Badge>{names.domain(row.domain)}</Badge> {row.model}
                </td>
                <td>
                  {row.completed} / {row.requests}
                </td>
                <td>{format(row.ttft, 2)} ms</td>
                <td>{format(row.tpot, 2)} ms</td>
                <td>{format(row.goodput, 2)} 请求/s</td>
                <td>{format(row.tail.io, 2)} ms</td>
                <td>{format(row.tail.queue, 2)} ms</td>
                <td>
                  <Status pass={row.checks.every((check) => check.pass)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function WorkloadPage({ project, patch, notify }) {
  const names = useProjectNames();
  const { workload: w, limits } = project;
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState("");
  const update = (change) => {
    patch({ workload: { ...w, ...change } });
    setMatrix(null);
    setError("");
  };
  const preview = () => {
    try {
      const errors = validate(project.config);
      if (errors.length) throw Error(errors[0]);
      setMatrix(
        traffic(w, topology(project.config), project.config.distribution),
      );
      setError("");
    } catch (e) {
      setError(e.message);
      setMatrix(null);
    }
  };
  return (
    <>
      <Heading
        tag="03 / TRAFFIC MODEL"
        title="业务负载建模"
        description="录入固定推理部署和基本请求量。也可以选择端点通信模式做网络诊断。"
        actions={
          <Btn
            primary
            icon={Check}
            onClick={() => {
              try {
                const errors = validate(project.config);
                if (errors.length) throw Error(errors[0]);
                const evaluate =
                  w.mode === "service" ? prepareService : traffic;
                evaluate(
                  w,
                  topology(project.config),
                  project.config.distribution,
                );
                validateLimits(project.config, limits);
                setError("");
                notify("业务负载与约束已校验");
              } catch (e) {
                setError(e.message);
                notify(e.message, "error");
              }
            }}
          >
            保存负载
          </Btn>
        }
      />
      <Panel
        title="负载配置"
        sub="推理服务用于规划评估，通信画像和矩阵可用于链路诊断。"
        action={
          <div className="segmented">
            {[
              ["service", "推理服务"],
              ["profile", "通信画像"],
              ["matrix", "通信矩阵"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={w.mode === key ? "selected" : ""}
                onClick={() =>
                  update(
                    key === "service" && !w.services
                      ? {
                          mode: key,
                          seconds: 5,
                          services: [
                            serviceProfile(
                              Object.keys(names.display.domains).at(-1),
                            ),
                          ],
                        }
                      : { mode: key },
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="panel-body">
          {w.mode === "service" ? (
            <ServiceLoad workload={w} update={update} names={names} />
          ) : (
            <>
              <div className="form-top">
                <Field
                  label="负载观测窗口"
                  value={w.duration}
                  suffix="ms"
                  min={10}
                  max={400}
                  onChange={(duration) => update({ duration })}
                />
                <Btn icon={Braces} onClick={preview}>
                  生成通信预览
                </Btn>
              </div>
              {w.mode === "profile" ? (
                <>
                  <div className="form-grid two">
                    {w.profiles.map((p, i) => (
                      <section key={i} className="inner-card">
                        <div className="inner-head">
                          <Badge>
                            {names.domain(p.domain)} · 画像 {i + 1}
                          </Badge>
                          <button
                            className="icon-btn"
                            aria-label="移除画像"
                            disabled={w.profiles.length === 1}
                            onClick={() =>
                              update({
                                profiles: w.profiles.filter((_, j) => j !== i),
                              })
                            }
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="form-grid three">
                          <Select
                            label="网络域"
                            value={p.domain}
                            options={Object.entries(names.display.domains)}
                            onChange={(domain) =>
                              update({
                                profiles: w.profiles.map((x, j) =>
                                  j === i ? { ...x, domain } : x,
                                ),
                              })
                            }
                          />
                          {profileFields.map(([key, label, type, suffix]) => (
                            <Field
                              key={key}
                              label={label}
                              type={type}
                              suffix={suffix}
                              step={key === "messageMB" ? 0.1 : 1}
                              value={p[key]}
                              onChange={(value) =>
                                update({
                                  profiles: w.profiles.map((x, j) =>
                                    j === i ? { ...x, [key]: value } : x,
                                  ),
                                })
                              }
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                  <div className="form-top">
                    <Btn
                      icon={Plus}
                      disabled={w.profiles.length >= 8}
                      onClick={() =>
                        update({
                          profiles: [
                            ...w.profiles,
                            {
                              ...clone(
                                w.profiles.at(-1) ?? {
                                  ...seed.workload.profiles[0],
                                  domain: Object.keys(names.display.domains)[0],
                                },
                              ),
                              model: "新业务画像",
                            },
                          ],
                        })
                      }
                    >
                      添加业务画像
                    </Btn>
                  </div>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>CSV / TSV 端点通信记录</span>
                    <textarea
                      value={w.matrix}
                      onChange={(e) => update({ matrix: e.target.value })}
                      rows={8}
                      spellCheck={false}
                    />
                  </label>
                  <div className="form-top">
                    <label className="btn">
                      <Upload size={16} />
                      导入 CSV / TSV
                      <input
                        hidden
                        type="file"
                        accept=".csv,.tsv,.txt"
                        onChange={async (e) => {
                          const f = e.target.files[0];
                          if (f)
                            update({
                              matrix: project.config.model
                                ? await f.text()
                                : normalizeMatrix(await f.text()),
                            });
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <span className="muted">
                      列顺序为发送时间、源端点、目的端点、单消息
                      MB、并发、类型。
                    </span>
                  </div>
                </>
              )}
              {error && (
                <div className="notice">
                  <TriangleAlert size={15} />
                  {error}
                </div>
              )}
              {matrix && (
                <>
                  <div className="form-top">
                    <Badge>{matrix.length} 个通信批次</Badge>
                    <Btn
                      icon={ArrowDownToLine}
                      onClick={() =>
                        download(
                          "通信矩阵.csv",
                          csv([
                            [
                              "时间ms",
                              "源端点",
                              "目的端点",
                              "消息MB",
                              "并发",
                              "类型",
                            ],
                            ...matrix.map((f) => [
                              f.time,
                              f.src,
                              f.dst,
                              f.mb,
                              f.parallel,
                              f.type,
                            ]),
                          ]),
                          "text/csv",
                        )
                      }
                    >
                      导出矩阵
                    </Btn>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {[
                            "时间 ms",
                            "源端点",
                            "目的端点",
                            "消息 MB",
                            "并发",
                            "类型",
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.slice(0, 10).map((f, i) => (
                          <tr key={i}>
                            {[
                              f.time,
                              f.src,
                              f.dst,
                              format(f.mb, 2),
                              f.parallel,
                              f.type,
                            ].map((v, j) => (
                              <td key={j}>{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
          {w.mode === "service" && error && (
            <div className="notice">{error}</div>
          )}
        </div>
      </Panel>
      <Panel
        title="性能目标与可靠性约束"
        sub={
          w.mode === "service"
            ? "推理目标按各服务校验，此处配置物理容量与可靠性约束。"
            : "容量、有效吞吐及 IOPS 按域校验。时延取两域的最大 P99。"
        }
      >
        <div className="panel-body">
          <div className="form-grid four">
            {project.config.model ? (
              <>
                <Field
                  label="最大链路利用率"
                  suffix="%"
                  value={limits.util ?? 100}
                  min={0}
                  max={100}
                  onChange={(util) => patch({ limits: { ...limits, util } })}
                />
                {Object.entries(names.display.domains).flatMap(([id, title]) =>
                  [
                    ["pb", "容量", "PB"],
                    ["gbps", "有效吞吐", "GB/s"],
                    ["iops", "完成 IOPS", "IOPS"],
                  ].map(([key, label, unit]) => (
                    <Field
                      key={id + key}
                      label={title + " " + label}
                      suffix={unit}
                      value={limits.clusters?.[id]?.[key]}
                      min={0}
                      step={0.1}
                      onChange={(value) =>
                        patch({
                          limits: {
                            ...limits,
                            clusters: {
                              ...limits.clusters,
                              [id]: {
                                ...limits.clusters?.[id],
                                [key]: value === "" ? undefined : value,
                              },
                            },
                          },
                        })
                      }
                    />
                  )),
                )}
              </>
            ) : (
              LIMITS.filter(
                ([key]) =>
                  w.mode !== "service" || key.endsWith("PB") || key === "util",
              ).map(([key, label, suffix]) => (
                <Field
                  key={key}
                  label={names.label(label)}
                  suffix={suffix}
                  value={limits[key]}
                  min={0}
                  step={0.1}
                  onChange={(value) =>
                    patch({ limits: { ...limits, [key]: value } })
                  }
                />
              ))
            )}
          </div>
          {(!project.config.model ||
            project.config.model.faultDevices?.length > 0) && (
            <label className="checkline">
              <input
                type="checkbox"
                checked={!!limits.fault}
                onChange={(e) =>
                  patch({ limits: { ...limits, fault: e.target.checked } })
                }
              />{" "}
              候选必须同时通过
              {project.config.model ? "已配置的交换机故障" : " SP01 故障"}场景
            </label>
          )}
        </div>
      </Panel>
    </>
  );
}
const groups = [
  [
    "Clos 网络",
    "spines spinePorts uplinkGbps accessGbps leafPorts domain01Uplinks uplinks domain01Leaves domain02Leaves computeNodesPerLeaf",
  ],
  [
    "存量与新增资源",
    "domain01StorageLeaves reuseInventory reuseLeaves newLeaves domain01Nodes sharedNodes newNodes domain01StoragePB sharedPB nodePB",
  ],
  ["存储性能画像", "readGBps writeGBps nodeIOPS deviceMs"],
  ["设备与部署单价", "leafCost reuseCost portCost storageCost spineCost"],
];
function uplinkCountLabel(config) {
  const counts = targetUplinkCounts(config);
  return counts.length > 1
    ? counts[0] + "–" + counts.at(-1)
    : String(counts[0] ?? 0);
}

function DimensionControl({ dimension, project, updateSearch }) {
  if (
    !dimension ||
    !project ||
    !updateSearch ||
    (dimension.inventory && !project.config.reuseInventory)
  )
    return null;
  const enabled = searchEnabled(project.search, project.config, dimension);
  const label = dimension.label;
  let error = null;
  if (enabled) {
    try {
      dimensionValues(project.config, project.search, dimension);
    } catch (issue) {
      error = issue.message;
    }
  }
  return (
    <div className="dimension-control">
      <label className="checkline">
        <input
          type="checkbox"
          aria-label={"允许调整" + label}
          checked={enabled}
          onChange={(event) =>
            updateSearch({
              enabled: {
                ...project.search.enabled,
                [dimension.key]: event.target.checked,
              },
            })
          }
        />
        允许调整
      </label>
      {enabled && (
        <Field
          label={label + "候选值"}
          type="text"
          value={
            project.search[dimension.key] ?? project.config[dimension.field]
          }
          onChange={(value) => updateSearch({ [dimension.key]: value })}
        />
      )}
      {error && (
        <small className="dimension-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

function ConfigFields({ config, update, keys, project, updateSearch }) {
  const names = useProjectNames();
  return (
    <div className="form-grid three">
      {hardware
        .filter(([key]) => keys.includes(key))
        .map(([key, label, unit, min, max, step]) => {
          const dimension = NETWORK_DIMENSIONS.find(
            (entry) => entry.field === key,
          );
          return (
            <div
              key={key}
              className={
                dimension && updateSearch ? "resource-parameter" : undefined
              }
            >
              <Field
                label={names.label(label)}
                value={config[key]}
                suffix={unit}
                min={min}
                max={max}
                step={step}
                onChange={(value) => update({ [key]: value })}
              />
              {key === "uplinks" && project?.config.connections && (
                <small className="muted">
                  实际上联 {uplinkCountLabel(config)} 条 / Leaf
                </small>
              )}
              <DimensionControl
                dimension={dimension}
                project={project}
                updateSearch={updateSearch}
              />
            </div>
          );
        })}
    </div>
  );
}
function TopologyView({ graph, capacities, domain, setDomain, onSelect }) {
  const names = useProjectNames();
  const devices = graph.devices.filter((device) => device.plane === domain);
  const uplinks = graph.links.filter(
    (link) => link.plane === domain && link.type === "上联",
  );
  const endpoints = Object.values(graph.endpoints).filter(
    (endpoint) => endpoint.plane === domain,
  );
  const sets = [
    {
      title: "Spine 交换层",
      count: devices.filter((d) => d.type === "Spine").length,
      y: 76,
      x: 380,
      width: 320,
      Icon: Server,
      color: "#2b65e8",
      label: uplinks.reduce((sum, link) => sum + link.ports, 0) + " 条物理上联",
      group: "Clos 网络",
    },
  ];
  const branches = [
    { name: "计算", kind: "C", x: 174, Icon: Boxes, color: "#315ee5" },
    { name: "存储", kind: "S", x: 586, Icon: Database, color: "#159988" },
  ].map(({ name, kind, x, Icon, color }) => {
    const ids = new Set(
      devices
        .filter((device) => device.type === name + " Leaf")
        .map((device) => device.id),
    );
    const nodes = endpoints
      .filter((endpoint) => endpoint.kind === kind)
      .reduce((total, endpoint) => total + endpoint.nodes, 0);
    const ports = uplinks
      .filter((link) => ids.has(link.a))
      .reduce((sum, link) => sum + link.ports, 0);
    const group = kind === "S" ? "存量与新增资源" : "Clos 网络";
    if (ids.size)
      sets.push({
        title: name + " Leaf",
        count: ids.size,
        y: 191,
        x,
        width: 264,
        Icon: Network,
        color,
        label: ports + " 条物理上联",
        group,
      });
    if (nodes)
      sets.push({
        title: name + "资源池",
        count: nodes,
        y: 318,
        x,
        width: 264,
        Icon,
        color,
        label:
          kind === "S" ? capacities[domain] + " PB 可用容量" : "已接入计算节点",
        group,
      });
    return { x, ports, nodes };
  });
  const roleCounts = Object.keys(ROLE_STYLE).map((role) => [
    role,
    devices.filter((device) => device.role === role).length,
  ]);
  return (
    <div className="topology">
      <div className="topology-controls">
        <div className="segmented">
          {Object.keys(graph.planes).map((d) => (
            <button
              key={d}
              className={d === domain ? "selected" : ""}
              onClick={() => setDomain?.(d)}
            >
              {names.domain(d)}
            </button>
          ))}
        </div>
        <span>
          <span className="dot green" /> Clos 拓扑
        </span>
      </div>
      <svg
        viewBox="0 0 760 392"
        role="img"
        aria-label={names.domain(domain) + " 网络拓扑及资源池"}
      >
        <defs>
          <marker
            id="top-arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6" fill="none" stroke="#9fb5e0" />
          </marker>
        </defs>
        {branches
          .filter(({ ports }) => ports > 0)
          .map(({ x }) => (
            <path
              key={x}
              d={"M 380 120 C 380 144 " + x + " 143 " + x + " 168"}
              fill="none"
              stroke={x === 174 ? "#96b4f5" : "#82cbbb"}
              strokeWidth="2"
            />
          ))}
        {branches
          .filter(({ nodes }) => nodes > 0)
          .map(({ x }) => (
            <path
              key={x}
              d={"M " + x + " 235 V 289"}
              fill="none"
              stroke="#9fb5e0"
              strokeDasharray="5 4"
              markerEnd="url(#top-arrow)"
            />
          ))}
        {sets.map((n) => (
          <g
            key={n.title}
            className={onSelect ? "topo-node" : undefined}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={n.title}
            onClick={() => onSelect?.(n.group)}
            onKeyDown={(event) => {
              if (onSelect && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onSelect(n.group);
              }
            }}
          >
            <rect
              x={n.x - n.width / 2}
              y={n.y - 23}
              rx="12"
              width={n.width}
              height="67"
              fill="white"
              stroke={n.color}
              strokeOpacity=".29"
            />
            <rect
              x={n.x - n.width / 2 + 14}
              y={n.y - 9}
              rx="9"
              width="39"
              height="39"
              fill={n.color}
              fillOpacity=".1"
            />
            <n.Icon
              x={n.x - n.width / 2 + 23}
              y={n.y}
              width="21"
              height="21"
              color={n.color}
            />
            <text x={n.x - n.width / 2 + 65} y={n.y + 3} className="topo-title">
              {n.title}
            </text>
            <text x={n.x - n.width / 2 + 65} y={n.y + 23} className="topo-desc">
              {n.label}
            </text>
            <text
              x={n.x + n.width / 2 - 17}
              y={n.y + 15}
              textAnchor="end"
              className="topo-count"
              fill={n.color}
            >
              {n.count}
            </text>
          </g>
        ))}
      </svg>
      <div className="topology-roles" aria-label="设备状态汇总">
        <span>设备状态</span>
        {roleCounts
          .filter(([, count]) => count > 0)
          .map(([role, count]) => (
            <Badge key={role} tone={ROLE_STYLE[role]}>
              {names.role(role)} {count} 台
            </Badge>
          ))}
      </div>
    </div>
  );
}
function ResourcesPage({ project, patch, notify, evaluate }) {
  const names = useProjectNames();
  const [displayDraft, setDisplayDraft] = useState(null);
  const [tab, setTab] = useState("拓扑工作台");
  const [domain, setDomain] = useState("D02");
  const [group, setGroup] = useState(groups[0][0]);
  const [check, setCheck] = useState(false);
  const [template, setTemplate] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const { config } = project;
  const updateSearch = (change) =>
    patch({ search: { ...project.search, ...change } });
  const enabledCount = NETWORK_DIMENSIONS.filter((dimension) =>
    searchEnabled(project.search, config, dimension),
  ).length;
  const issues = useMemo(() => validate(config), [config]);
  const graph = useMemo(
    () => (issues.length ? null : topology(config)),
    [config, issues],
  );
  const update = (diff) => {
    patch({ config: { ...config, ...diff } });
    setCheck(false);
  };
  function adopt(model, bundle = {}) {
    inspectModel(model);
    const next = { model };
    const topologyGraph = topology(next);
    const current = project.config.model ? project.workload : null;
    const defaultServices = Object.entries(topologyGraph.planes)
      .filter(([, endpoints]) => endpoints.C.length)
      .map(([domain, endpoints]) => ({
        ...serviceProfile(domain),
        instances: Math.min(
          8,
          endpoints.C.reduce(
            (count, id) => count + topologyGraph.endpoints[id].nodes,
            0,
          ),
        ),
      }));
    const workload = bundle.workload ??
      current ?? {
        ...project.workload,
        mode: "service",
        seconds: 5,
        services: defaultServices,
        profiles: defaultServices.map(({ domain, instances }) => ({
          ...seed.workload.profiles[0],
          domain,
          instances,
          model: "通信画像",
        })),
        matrix: "时间ms,源端点,目的端点,消息MB,并发,类型,集群",
      };
    const limits = bundle.limits ?? (current ? project.limits : { util: 100 });
    const search =
      bundle.search ??
      (current ? project.search : { objective: "cost", object: {} });
    const nextLimits = {
      ...limits,
      fault: !!(limits.fault && model.faultDevices?.length),
    };
    validateLimits(next, nextLimits);
    patch({ config: next, workload, limits: nextLimits, search });
    notify("对象拓扑已校验并保存");
  }
  const importFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setFileBusy(true);
    try {
      let values;
      let importedDisplay;
      if (/\.xlsx?$/i.test(file.name)) {
        const x = await import("xlsx");
        const b = x.read(await file.arrayBuffer(), { type: "array" });
        if (
          b.Sheets.Clusters ||
          b.Sheets.Models ||
          b.Sheets.Devices ||
          b.Sheets.Ports
        ) {
          adopt(readObjectWorkbook(x, b));
          return;
        }
        const rows = x.utils.sheet_to_json(b.Sheets[b.SheetNames[0]], {
          header: 1,
          blankrows: false,
        });
        values = Object.fromEntries(
          rows
            .filter((r) => r.length >= 2 && r[0] !== "字段" && r[0] !== "key")
            .map((r) => [String(r[0]).trim(), r[1]]),
        );
        if (b.Sheets.Links) {
          values.connections = x.utils.sheet_to_json(b.Sheets.Links);
          values.connectionDomains = ["D01", "D02"];
        }
        if (b.Sheets.Attachments)
          values.attachments = x.utils.sheet_to_json(b.Sheets.Attachments);
        if (b.Sheets.Display) {
          const rows = x.utils.sheet_to_json(b.Sheets.Display);
          const { assigned, ...domains } = Object.fromEntries(
            rows.map(({ key, value }) => [key, value]),
          );
          importedDisplay = { domains, assigned };
        }
      } else {
        const raw = JSON.parse(
          await file.text().then((s) => s.replace(/^\uFEFF/, "")),
        );
        const explicit =
          raw.model ??
          raw.config?.model ??
          (raw.version && raw.devices ? raw : null);
        if (explicit) {
          adopt(explicit, raw);
          return;
        }
        values = raw.config ?? raw;
        importedDisplay = raw.display;
      }
      if (config.model)
        throw Error("此项目使用对象拓扑，请导入对象拓扑 JSON 或 Excel");
      values = normalizeNetworkData(values);
      const imported = readDisplay(
        normalizeNetworkData(importedDisplay),
        names.display,
      );
      const known = new Set([
        ...hardware.map(([key]) => key),
        "distribution",
        "connections",
        "connectionDomains",
        "attachments",
      ]);
      const entries = Object.entries(values).filter(([key]) => known.has(key));
      if (!entries.length && !imported)
        throw Error("未识别到 Clos 配置字段，请下载导入样表");
      const cfg = {
        ...config,
        ...("connections" in values ? { connectionDomains: undefined } : {}),
        ...Object.fromEntries(
          entries.map(([key, v]) => [
            key,
            [
              "distribution",
              "connections",
              "connectionDomains",
              "attachments",
            ].includes(key)
              ? v
              : Number(v),
          ]),
        ),
      };
      const errors = validate(cfg);
      if (errors.length) throw Error(errors.slice(0, 3).join("；"));
      patch({ config: cfg, ...(imported ? { display: imported } : {}) });
      setCheck(true);
      notify("拓扑配置已导入并保存");
    } catch (error) {
      notify("导入失败：" + error.message, "error");
    } finally {
      setFileBusy(false);
    }
  };
  const exportWorkbook = async () => {
    try {
      const x = await import("xlsx");
      const book = x.utils.book_new();
      x.utils.book_append_sheet(
        book,
        x.utils.aoa_to_sheet([
          ["key", "value"],
          ...hardware.map(([key]) => [key, config[key]]),
          ["distribution", config.distribution],
        ]),
        "Config",
      );
      if (graph) {
        x.utils.book_append_sheet(
          book,
          x.utils.json_to_sheet(
            graph.links
              .filter((l) => l.type === "上联")
              .map((l) => ({ leaf: l.a, spine: l.b, ports: l.ports })),
          ),
          "Links",
        );
        x.utils.book_append_sheet(
          book,
          x.utils.json_to_sheet(
            Object.values(graph.endpoints).map((e) => ({
              endpoint: e.name,
              nodes: e.nodes,
            })),
          ),
          "Attachments",
        );
      }
      x.utils.book_append_sheet(
        book,
        x.utils.aoa_to_sheet([
          ["key", "value"],
          ...Object.entries(names.display.domains),
          ["assigned", names.display.assigned],
        ]),
        "Display",
      );
      x.writeFile(book, "Clos-拓扑配置.xlsx");
    } catch (e) {
      notify(e.message, "error");
    }
  };
  if (config.model && graph)
    return (
      <ObjectResources
        project={project}
        graph={graph}
        adopt={adopt}
        patch={patch}
        notify={notify}
        download={download}
        importFile={importFile}
        fileBusy={fileBusy}
        evaluate={evaluate}
      />
    );
  return (
    <>
      <Heading
        tag="02 / NETWORK MODEL"
        title="资源与网络建模"
        description="编辑设备、端口和资源池，检查网络连接与物理容量。"
        actions={
          <>
            <Btn onClick={evaluate}>
              进入评估工作台 <ArrowRight size={15} />
            </Btn>
            <label className="btn">
              <Upload size={16} />
              {fileBusy ? "导入中…" : "批量导入"}
              <input
                type="file"
                accept=".json,.xlsx,.xls"
                onChange={importFile}
                disabled={fileBusy}
                hidden
              />
            </label>
            <Btn
              primary
              icon={Check}
              onClick={() => {
                setCheck(true);
                notify(
                  issues.length ? "配置存在待修正项" : "拓扑配置已保存",
                  issues.length ? "error" : undefined,
                );
              }}
            >
              校验并保存
            </Btn>
          </>
        }
      />
      <div className="module-tabs">
        {["拓扑工作台", "设备清单", "连接关系", "存储画像与成本"].map((t) => (
          <button
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {check && (
        <div className={"notice " + (!issues.length ? "positive" : "")}>
          {issues.length ? (
            <TriangleAlert size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}{" "}
          {issues.length
            ? names.label(issues.slice(0, 4).join("；"))
            : "物理端口、资源池与 Clos 接入约束校验通过"}
        </div>
      )}
      {tab === "拓扑工作台" && (
        <div className="resource-grid">
          <Panel
            title="网络拓扑画布"
            sub="按资源类型聚合 · 物理上联数来自当前连接模型"
            action={
              <div className="actions">
                <Btn
                  icon={Settings2}
                  onClick={() => setDisplayDraft(clone(names.display))}
                >
                  展示设置
                </Btn>
                <Btn icon={GitFork} onClick={() => setTemplate(true)}>
                  生成 Clos
                </Btn>
              </div>
            }
          >
            {graph ? (
              <TopologyView
                graph={graph}
                capacities={capacity(config)}
                domain={domain}
                setDomain={setDomain}
                onSelect={setGroup}
              />
            ) : (
              <Empty
                icon={Network}
                title="拓扑配置待修正"
                detail={names.label(issues[0])}
              />
            )}
            <div className="topo-footer">
              <Btn icon={FileDown} onClick={exportWorkbook}>
                下载 Excel 样表
              </Btn>
              <Btn
                icon={Braces}
                onClick={() =>
                  download(
                    "Clos-拓扑配置.json",
                    JSON.stringify({ config, display: names.display }, null, 2),
                    "application/json",
                  )
                }
              >
                导出 JSON
              </Btn>
            </div>
          </Panel>
          <Panel
            title="对象属性"
            icon={Settings2}
            sub={
              "当前值用于基线，候选范围单独保存 · 已开放 " +
              enabledCount +
              " 个维度"
            }
          >
            <div className="panel-body side-fields">
              <Select
                label="属性分组"
                value={group}
                options={groups.map((g) => g[0])}
                onChange={setGroup}
              />
              <ConfigFields
                config={config}
                update={update}
                keys={groups.find((g) => g[0] === group)[1].split(" ")}
                project={project}
                updateSearch={updateSearch}
              />
              {group === "存量与新增资源" && (
                <div className="resource-parameter resource-distribution">
                  <Select
                    label="接入与流量分布"
                    value={config.distribution}
                    options={["集中", "均衡"]}
                    onChange={(distribution) =>
                      update({ distribution, attachments: undefined })
                    }
                  />
                  <DimensionControl
                    dimension={NETWORK_DIMENSIONS.find(
                      (entry) => entry.field === "distribution",
                    )}
                    project={project}
                    updateSearch={updateSearch}
                  />
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
      {tab === "设备清单" && (
        <Panel
          title="设备清单"
          sub="设备类型与资产状态分开记录，沿用设备的标签可在展示设置中命名。"
          action={<Badge>{graph?.devices.length ?? 0} 台</Badge>}
        >
          {graph ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      "设备编号",
                      "网络域",
                      "类型",
                      "生命周期",
                      "物理端口",
                      "接入节点",
                    ].map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {graph.devices.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <b>{d.id}</b>
                      </td>
                      <td>{names.domain(d.plane)}</td>
                      <td>{d.type}</td>
                      <td>
                        <Badge tone={ROLE_STYLE[d.role]}>
                          {names.role(d.role)}
                        </Badge>
                      </td>
                      <td>{d.ports}</td>
                      <td>{d.nodes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="配置待校验" detail={names.label(issues[0])} />
          )}
        </Panel>
      )}
      {tab === "连接关系" && (
        <Panel
          title="物理连接与端口"
          sub="可从 Excel 的 Links 和 Attachments 表批量修改连接及接入关系。"
          action={
            <>
              <Btn icon={FileDown} onClick={exportWorkbook}>
                导出连接
              </Btn>
              {(config.connections || config.attachments) && (
                <Btn
                  onClick={() =>
                    update({
                      connections: undefined,
                      connectionDomains: undefined,
                      attachments: undefined,
                    })
                  }
                >
                  恢复模板连接
                </Btn>
              )}
            </>
          }
        >
          {graph ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      "源设备",
                      "目标设备",
                      "网络域",
                      "类型",
                      "物理端口",
                      "总带宽",
                    ].map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {graph.links
                    .filter((l) => l.ports > 0)
                    .map((l) => (
                      <tr key={l.id}>
                        <td>{l.a}</td>
                        <td>{l.b}</td>
                        <td>{names.domain(l.plane)}</td>
                        <td>{l.type}</td>
                        <td>{l.ports}</td>
                        <td>{l.gbps} Gbps</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="配置待校验" detail={names.label(issues[0])} />
          )}
        </Panel>
      )}
      {tab === "存储画像与成本" && (
        <div className="form-grid two">
          {groups.slice(2).map(([name, keys]) => (
            <Panel key={name} title={name}>
              <div className="panel-body">
                <ConfigFields
                  config={config}
                  update={update}
                  keys={keys.split(" ")}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
      {displayDraft && (
        <Modal title="拓扑展示设置" close={() => setDisplayDraft(null)}>
          <form
            className="modal-body new-form"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                patch({ display: readDisplay(displayDraft, names.display) });
                setDisplayDraft(null);
                notify("项目展示设置已保存");
              } catch (error) {
                notify(error.message, "error");
              }
            }}
          >
            <p>名称随项目保存。设备和端点编号可继续用于导入与复跑。</p>
            {Object.entries(displayDraft.domains).map(([id, value], index) => (
              <Field
                key={id}
                label={"网络域 " + (index + 1) + " 名称"}
                type="text"
                value={value}
                onChange={(name) =>
                  setDisplayDraft({
                    ...displayDraft,
                    domains: {
                      ...displayDraft.domains,
                      [id]: name.slice(0, 24),
                    },
                  })
                }
              />
            ))}
            <Field
              label="沿用设备的标签"
              type="text"
              value={displayDraft.assigned}
              onChange={(value) =>
                setDisplayDraft({
                  ...displayDraft,
                  assigned: value.slice(0, 12),
                })
              }
            />
            <div className="actions end">
              <Btn primary type="submit" icon={Check}>
                保存展示设置
              </Btn>
            </div>
          </form>
        </Modal>
      )}
      {template && (
        <Modal title="从标准 Clos 模板生成" close={() => setTemplate(false)}>
          <div className="modal-body">
            <p>
              生成双网络域两级 Clos。使用当前配置中的设备数量和端口档位，重建
              Leaf 到 Spine 的连接和资源池接入。
            </p>
            <div className="actions end">
              <Btn onClick={() => setTemplate(false)}>返回</Btn>
              <Btn
                primary
                icon={GitFork}
                onClick={() => {
                  update({
                    connections: undefined,
                    connectionDomains: undefined,
                    attachments: undefined,
                  });
                  setTemplate(false);
                  notify("Clos 模板连接已生成");
                }}
              >
                生成拓扑
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

const objectiveNames = {
  cost: "最小化新增建设成本",
  throughput: "最大化有效吞吐",
  margin: "最大化 SLO 余量",
};
const plannedConfig = (row, analysis) =>
  row.config ?? applyObjectChanges(analysis.input.config, row.changes);
const objectChangeValue = (field, value) =>
  field === "gbps" ? value + " Gbps" : value ? "启用" : "停用";
const describeChange = (change) =>
  change.id +
  " · " +
  objectChangeValue(change.field, change.current) +
  " → " +
  objectChangeValue(change.field, change.value);

function EvaluationPlans({
  project,
  view,
  currentFault,
  inspect,
  task,
  analysis,
  savePlan,
  verify,
  notify,
}) {
  const names = useProjectNames();
  const [filter, setFilter] = useState("全部候选");
  const [picked, setPicked] = useState(null);
  const data = analysis?.result;
  const stale =
    analysis &&
    (!same(analysis.input, snapshot(project)) ||
      !same(analysis.search, project.search) ||
      Boolean(analysis.fault) !== currentFault);
  const rec = data?.rows.find((r) => r.id === data.recommended);
  const objectMode = Boolean((analysis?.input.config ?? project.config).model);
  const pickedConfig =
    picked && analysis ? plannedConfig(picked, analysis) : null;
  const baseCost = cost(analysis?.input.config ?? project.config).total;
  const historyBaseline = project.history.find(
    (h) =>
      !h.plan &&
      !h.fault &&
      same(h.input, analysis?.input ?? snapshot(project)),
  );
  const baseline =
    historyBaseline ?? (data?.baseline ? { summary: data.baseline } : null);
  const serviceMode =
    (analysis?.input.workload ?? project.workload).mode === "service";
  const dimensionName = (dimension) =>
    dimension.inventory
      ? names.role("assigned") + "存储 Leaf 数"
      : dimension.label;
  const candidateValue = (dimension, cfg) =>
    (dimension.field === "uplinks"
      ? uplinkCountLabel(cfg)
      : String(cfg[dimension.field])) +
    (dimension.unit ? " " + dimension.unit : "");
  const compareThroughput = (result) =>
    result
      ? serviceMode
        ? format(result.service?.throughput) + " 请求/s"
        : format(
            objectMode ? result.throughput : result.domains.D02.throughput,
          ) + " GB/s"
      : "—";
  const compareLatency = (result) =>
    result
      ? format(serviceMode ? result.service?.p99 : result.p99, 2) + " ms"
      : "—";
  const rows = data
    ? [...data.rows]
        .filter(
          (r) =>
            filter === "全部候选" ||
            (filter === "可行方案" && r.pass) ||
            (filter === "Pareto 方案" && r.pareto),
        )
        .sort(
          (a, b) =>
            (a.id === data.recommended
              ? -1
              : b.id === data.recommended
                ? 1
                : 0) ||
            Number(!!b.pass) - Number(!!a.pass) ||
            a.cost - b.cost,
        )
    : [];
  function exportPlan(p) {
    const bill = cost(p.config);
    const graph = topology(p.config);
    const recent = project.history.find(
      (h) => !h.fault && h.plan === p.id && same(h.input, p.input),
    );
    const measured = recent?.summary ?? p.result;
    const report = [
      "# " + project.name + " · " + p.name,
      "",
      "场景：" + project.kind,
      "",
      "## 改造建议",
      "",
      ...(p.config.model
        ? p.changes?.length
          ? p.changes.map((change) => "- " + describeChange(change))
          : ["- 保留基线拓扑。"]
        : [
            ...(p.config.reuseLeaves
              ? [
                  "- " +
                    names.domain("D02") +
                    " " +
                    names.role("assigned") +
                    " " +
                    p.config.reuseLeaves +
                    " 台存储 Leaf。",
                ]
              : []),
            "- " +
              names.domain("D02") +
              " 新增 " +
              p.config.newLeaves +
              " 台存储 Leaf。",
            "- " +
              names.domain("D02") +
              " 新购 " +
              p.config.newNodes +
              " 台存储节点，新增 " +
              format(p.config.newNodes * p.config.nodePB, 2) +
              " PB。",
            "- 每 Leaf " +
              uplinkCountLabel(p.config) +
              " × " +
              p.config.uplinkGbps +
              "G 上联，采用" +
              p.config.distribution +
              "分布。",
          ]),
      "",
      "## 新增建设成本",
      "",
      ...bill.lines
        .filter((line) => line.quantity > 0)
        .map(
          (l) =>
            "- " +
            names.label(l.name) +
            "：" +
            l.quantity +
            " × " +
            l.unit +
            " 万元 = " +
            l.total +
            " 万元",
        ),
      "- 合计 " + bill.total + " 万元。同期基线 " + p.baseCost + " 万元。",
      "",
      "## 性能检查",
      "",
      ...measured.checks.map(
        (c) =>
          "- " +
          names.label(c.label) +
          "：" +
          c.value +
          " " +
          c.unit +
          "，目标 " +
          c.limit +
          " " +
          c.unit +
          "，" +
          (c.pass ? "通过" : "未通过"),
      ),
      ...(p.fault
        ? [
            "",
            "## 交换机故障校验",
            "",
            ...p.fault.checks.map(
              (c) =>
                "- " +
                names.label(c.label) +
                "：" +
                c.value +
                " " +
                c.unit +
                "，" +
                (c.pass ? "通过" : "未通过"),
            ),
          ]
        : []),
      "",
      "## 链路配置清单",
      "",
      ...graph.links
        .filter((l) => l.ports)
        .map(
          (l) =>
            "- " +
            (l.aPort ?? l.a) +
            " ↔ " +
            (l.bPort ?? l.b) +
            "：" +
            l.ports +
            " 端口，" +
            l.gbps +
            " Gbps",
        ),
    ].join("\n");
    download(p.name + "-评估报告.md", report);
  }
  return (
    <>
      {view === "results" ? (
        <>
          <div>
            <Panel
              title="候选评估"
              sub={
                data
                  ? objectiveNames[analysis.objective] +
                    (analysis.cachedBaseline ? " · 已复用基线结果" : "")
                  : "基线与候选使用同一份负载及约束"
              }
              icon={Target}
            >
              {task?.type === "search" && (
                <div className="progress-block">
                  <div>
                    <span>正在评价候选组合</span>
                    <b>
                      {task.progress?.done ?? 0} / {task.progress?.total ?? "…"}
                    </b>
                  </div>
                  <progress
                    max={task.progress?.total ?? 1}
                    value={task.progress?.done ?? 0}
                  />
                </div>
              )}
              {rec ? (
                <div className="recommend">
                  <div>
                    <Badge tone="teal">推荐 · {rec.id}</Badge>
                    <strong>
                      {format(rec.cost, 2)} <small>万元</small>
                    </strong>
                  </div>
                  {objectMode ? (
                    <p>
                      {rec.changes.length
                        ? rec.changes.map(describeChange).join("；")
                        : "保留基线拓扑"}
                    </p>
                  ) : (
                    <p>
                      {rec.config.reuseLeaves > 0 &&
                        names.role("assigned") +
                          " " +
                          rec.config.reuseLeaves +
                          " 台 Leaf · "}
                      新购 {rec.config.newNodes} 台存储 · 每 Leaf{" "}
                      {uplinkCountLabel(rec.config)} × {rec.config.uplinkGbps}G
                      · {rec.config.distribution}分布
                    </p>
                  )}
                  <div className="actions">
                    <Btn icon={Network} onClick={() => setPicked(rec)}>
                      配置与对比
                    </Btn>
                    <Btn
                      icon={Check}
                      onClick={() => {
                        savePlan(rec, analysis);
                        notify("推荐方案已保存");
                      }}
                    >
                      保存方案
                    </Btn>
                    <Btn
                      icon={Play}
                      primary
                      disabled={!!task}
                      onClick={() => inspect(rec, analysis)}
                    >
                      查看推荐诊断
                    </Btn>
                  </div>
                </div>
              ) : data ? (
                <Empty
                  icon={TriangleAlert}
                  title="无可行方案"
                  detail={
                    Object.values(data.capacityGap).every((gap) => gap == null)
                      ? "所有组合均未通过拓扑和端口校验。请查看候选拒绝原因。"
                      : Object.entries(data.capacityGap)
                          .filter(([, gap]) => gap > 0)
                          .map(
                            ([id, gap]) =>
                              names.domain(id) + " 容量缺口 " + gap + " PB",
                          )
                          .join("，") ||
                        "检查候选详情中的性能、连通性或故障约束。"
                  }
                />
              ) : (
                <Empty
                  icon={Target}
                  title="等待搜索候选方案"
                  detail="搜索先校验容量和物理端口，再进行流级仿真。"
                />
              )}
            </Panel>
          </div>
          {stale && (
            <div className="notice">
              <TriangleAlert size={16} />{" "}
              项目输入或搜索范围已变化，表格展示上次搜索快照。
            </div>
          )}
          {data && (
            <Panel
              title="候选方案对比"
              sub={`共 ${data.total} 个组合 · ${data.filtered} 个在仿真前筛除或无法运行 · ${data.feasible} 个通过`}
              action={
                <div className="segmented">
                  {["全部候选", "可行方案", "Pareto 方案"].map((t) => (
                    <button
                      key={t}
                      className={filter === t ? "selected" : ""}
                      onClick={() => setFilter(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              }
            >
              {rows.length ? (
                <div className="table-wrap candidates">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "方案",
                          ...(objectMode
                            ? ["配置变更"]
                            : [
                                "沿用 Leaf",
                                "新购存储节点",
                                "新增存储 Leaf",
                                "上联",
                                "分布",
                              ]),
                          "建设成本",
                          serviceMode
                            ? "总达标吞吐"
                            : objectMode
                              ? "总有效吞吐"
                              : names.domain("D02") + " 吞吐",
                          serviceMode ? "最差服务 P99 首 token" : "P99",
                          "校验",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="baseline-row">
                        <td>
                          <b>项目基线</b>
                        </td>
                        {objectMode ? (
                          <td>已导入基线</td>
                        ) : (
                          <>
                            <td>{analysis.input.config.reuseLeaves} 台</td>
                            <td>{analysis.input.config.newNodes} 台</td>
                            <td>{analysis.input.config.newLeaves} 台</td>
                            <td>
                              {uplinkCountLabel(analysis.input.config)} ×{" "}
                              {analysis.input.config.uplinkGbps}G
                            </td>
                            <td>{analysis.input.config.distribution}</td>
                          </>
                        )}
                        <td>{format(baseCost, 2)} 万元</td>
                        <td>{compareThroughput(baseline?.summary)}</td>
                        <td>{compareLatency(baseline?.summary)}</td>
                        <td>
                          {baseline ? (
                            <Status
                              pass={
                                baseline.summary.pass &&
                                (data.baselineFault?.pass ?? true)
                              }
                            />
                          ) : (
                            <Badge tone="gray">待仿真</Badge>
                          )}
                        </td>
                      </tr>
                      {rows.map((r) => (
                        <tr key={r.id} className={r === rec ? "highlight" : ""}>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setPicked(r)}
                            >
                              {r.id} <ChevronRight size={13} />
                            </button>
                            {r.pareto && <Badge tone="teal">Pareto</Badge>}
                          </td>
                          {objectMode ? (
                            <td className="object-changes">
                              {r.changes.length
                                ? r.changes.map(describeChange).join("；")
                                : "保留基线"}
                            </td>
                          ) : (
                            <>
                              <td>{r.config.reuseLeaves} 台</td>
                              <td>{r.config.newNodes} 台</td>
                              <td>{r.config.newLeaves} 台</td>
                              <td>
                                {uplinkCountLabel(r.config)} ×{" "}
                                {r.config.uplinkGbps}G
                              </td>
                              <td>{r.config.distribution}</td>
                            </>
                          )}
                          <td>{format(r.cost, 2)} 万元</td>
                          <td>{compareThroughput(r.result)}</td>
                          <td>{compareLatency(r.result)}</td>
                          <td>
                            <Status pass={!!r.pass}>
                              {r.pass
                                ? "通过"
                                : r.issues.length
                                  ? "已筛除"
                                  : "未达标"}
                            </Status>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="没有符合此筛选条件的方案"
                  detail="切换到全部候选查看失败原因。"
                />
              )}
            </Panel>
          )}
        </>
      ) : (
        <Panel title="已保存方案" sub="方案保存设备配置、搜索时的负载与约束。">
          <div className="panel-body">
            {project.plans.length ? (
              project.plans.map((p) => (
                <div className="asset-row" key={p.id}>
                  <div className="module-icon">
                    <GitFork size={18} />
                  </div>
                  <div>
                    <strong>{p.name}</strong>
                    <p>
                      {format(cost(p.config).total, 2)} 万元 · {stamp(p.time)} ·{" "}
                      {p.config.model
                        ? "对象拓扑"
                        : p.config.distribution + "分布"}
                    </p>
                  </div>
                  <div className="actions">
                    <Btn
                      icon={Play}
                      disabled={!!task}
                      onClick={() => verify(p)}
                    >
                      仿真复核
                    </Btn>
                    <Btn
                      icon={Braces}
                      onClick={() =>
                        download(
                          p.name + ".json",
                          JSON.stringify(p, null, 2),
                          "application/json",
                        )
                      }
                    >
                      方案 JSON
                    </Btn>
                    <Btn
                      icon={DownloadIcon}
                      onClick={() => {
                        const g = topology(p.config);
                        download(
                          p.name + "-配置清单.csv",
                          csv([
                            [
                              "对象",
                              "编号 / 源",
                              "网络域 / 目标",
                              "类型",
                              "角色",
                              "端口数",
                              "链路 Gbps",
                            ],
                            ...g.devices.map((d) => [
                              "设备",
                              d.id,
                              names.domain(d.plane),
                              d.modelName
                                ? d.type + " · " + d.modelName
                                : d.type,
                              names.role(d.state ?? d.role),
                              d.ports,
                              "",
                            ]),
                            ...g.links
                              .filter((l) => l.ports)
                              .map((l) => [
                                "链路",
                                l.aPort ?? l.a,
                                l.bPort ?? l.b,
                                l.type,
                                "",
                                l.ports,
                                l.gbps,
                              ]),
                          ]),
                          "text/csv",
                        );
                      }}
                    >
                      配置清单
                    </Btn>
                    <Btn primary icon={FileDown} onClick={() => exportPlan(p)}>
                      评估报告
                    </Btn>
                  </div>
                </div>
              ))
            ) : (
              <Empty
                icon={GitFork}
                title="尚无方案版本"
                detail="完成寻优后，在推荐方案或候选详情中保存一个版本。"
              />
            )}
          </div>
        </Panel>
      )}
      {picked && (
        <Modal title={picked.id + " · 方案详情"} close={() => setPicked(null)}>
          <div className="modal-body">
            <div className="actions">
              <Status pass={!!picked.pass} />
              <Badge>{format(picked.cost, 2)} 万元</Badge>
              <Badge tone="gray">
                较基线 {picked.cost - baseCost >= 0 ? "+" : ""}
                {format(picked.cost - baseCost, 2)} 万元
              </Badge>
            </div>
            {objectMode ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>对象</th>
                      <th>参数</th>
                      <th>基线</th>
                      <th>候选</th>
                    </tr>
                  </thead>
                  <tbody>
                    {picked.changes.map((change) => (
                      <tr
                        key={
                          change.collection +
                          "/" +
                          change.id +
                          "/" +
                          change.field
                        }
                      >
                        <td>{change.id}</td>
                        <td>
                          {change.field === "gbps" ? "链路速率" : "启用状态"}
                        </td>
                        <td>
                          {objectChangeValue(change.field, change.current)}
                        </td>
                        <td>{objectChangeValue(change.field, change.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!picked.changes.length && <p>此候选沿用基线配置。</p>}
              </div>
            ) : (
              <>
                <p>
                  {picked.config.reuseLeaves > 0 &&
                    names.role("assigned") +
                      " " +
                      picked.config.reuseLeaves +
                      " 台 Leaf，"}
                  新增 {picked.config.newLeaves} 台 Leaf，新购{" "}
                  {picked.config.newNodes} 台存储节点，采用{" "}
                  {uplinkCountLabel(picked.config)} × {picked.config.uplinkGbps}
                  G 上联。
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>网络维度</th>
                        <th>基线值</th>
                        <th>候选值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {NETWORK_DIMENSIONS.filter(
                        (dimension) =>
                          picked.config[dimension.field] !==
                          analysis.input.config[dimension.field],
                      ).map((dimension) => (
                        <tr key={dimension.key}>
                          <td>{dimensionName(dimension)}</td>
                          <td>
                            {candidateValue(dimension, analysis.input.config)}
                          </td>
                          <td>
                            <b>{candidateValue(dimension, picked.config)}</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {picked.issues.map((x) => (
              <div className="notice" key={x}>
                <TriangleAlert size={15} />
                {names.label(x)}
              </div>
            ))}
            {picked.result && (
              <>
                <div className="mini-topology">
                  {objectMode ? (
                    <ObjectGraphView graph={topology(pickedConfig)} />
                  ) : (
                    <TopologyView
                      graph={topology(pickedConfig)}
                      capacities={capacity(pickedConfig)}
                      domain="D02"
                    />
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>指标</th>
                        <th>基线</th>
                        <th>正常</th>
                        {picked.fault && <th>故障</th>}
                        <th>目标</th>
                      </tr>
                    </thead>
                    <tbody>
                      {picked.result.checks.map((c) => (
                        <tr key={c.key}>
                          <td>{names.label(c.label)}</td>
                          <td>
                            {baseline
                              ? format(
                                  baseline.summary.checks.find(
                                    (check) => check.key === c.key,
                                  )?.value,
                                  3,
                                )
                              : "—"}
                          </td>
                          <td>
                            <Status pass={c.pass}>{format(c.value, 3)}</Status>
                          </td>
                          {picked.fault && (
                            <td>
                              <Status
                                pass={
                                  picked.fault.checks.find(
                                    (check) => check.key === c.key,
                                  )?.pass
                                }
                              >
                                {format(
                                  picked.fault.checks.find(
                                    (check) => check.key === c.key,
                                  )?.value,
                                  3,
                                )}
                              </Status>
                            </td>
                          )}
                          <td>
                            {c.limit} {c.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="actions end">
                  <Btn
                    icon={Check}
                    onClick={() => {
                      savePlan(picked, analysis);
                      notify("候选方案已保存");
                    }}
                  >
                    保存方案
                  </Btn>
                  <Btn
                    primary
                    icon={Play}
                    disabled={!!task}
                    onClick={() => {
                      setPicked(null);
                      inspect(picked, analysis);
                    }}
                  >
                    查看候选诊断
                  </Btn>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
const DownloadIcon = ArrowDownToLine;
function App() {
  const [db, setDb] = useState(load);
  const pageFromHash = () =>
    location.hash === "#planning" ? "simulation" : location.hash.slice(1);
  const [page, setPage] = useState(() =>
    MODULES.some((m) => m[0] === pageFromHash()) ? pageFromHash() : "projects",
  );
  const [task, setTask] = useState(null);
  const [result, setResult] = useState(null);
  const [details, setDetails] = useState(null);
  const [plan, setPlan] = useState("");
  const [previewPlan, setPreviewPlan] = useState(null);
  const [workbenchTab, setWorkbenchTab] = useState("results");
  const [fault, setFault] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("通用网络规划");
  const [starter, setStarter] = useState("objects");
  const worker = useRef(null);
  const notified = useRef(null);
  const p = db.projects.find((x) => x.id === db.active) ?? db.projects[0];
  const currentPlan =
    previewPlan?.id === plan ? previewPlan : p.plans.find((x) => x.id === plan);
  const selectedModel = (currentPlan?.input.config ?? p.config).model;
  useEffect(() => {
    if (selectedModel && !selectedModel.faultDevices?.length) setFault(false);
  }, [selectedModel]);
  const notify = (message, type = "ok") => {
    clearTimeout(notified.current);
    setToast({ message, type });
    notified.current = setTimeout(() => setToast(null), 4600);
  };
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(db));
    } catch {
      setToast({
        message: "浏览器存储已满，当前修改仅保留在本次会话。",
        type: "error",
      });
    }
  }, [db]);
  useEffect(() => {
    const sync = () => {
      const slug = pageFromHash();
      if (MODULES.some((m) => m[0] === slug)) setPage(slug);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const changePage = (slug) => {
    setPage(slug);
    location.hash = slug;
    setMenu(false);
    window.scrollTo(0, 0);
  };
  const patchFor = (id, values) =>
    setDb((prev) => ({
      ...prev,
      projects: prev.projects.map((item) =>
        item.id === id
          ? {
              ...item,
              ...(typeof values === "function" ? values(item) : values),
            }
          : item,
      ),
    }));
  const patch = (values) => patchFor(p.id, values);
  function abort() {
    worker.current?.terminate();
    worker.current = null;
    setTask(null);
  }
  function open(id) {
    abort();
    setDb((prev) => ({ ...prev, active: id }));
    setResult(null);
    setPlan("");
    setPreviewPlan(null);
    setWorkbenchTab("results");
    setFault(false);
    setDialog(null);
    changePage("simulation");
  }
  function launch(type, input, options = {}) {
    if (worker.current) return;
    const proc = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    worker.current = proc;
    setTask({ type });
    const time = Date.now();
    const stop = () => {
      proc.terminate();
      worker.current = null;
      setTask(null);
    };
    proc.onerror = () => {
      stop();
      notify("计算进程异常，请重新运行。", "error");
    };
    proc.onmessage = ({ data }) => {
      if (data.progress) {
        setTask({ type, progress: data.progress });
        return;
      }
      stop();
      if (data.error) {
        notify(data.error, "error");
        return;
      }
      if (type === "search") {
        const { baselineDetail, ...analysisResult } = data.result;
        const selectedFault = Boolean(options.fault);
        const fresh = baselineDetail && {
          id: uuid(),
          time,
          input,
          fault: selectedFault,
          plan: "",
          label: "项目基线",
          summary: summary(baselineDetail),
        };
        const cachedMetrics = selectedFault
          ? analysisResult.baselineFault
          : analysisResult.baseline;
        setResult((previous) => {
          if (fresh) return { ...fresh, result: baselineDetail };
          if (
            previous &&
            !previous.partial &&
            previous.fault === selectedFault &&
            same(previous.input, input)
          )
            return { ...previous, plan: "", label: "项目基线" };
          return cachedMetrics
            ? {
                time,
                input,
                fault: selectedFault,
                plan: "",
                label: "项目基线",
                summary: cachedMetrics,
                result: cachedMetrics,
                partial: true,
              }
            : null;
        });
        patchFor(p.id, (previous) => ({
          analysis: {
            time,
            input,
            search: options.search,
            objective: options.search.objective,
            fault: selectedFault,
            cachedBaseline: Boolean(
              selectedFault
                ? options.cached?.baselineFault
                : options.cached?.baseline,
            ),
            result: analysisResult,
          },
          ...(fresh
            ? { history: [fresh, ...previous.history].slice(0, 40) }
            : {}),
        }));
        notify(
          analysisResult.recommended
            ? "评估完成 · " + analysisResult.feasible + " 个可行方案"
            : "评估完成 · 无可行方案",
        );
      } else {
        const entry = {
          id: options.entry?.id ?? uuid(),
          time: options.entry?.time ?? time,
          input,
          fault: !!options.fault,
          plan: options.plan ?? "",
          label: options.label ?? "项目基线",
          summary: summary(data.result),
        };
        setResult({ ...entry, result: data.result });
        if (!options.entry && !options.preview && !options.skipHistory)
          patchFor(p.id, (prev) => ({
            history: [entry, ...prev.history].slice(0, 40),
          }));
        if (options.scroll)
          requestAnimationFrame(() =>
            document
              .getElementById("evaluation-diagnostics")
              ?.scrollIntoView({ block: "start", behavior: "smooth" }),
          );
        if (!options.quiet)
          notify(
            "评估完成 · " +
              (data.result.pass ? "全部约束通过" : "存在未达标项"),
          );
      }
    };
    proc.postMessage({
      type,
      ...input,
      fault: options.fault,
      search: options.search,
      cached: options.cached,
      detail: options.detail,
    });
  }
  function run(over) {
    const selected = over?.plan ?? currentPlan;
    const input =
      over?.entry?.input ?? over?.input ?? selected?.input ?? snapshot(p);
    const selectedFault = over?.entry?.fault ?? over?.fault ?? fault;
    launch("simulate", input, {
      ...over,
      fault: selectedFault,
      plan: over?.entry?.plan ?? selected?.id ?? "",
      label: over?.entry?.label ?? selected?.name ?? "项目基线",
      preview: selected?.preview,
    });
  }
  function evaluate() {
    if (worker.current) return;
    setWorkbenchTab("results");
    const input = currentPlan?.input ?? snapshot(p);
    const match = (item, scene) =>
      item && item.fault === scene && same(item.input, input);
    const memory = match(result, fault) ? result : null;
    const enabled = activeDimensions(input.config, p.search).length > 0;
    const prior =
      p.analysis && same(p.analysis.input, input) ? p.analysis.result : null;
    const historical = (scene) => p.history.find((item) => match(item, scene));
    const cached = {
      baseline:
        (match(result, false) ? result.summary : null) ??
        historical(false)?.summary ??
        prior?.baseline,
      baselineFault:
        (match(result, true) ? result.summary : null) ??
        historical(true)?.summary ??
        prior?.baselineFault,
    };
    if (currentPlan || !enabled) {
      const stored =
        (fault ? cached.baselineFault : cached.baseline) ??
        (fault ? currentPlan?.fault : currentPlan?.result);
      if (memory || stored) {
        const reused = memory ?? {
          time:
            historical(fault)?.time ??
            currentPlan?.time ??
            p.analysis?.time ??
            Date.now(),
          input,
          fault,
          result: stored,
          summary: stored,
          partial: true,
        };
        setResult({
          ...reused,
          plan: currentPlan?.id ?? "",
          label: currentPlan?.name ?? "项目基线",
        });
        notify("已复用相同输入的评估结果");
      } else run();
      return;
    }
    launch("search", input, {
      search: clone(p.search),
      fault,
      cached,
      detail: !(fault ? cached.baselineFault : cached.baseline),
    });
  }

  function inspect(row, analysis) {
    const candidate = {
      id: "preview-" + analysis.time + "-" + row.id,
      name: row.id,
      preview: true,
      input: { ...analysis.input, config: plannedConfig(row, analysis) },
    };
    setPreviewPlan(candidate);
    setPlan(candidate.id);
    setWorkbenchTab("results");
    run({ plan: candidate, fault, scroll: true });
  }

  function baselineDetails() {
    if (result?.partial) {
      setPlan(result.plan);
      setFault(result.fault);
      run({
        input: result.input,
        fault: result.fault,
        plan: {
          id: result.plan,
          name: result.label,
          preview: currentPlan?.preview,
        },
        skipHistory: true,
        scroll: true,
      });
      return;
    }
    const analysis = p.analysis;
    if (!analysis) return;
    const scene = Boolean(analysis.fault);
    setPlan("");
    setFault(scene);
    run({
      plan: { id: "", name: "项目基线", input: analysis.input },
      fault: scene,
      skipHistory: true,
      scroll: true,
    });
  }
  function addProject() {
    if (!name.trim()) return;
    const id = uuid();
    const d = clone(seed);
    if (starter === "objects") {
      const { model, workload, limits, search } = singleClusterBundle();
      Object.assign(d, {
        config: { model },
        workload,
        limits,
        search,
        display: clone(DEFAULT_DISPLAY),
      });
    } else {
      d.display = clone(DEFAULT_DISPLAY);
      if (kind === "网络容量规划")
        d.display.domains = { D01: "现网域", D02: "扩容域" };
      Object.assign(d.config, {
        spines: 4,
        domain01Leaves: 4,
        domain02Leaves: 4,
        domain01StorageLeaves: 4,
        reuseInventory: 0,
        reuseLeaves: 0,
        newLeaves: 8,
        domain01Nodes: 32,
        sharedNodes: 0,
        sharedPB: 0,
        domain01StoragePB: 4,
        newNodes: 32,
        distribution: "均衡",
      });
      Object.assign(d.limits, {
        domain01PB: 4,
        domain02PB: 6,
        domain01GBps: 80,
        domain02GBps: 180,
        domain01IOPS: 3000,
        domain02IOPS: 6000,
      });
      d.workload.profiles = d.workload.profiles.map((x, i) => ({
        ...x,
        model: i ? "目标业务" : "现网业务",
        peak: i ? 72 : 48,
      }));
      d.search.reuse = "0";
      d.workload.services = [
        serviceProfile("D01", "参考服务"),
        serviceProfile("D02", "目标服务"),
      ];
    }
    const item = {
      ...d,
      id,
      name: name.trim(),
      kind,
      description:
        starter === "objects"
          ? "从对象拓扑模板创建，可导入任意集群、设备型号与物理连接。"
          : "从双网络域 Clos 模板创建，可编辑设备、端口、负载与约束。",
    };
    abort();
    setDb((prev) => ({ active: id, projects: [item, ...prev.projects] }));
    setResult(null);
    setPlan("");
    setPreviewPlan(null);
    setWorkbenchTab("results");
    setFault(false);
    setDialog(null);
    changePage("resources");
    notify("项目已创建");
  }
  function duplicate(source) {
    const id = uuid();
    const item = { ...clone(source), id, name: source.name + "（副本）" };
    setDb((prev) => ({ ...prev, projects: [...prev.projects, item] }));
    notify("项目已复制，含已有配置及任务快照");
  }
  function savePlan(row, analysis) {
    const id = "plan-" + analysis.time + "-" + row.id;
    const existing = p.plans.find((x) => x.id === id);
    if (existing) return existing;
    const config = plannedConfig(row, analysis);
    const item = {
      id,
      name:
        row.id +
        " · " +
        (config.model ? "拓扑方案" : config.distribution + "接入"),
      time: Date.now(),
      config,
      input: { ...analysis.input, config },
      ...(row.changes ? { changes: row.changes } : {}),
      result: row.result,
      fault: row.fault,
      baseCost: cost(analysis.input.config).total,
    };
    patchFor(p.id, (prev) => ({ plans: [item, ...prev.plans] }));
    return item;
  }
  function verify(item) {
    setPlan(item.id);
    setFault(false);
    setWorkbenchTab("results");
    run({ plan: item, fault: false, scroll: true });
  }
  const current = MODULES.find((m) => m[0] === page);
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <div className="brand">
          <div className="brand-icon">
            <Layers3 size={24} />
          </div>
          <div>
            <strong>智算网络规划</strong>
            <small>NETWORK STUDIO</small>
          </div>
        </div>
        <div className="side-main">
          <div className="side-label">当前工作空间</div>
          <button className="workspace" onClick={() => setDialog("switch")}>
            <div className="workspace-icon">
              <Database size={17} />
            </div>
            <div>
              <strong>{p.name}</strong>
              <small>{p.kind}</small>
            </div>
            <ChevronDown size={15} />
          </button>
          <div className="side-label navigation-label">平台模块</div>
          <nav>
            {MODULES.map(([key, label, Icon, num]) => (
              <button
                key={key}
                className={"nav-item " + (page === key ? "active" : "")}
                onClick={() => changePage(key)}
              >
                <Icon size={18} />
                <span>{label}</span>
                <small>{num}</small>
              </button>
            ))}
          </nav>
        </div>
        <div className="side-bottom">
          <button className="side-help" onClick={() => setDialog("help")}>
            <CircleHelp size={17} /> 平台说明 <ArrowUpRight size={13} />
          </button>
          <div className="version">
            <span className="dot green" /> DEMO WORKSPACE <span>V1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-btn mobile-menu"
              aria-label="打开菜单"
              onClick={() => setMenu(!menu)}
            >
              <LayoutGrid size={19} />
            </button>
            <button onClick={() => changePage("projects")}>工作台</button>
            <ChevronRight size={14} />
            <strong>{current?.[1]}</strong>
          </div>
          <div className="top-actions">
            {task && (
              <button
                className="text-button"
                onClick={() => {
                  abort();
                  notify("计算已取消");
                }}
              >
                取消计算
              </button>
            )}
            <span className="engine-pill">
              <span className={"dot " + (task ? "pulse" : "green")} />
              {task ? "引擎运行中" : "流级引擎就绪"}
            </span>
            <div className="avatar" title="本地规划员">
              规
            </div>
          </div>
        </header>
        <DisplayContext.Provider
          value={
            p.config.model
              ? {
                  assigned: p.display?.assigned ?? "沿用",
                  domains: Object.fromEntries(
                    p.config.model.clusters.map(({ id, name }) => [id, name]),
                  ),
                }
              : (p.display ?? DEFAULT_DISPLAY)
          }
        >
          <main className="content" key={p.id + "-" + page}>
            {page === "projects" && (
              <ProjectPage
                projects={db.projects}
                active={p.id}
                open={open}
                create={() => {
                  setName("");
                  setKind("通用网络规划");
                  setStarter("objects");
                  setDialog("new");
                }}
                duplicate={duplicate}
                navigate={changePage}
              />
            )}
            {page === "resources" && (
              <ResourcesPage
                project={p}
                patch={patch}
                notify={notify}
                evaluate={() => {
                  setWorkbenchTab("results");
                  changePage("simulation");
                }}
              />
            )}
            {page === "workload" && (
              <WorkloadPage project={p} patch={patch} notify={notify} />
            )}
            {page === "simulation" && (
              <SimPage
                project={p}
                run={evaluate}
                task={task}
                result={result}
                plan={plan}
                setPlan={setPlan}
                selectedPlan={currentPlan}
                setObjective={(objective) =>
                  patch({ search: { ...p.search, objective } })
                }
                fault={fault}
                setFault={setFault}
                details={details}
                setDetails={setDetails}
                openHistory={() => setDialog("history")}
                tab={workbenchTab}
                setTab={setWorkbenchTab}
                changePage={changePage}
                baselineAvailable={
                  !currentPlan && Boolean(p.analysis?.result.baseline)
                }
                onBaselineDetail={baselineDetails}
                results={
                  (task?.type === "search" ||
                    (p.analysis &&
                      activeDimensions(p.config, p.search).length > 0)) && (
                    <EvaluationPlans
                      view="results"
                      currentFault={fault}
                      project={p}
                      task={task}
                      analysis={p.analysis}
                      savePlan={savePlan}
                      verify={verify}
                      inspect={inspect}
                      notify={notify}
                    />
                  )
                }
                reports={
                  <EvaluationPlans
                    view="reports"
                    project={p}
                    task={task}
                    analysis={p.analysis}
                    savePlan={savePlan}
                    verify={verify}
                    inspect={inspect}
                    notify={notify}
                  />
                }
              />
            )}
            <footer className="footer">
              <span>智算网络规划与仿真平台</span>
              <span>项目配置与任务快照保存在当前浏览器</span>
            </footer>
          </main>
        </DisplayContext.Provider>
      </div>
      {toast && (
        <div className={"toast " + toast.type} role="status">
          {toast.type === "error" ? (
            <TriangleAlert size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}{" "}
          {toast.message}
          <button
            className="icon-btn"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dialog === "switch" && (
        <Modal title="切换项目" close={() => setDialog(null)}>
          <div className="modal-body">
            {db.projects.map((item) => (
              <button
                key={item.id}
                className="switch-item"
                onClick={() => open(item.id)}
              >
                <Database size={17} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.kind}</small>
                </span>
                {item.id === p.id ? (
                  <Check size={17} />
                ) : (
                  <ChevronRight size={17} />
                )}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {dialog === "new" && (
        <Modal title="新建规划项目" close={() => setDialog(null)}>
          <form
            className="modal-body new-form"
            onSubmit={(e) => {
              e.preventDefault();
              addProject();
            }}
          >
            <Field
              type="text"
              label="项目名称"
              value={name}
              onChange={setName}
            />
            <Select
              label="场景类型"
              value={kind}
              onChange={setKind}
              options={[
                "通用网络规划",
                "存储网络改造",
                "网络容量规划",
                "推理网络部署",
                "MoE 通信评估",
              ]}
            />
            <Select
              label="起始配置"
              value={starter}
              onChange={setStarter}
              options={[
                ["objects", "单集群对象拓扑"],
                ["standard", "双域 Clos 参数模板"],
              ]}
            />
            <p className="muted">
              {starter === "objects"
                ? "资源页按集群、物理网络、型号、设备、端口、链路和资源池编辑，可在模板上增加集群。"
                : "资源页按设备数量、端口档位和资源池参数生成双域 Clos，与哈尔滨预置项目使用同一种编辑界面。"}
            </p>
            <div className="actions end">
              <Btn type="button" onClick={() => setDialog(null)}>
                取消
              </Btn>
              <Btn type="submit" primary icon={Plus} disabled={!name.trim()}>
                创建项目
              </Btn>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "history" && (
        <Modal title="历史仿真任务" close={() => setDialog(null)}>
          <div className="modal-body">
            {p.history.length ? (
              p.history.map((item) => (
                <div className="asset-row" key={item.id}>
                  <div className="module-icon">
                    <History size={18} />
                  </div>
                  <div>
                    <strong>{item.label}</strong>
                    <p>
                      {stamp(item.time)} ·{" "}
                      {item.fault ? "SP01 故障" : "正常运行"} ·{" "}
                      {item.summary.service ? "P99 首 token" : "P99 消息完成"}{" "}
                      {format(item.summary.service?.p99 ?? item.summary.p99, 2)}{" "}
                      ms
                    </p>
                  </div>
                  <Status pass={item.summary.pass} />
                  <Btn
                    disabled={!!task}
                    onClick={() => {
                      setPlan(
                        p.plans.some((x) => x.id === item.plan)
                          ? item.plan
                          : "",
                      );
                      setFault(item.fault);
                      setDialog(null);
                      run({ entry: item, quiet: true });
                    }}
                  >
                    打开快照
                  </Btn>
                </div>
              ))
            ) : (
              <Empty
                title="暂无历史任务"
                detail="完成一次仿真后即可从这里重新打开输入快照。"
              />
            )}
          </div>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal title="平台说明" close={() => setDialog(null)}>
          <div className="modal-body help">
            <p>
              项目保存拓扑、负载、约束、仿真快照及候选方案。资源建模、仿真和寻优都可独立操作。
            </p>
            <p>
              引擎使用 0.5 ms 时间步，以流批次和 ECMP
              路径近似计算网络共享与存储处理。链路峰值取单向时间步最大值。P99
              是完成消息的分域时延统计，超出计算窗口的消息会单独导致完成率检查失败。
            </p>
            <p>
              示例项目使用合成数据。存储吞吐、IOPS、基础服务时延和单价由项目数据提供。各网络域的存储容量分别计量。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
