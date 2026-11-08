import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Braces,
  Check,
  Download,
  Network,
  Upload,
  X,
} from "lucide-react";
import { objectDimensions } from "./topology-model.js";
import { OBJECT_SHEETS, writeObjectWorkbook } from "./topology-io.js";

const titles = {
  clusters: "集群",
  networks: "物理网络",
  models: "型号规格",
  devices: "设备实例",
  ports: "端口",
  links: "链路",
  pools: "资源池",
};
const labels = { enabled: "启用状态", gbps: "链路速率" };
const displayValue = (value) =>
  value === true ? "启用" : value === false ? "停用" : (value ?? "—");
const visible = (row) => row.enabled !== false;

export function ObjectGraphView({ graph }) {
  const shown = graph.devices.filter(visible);
  const switchCount = graph.switchBudgets.size;
  const networkIds = [...new Set(graph.links.map((link) => link.network))];
  const [filter, setFilter] = useState("");
  const enabledLinks = graph.links.filter(
    (link) => !link.down && (!filter || link.network === filter),
  );
  const included = new Set(enabledLinks.flatMap((link) => [link.a, link.b]));
  const nodes = filter ? shown.filter((item) => included.has(item.id)) : shown;
  const columns = [
    nodes.filter((device) => graph.endpoints[device.id]?.kind === "C"),
    nodes.filter((device) => graph.switchBudgets.has(device.id)),
    nodes.filter((device) => graph.endpoints[device.id]?.kind === "S"),
  ];
  const height = Math.max(
    110,
    ...columns.map((group) => 32 + group.length * 49),
  );
  const positions = new Map(
    columns.flatMap((group, index) =>
      group.map((device, row) => [
        device.id,
        { x: 145 + index * 260, y: 34 + row * 49 },
      ]),
    ),
  );
  return (
    <div className="object-graph">
      <div className="object-summary">
        <span>{Object.keys(graph.planes).length} 个集群</span>
        <span>{switchCount} 台启用交换机</span>
        <span>
          {graph.links.filter((link) => !link.down).length} 条启用链路
        </span>
        {networkIds.length > 1 && (
          <label>
            网络{" "}
            <select
              aria-label="图中网络"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="">全部</option>
              {networkIds.map((key) => (
                <option key={key} value={key}>
                  {graph.networkNames[key] ?? key}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {nodes.length > 45 ? (
        <p className="object-note">
          当前视图设备较多，可在设备和链路清单中按编号筛选。
        </p>
      ) : (
        <svg
          viewBox={"0 0 810 " + height}
          role="img"
          aria-label="设备与实际连接拓扑"
        >
          {enabledLinks.map((link) => {
            const a = positions.get(link.a),
              b = positions.get(link.b);
            if (!a || !b) return null;
            const d =
              a.x === b.x
                ? "M " +
                  a.x +
                  " " +
                  a.y +
                  " C " +
                  (a.x + 165) +
                  " " +
                  a.y +
                  " " +
                  (b.x + 165) +
                  " " +
                  b.y +
                  " " +
                  b.x +
                  " " +
                  b.y
                : "M " + a.x + " " + a.y + " L " + b.x + " " + b.y;
            return (
              <path
                key={link.id}
                d={d}
                fill="none"
                stroke={link.type === "上联" ? "#4378da" : "#aabede"}
                strokeWidth="2"
              >
                <title>
                  {link.aPort} ↔ {link.bPort} · {link.gbps} Gbps
                </title>
              </path>
            );
          })}
          {nodes.map((node) => {
            const { x, y } = positions.get(node.id);
            return (
              <g key={node.id}>
                <rect
                  x={x - 100}
                  y={y - 19}
                  width="200"
                  height="38"
                  rx="8"
                  fill="#fff"
                  stroke="#c4d6f5"
                />
                <text x={x} y={y - 1} textAnchor="middle">
                  {node.id.slice(0, 25)}
                </text>
                <text
                  x={x}
                  y={y + 12}
                  textAnchor="middle"
                  className="model-name"
                >
                  {node.modelName.slice(0, 24)}
                </text>
                <title>
                  {node.id} · {node.modelName}
                </title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function objectColumns(section, graph, model) {
  const name = (key) => graph.clusterNames[key] ?? key ?? "共享";
  const port = (id) => model.ports.find((item) => item.id === id);
  const rate = (id) => {
    const p = port(id);
    return (
      p.maxGbps ??
      model.models.find(
        (spec) =>
          spec.id === model.devices.find((item) => item.id === p.device).model,
      ).maxGbps
    );
  };
  const profiles = {
    clusters: [
      ["编号", (r) => r.id],
      ["名称", (r) => r.name],
      ["计算节点", (r) => graph.planes[r.id].C.length],
      ["可访问存储", (r) => graph.planes[r.id].S.length],
      ["可访问容量", (r) => graph.capacities[r.id] + " PB"],
    ],
    networks: [
      ["编号", (r) => r.id],
      ["名称", (r) => r.name],
      ["链路", (r) => model.links.filter((l) => l.network === r.id).length],
    ],
    models: [
      ["编号", (r) => r.id],
      ["型号", (r) => r.name],
      [
        "类型",
        (r) =>
          ({ switch: "交换机", compute: "计算节点", storage: "存储节点" })[
            r.kind
          ],
      ],
      ["物理端口", (r) => r.portCount],
      ["最大端口速率", (r) => r.maxGbps + " Gbps"],
      [
        "交换容量",
        (r) => (r.switchGbps == null ? "—" : r.switchGbps + " Gbps"),
      ],
    ],
    devices: [
      ["设备编号", (r) => r.id],
      ["型号", (r) => graph.devices.find((d) => d.id === r.id)?.modelName],
      ["归属", (r) => name(r.cluster)],
      ["角色", (r) => r.role],
      [
        "资产状态",
        (r) =>
          ({ existing: "存量", assigned: "沿用", added: "新增" })[
            r.state ?? "existing"
          ],
      ],
      ["启用", (r) => visible(r)],
    ],
    ports: [
      ["端口编号", (r) => r.id],
      ["设备", (r) => r.device],
      ["端口速率上限", (r) => rate(r.id) + " Gbps"],
    ],
    links: [
      ["链路编号", (r) => r.id],
      ["A 端口", (r) => r.a],
      ["B 端口", (r) => r.b],
      ["网络", (r) => graph.networkNames[r.network] ?? r.network ?? "默认网络"],
      ["速率", (r) => r.gbps + " Gbps"],
      ["启用", (r) => visible(r)],
    ],
    pools: [
      ["资源池", (r) => r.id],
      ["类型", (r) => (r.kind === "compute" ? "计算" : "存储")],
      ["成员", (r) => r.members.join("、")],
      ["可访问集群", (r) => r.clusters.map(name).join("、")],
    ],
  };
  return profiles[section];
}

export function ObjectResources({
  project,
  graph,
  adopt,
  patch,
  notify,
  download,
  importFile,
  fileBusy,
  evaluate,
}) {
  const [section, setSection] = useState("devices");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const { model } = project.config;
  const dimensions = useMemo(
    () => objectDimensions(project.config, project.search),
    [project.config, project.search],
  );
  const choices = dimensions.filter((item) => item.enabled).length;
  const rows = (model[section] ?? []).filter((row) =>
    JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
  );
  const chunk = 50;
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / chunk) - 1),
  );
  const columns = objectColumns(section, graph, model);
  const editDimension = (item, change) =>
    patch({
      search: {
        ...project.search,
        object: {
          ...project.search.object,
          [item.key]: { ...project.search.object?.[item.key], ...change },
        },
      },
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span />
            02 / NETWORK MODEL
          </div>
          <h1>资源与网络建模</h1>
          <p>按对象管理集群、异构设备、端口、链路和共享资源池。</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={evaluate}>
            进入评估工作台 <ArrowRight size={15} />
          </button>
          <label className="btn">
            <Upload size={15} />
            {fileBusy ? "导入中…" : "批量导入"}
            <input
              type="file"
              accept=".json,.xlsx,.xls"
              onChange={importFile}
              disabled={fileBusy}
              hidden
            />
          </label>
          <button
            className="btn primary"
            onClick={() => {
              setError("");
              setDraft(JSON.stringify(model, null, 2));
            }}
          >
            <Braces size={15} />
            编辑拓扑对象
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>
              <Network size={17} />
              网络拓扑
            </h2>
            <p>显示已启用的物理连接。型号规格和集群归属单独记录。</p>
          </div>
          <div className="actions">
            <button
              className="btn"
              onClick={() =>
                download(
                  "对象拓扑.json",
                  JSON.stringify(
                    {
                      model,
                      workload: project.workload,
                      limits: project.limits,
                      search: project.search,
                    },
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              <Download size={15} />
              导出 JSON
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  writeObjectWorkbook(
                    await import("xlsx"),
                    model,
                    "对象拓扑.xlsx",
                  );
                } catch (e) {
                  notify(e.message, "error");
                }
              }}
            >
              导出 Excel
            </button>
          </div>
        </div>
        <ObjectGraphView graph={graph} />
      </section>
      <div className="module-tabs">
        {Object.entries(titles).map(([key, title]) => (
          <button
            key={key}
            className={section === key ? "selected" : ""}
            onClick={() => {
              setSection(key);
              setQuery("");
              setPage(0);
            }}
          >
            {title} · {model[key]?.length ?? 0}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{titles[section]}清单</h2>
            <p>候选值独立于基线 · 已开放 {choices} 项</p>
          </div>
          <label className="search-box">
            <input
              aria-label="筛选拓扑对象"
              placeholder="筛选编号或参数"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table className="object-table">
            <thead>
              <tr>
                {columns.map(([label]) => (
                  <th key={label}>{label}</th>
                ))}
                {["links", "devices"].includes(section) && (
                  <th>允许调整与候选值</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.slice(current * chunk, (current + 1) * chunk).map((row) => (
                <tr key={row.id}>
                  {columns.map(([label, get]) => (
                    <td key={label}>{displayValue(get(row))}</td>
                  ))}
                  {["links", "devices"].includes(section) && (
                    <td>
                      <div className="object-dimensions">
                        {dimensions
                          .filter(
                            (item) =>
                              item.collection === section && item.id === row.id,
                          )
                          .map((item) => (
                            <div key={item.key}>
                              <label className="checkline">
                                <input
                                  type="checkbox"
                                  aria-label={
                                    "允许调整 " +
                                    row.id +
                                    " " +
                                    labels[item.field]
                                  }
                                  checked={!!item.enabled}
                                  onChange={(event) =>
                                    editDimension(item, {
                                      enabled: event.target.checked,
                                    })
                                  }
                                />
                                {labels[item.field]}
                              </label>
                              {item.enabled && (
                                <input
                                  className="object-input"
                                  aria-label={
                                    row.id + " " + labels[item.field] + "候选值"
                                  }
                                  value={
                                    item.values ?? displayValue(item.current)
                                  }
                                  onChange={(event) =>
                                    editDimension(item, {
                                      values: event.target.value,
                                    })
                                  }
                                  placeholder={
                                    item.field === "enabled"
                                      ? "启用,停用"
                                      : "25,100"
                                  }
                                />
                              )}
                            </div>
                          ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="panel-body object-note">没有匹配的记录</div>
        )}
        {rows.length > chunk && (
          <div className="panel-body actions">
            <button
              className="btn"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </button>
            <span>
              {current + 1} / {Math.ceil(rows.length / chunk)}
            </span>
            <button
              className="btn"
              disabled={(current + 1) * chunk >= rows.length}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </section>
      {draft !== null && (
        <div className="modal-scrim" onClick={() => setDraft(null)}>
          <section
            className="modal object-editor"
            role="dialog"
            aria-modal="true"
            aria-label="编辑拓扑对象"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>编辑拓扑对象</h2>
              <button
                className="icon-btn"
                aria-label="关闭"
                onClick={() => setDraft(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                保留对象编号可维持业务、端口和候选配置的引用。保存前会校验引用、端口占用和型号速率。
              </p>
              <label className="field">
                <span>对象拓扑 JSON</span>
                <textarea
                  rows={20}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                />
              </label>
              {error && (
                <div className="notice" role="alert">
                  {error}
                </div>
              )}
              <div className="actions end">
                <button
                  className="btn primary"
                  onClick={() => {
                    try {
                      adopt(JSON.parse(draft));
                      setDraft(null);
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  <Check size={15} />
                  校验并应用
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function ObjectHeatmap({ result, onPick }) {
  const [network, setNetwork] = useState("");
  const networks = [...new Set(result.links.map((link) => link.network))];
  const shown = result.links.filter(
    (link) => !network || link.network === network,
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>网络负载热力图</h2>
          <p>每格对应一条真实物理链路，点击查看端口与热点来源。</p>
        </div>
        <select
          aria-label="热力图网络"
          value={network}
          onChange={(event) => setNetwork(event.target.value)}
        >
          <option value="">全部网络</option>
          {networks.map((key) => (
            <option key={key} value={key}>
              {result.networkNames?.[key] ?? key}
            </option>
          ))}
        </select>
      </div>
      <div className="object-heat">
        {shown.map((link) => (
          <button
            key={link.id}
            className="heat-cell object-heat-cell"
            onClick={() => onPick(link)}
            title={link.aPort + " ↔ " + link.bPort}
            style={{
              background: link.down
                ? "#e7ebf1"
                : link.peak >= 85
                  ? "#ffc4a8"
                  : link.peak >= 50
                    ? "#fbe7a2"
                    : link.peak > 0
                      ? "#c6dcff"
                      : "#eef4ff",
            }}
          >
            <span>{link.id}</span>
            <b>{link.down ? "停用" : link.peak + "%"}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
