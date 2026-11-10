import React, { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Braces,
  Check,
  Download,
  Network,
  Upload,
  X,
} from "lucide-react";
import { objectDimensions, applyObjectChanges } from "./topology-model.js";
import { validateBatchValue } from "./topology-batch.js";
import { OBJECT_SHEETS, writeObjectWorkbook } from "./topology-io.js";
import {
  ObjectGraphView,
  deviceGroupKey,
  deviceGroupTitle,
  topologyTiers,
} from "./topology-view.jsx";
import { TopologyInspector } from "./topology-inspector.jsx";

const titles = {
  clusters: "集群",
  networks: "物理网络",
  models: "型号规格",
  devices: "设备实例",
  ports: "端口",
  links: "链路",
  pools: "资源池",
};
const displayValue = (value) =>
  value === true ? "启用" : value === false ? "停用" : (value ?? "—");
const visible = (row) => row.enabled !== false;

export { ObjectGraphView };

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

function GroupView({ graph, onSelect }) {
  const groups = new Map();
  const tiers = topologyTiers(graph);
  for (const device of graph.devices) {
    const key = deviceGroupKey(device, tiers.get(device.id));
    const label =
      graph.groupNames[device.group] ??
      (graph.clusterNames[device.plane] ?? "共享") +
        " · " +
        deviceGroupTitle(graph, device, tiers.get(device.id));
    if (!groups.has(key))
      groups.set(key, { label, modelName: device.modelName, devices: [] });
    groups.get(key).devices.push(device);
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>设备分组清单</h2>
          <p>异构设备按型号分别列出。选择分组可查看属性和规划规则。</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>分组</th>
              <th>型号</th>
              <th>启用 / 库存</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {[...groups].map(([key, row]) => (
              <tr key={key}>
                <td>{row.label}</td>
                <td>{row.modelName}</td>
                <td>
                  {row.devices.filter(visible).length} / {row.devices.length} 台
                </td>
                <td>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      onSelect({
                        type: "group",
                        id: row.devices[0].id,
                        ids: row.devices.map((device) => device.id),
                        title: row.label,
                      })
                    }
                  >
                    查看属性 <ArrowRight size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!groups.size && (
        <div className="panel-body object-note">请导入设备或编辑拓扑对象。</div>
      )}
    </section>
  );
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
  const [section, setSection] = useState("groups");
  const [inventoryIds, setInventoryIds] = useState(null);
  const [selection, setSelection] = useState(null);
  const [graphMode, setGraphMode] = useState("group");
  const [focus, setFocus] = useState(null);
  const workspace = useRef(null);
  const inventory = useRef(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const { model } = project.config;
  const dimensions = useMemo(
    () => objectDimensions(project.config, project.search),
    [project.config, project.search],
  );
  const rows = (model[section] ?? []).filter(
    (row) =>
      (!inventoryIds || inventoryIds.has(row.id)) &&
      JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
  );
  const chunk = 50;
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / chunk) - 1),
  );
  const columns = objectColumns(section, graph, model);
  function showInventory(section, ids) {
    setInventoryIds(ids ? new Set(ids) : null);
    setQuery("");
    setPage(0);
    setSection(section);
    if (ids) inventory.current?.scrollIntoView({ block: "start" });
  }
  function pickInventory(next) {
    setSelection(next);
    workspace.current?.scrollIntoView({ block: "start" });
  }
  function drill(next) {
    setFocus(next);
    setGraphMode("device");
  }
  function updateBaseline(item, raw) {
    try {
      let value;
      if (item.field === "enabled") value = raw === "启用";
      else if (item.kind === "attachment-distribution") value = raw.trim();
      else value = raw.trim() ? Number(raw) : NaN;
      if (
        item.collection === "batchRules" &&
        !validateBatchValue(model, item, value)
      )
        throw Error(item.name + "超出分组范围");
      if (item.field === "gbps" && (!Number.isFinite(value) || value <= 0))
        throw Error("请输入大于零的链路速率");
      const config = applyObjectChanges(project.config, [
        { collection: item.collection, id: item.id, field: item.field, value },
      ]);
      adopt(config.model);
      return true;
    } catch (error) {
      notify(error.message, "error");
      return false;
    }
  }
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
      <div className="topology-workspace" ref={workspace}>
        <section className="panel topology-stage">
          <div className="panel-head">
            <div>
              <h2>
                <Network size={17} />
                网络拓扑
              </h2>
              <p>
                按 Spine、Leaf 和计算 / 存储节点分层。点选对象查看可调配置。
              </p>
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
          <ObjectGraphView
            graph={graph}
            mode={graphMode}
            onMode={setGraphMode}
            focus={focus}
            clearFocus={() => setFocus(null)}
            selection={selection}
            onSelect={setSelection}
          />
        </section>
        <TopologyInspector
          key={selection ? selection.type + ":" + selection.id : "overview"}
          graph={graph}
          model={model}
          dimensions={dimensions}
          selection={selection}
          onSelect={setSelection}
          edit={editDimension}
          update={updateBaseline}
          drill={drill}
          showInventory={showInventory}
        />
      </div>
      <div className="module-tabs topology-inventory" ref={inventory}>
        <button
          className={section === "groups" ? "selected" : ""}
          onClick={() => showInventory("groups")}
        >
          分组视图
        </button>
        {Object.entries(titles).map(([key, title]) => (
          <button
            key={key}
            className={section === key ? "selected" : ""}
            onClick={() => showInventory(key)}
          >
            {title} · {model[key]?.length ?? 0}
          </button>
        ))}
      </div>
      {section === "groups" ? (
        <GroupView graph={graph} onSelect={pickInventory} />
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>{titles[section]}清单</h2>
                <p>
                  {inventoryIds
                    ? "当前对象的关联记录"
                    : "查看拓扑对象与连接信息"}
                </p>
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
                      <th>对象属性</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice(current * chunk, (current + 1) * chunk)
                    .map((row) => (
                      <tr key={row.id}>
                        {columns.map(([label, get]) => (
                          <td key={label}>{displayValue(get(row))}</td>
                        ))}
                        {["links", "devices"].includes(section) && (
                          <td>
                            <button
                              type="button"
                              className="text-button"
                              aria-label={"查看属性 " + row.id}
                              onClick={() =>
                                pickInventory({
                                  type: section === "links" ? "link" : "device",
                                  id: row.id,
                                  ids: [row.id],
                                  title: row.id,
                                })
                              }
                            >
                              查看属性 <ArrowRight size={13} />
                            </button>
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
        </>
      )}
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
