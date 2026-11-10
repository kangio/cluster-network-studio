import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Cable,
  ChevronRight,
  Layers3,
  Network,
  SlidersHorizontal,
} from "lucide-react";

const labels = { enabled: "启用状态", gbps: "链路速率" };
const status = (value) => (value === false ? "停用" : "启用");

const dimensionLabel = (item) => item.name ?? labels[item.field];

function DimensionCard({ item, edit, update, groupScope }) {
  const [draft, setDraft] = useState(null);
  const current =
    item.field === "enabled" ? status(item.current) : String(item.current);
  const value = draft ?? current;
  const title = dimensionLabel(item);
  return (
    <div className="inspector-dimension">
      <div className="dimension-title">
        <strong>{title}</strong>
        {groupScope && <span className="badge gray">分组规则</span>}
      </div>
      {groupScope && <div className="dimension-scope">{groupScope}</div>}
      <div className="inspector-baseline">
        {item.field === "enabled" ? (
          <select
            aria-label={title + "基线值"}
            value={value}
            onChange={(event) => setDraft(event.target.value)}
          >
            <option>启用</option>
            <option>停用</option>
          </select>
        ) : (
          <input
            aria-label={title + "基线值"}
            value={value}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
        {item.field === "gbps" && <span>Gbps</span>}
        <button
          type="button"
          className="btn"
          disabled={value === current}
          onClick={() => {
            if (update(item, value)) setDraft(null);
          }}
        >
          应用基线
        </button>
      </div>
      <label className="inspector-toggle">
        <input
          type="checkbox"
          aria-label={"允许调整 " + (item.name ?? item.id + " " + title)}
          checked={!!item.enabled}
          onChange={(event) => edit(item, { enabled: event.target.checked })}
        />
        <span className="toggle-track" />
        <span>允许调整</span>
      </label>
      {item.enabled && (
        <label className="field inspector-candidates">
          <span>候选值 · 逗号分隔</span>
          <input
            aria-label={(item.name ?? item.id + " " + title) + "候选值"}
            value={item.values ?? current}
            onChange={(event) => edit(item, { values: event.target.value })}
            placeholder={
              item.field === "enabled"
                ? "启用,停用"
                : item.kind === "attachment-distribution"
                  ? "集中,均衡"
                  : "输入候选值"
            }
          />
        </label>
      )}
    </div>
  );
}

function scopeOf(selection, graph, model, dimensions) {
  if (!selection)
    return {
      devices: [],
      links: [],
      exact: [],
      rules: dimensions.filter((item) => item.collection === "batchRules"),
    };
  const ids = new Set(selection.ids);
  const byLink = selection.type === "link" || selection.type === "edge";
  const devices = byLink
    ? []
    : graph.devices.filter((device) => ids.has(device.id));
  const links = graph.links.filter((link) =>
    byLink ? ids.has(link.id) : ids.has(link.a) || ids.has(link.b),
  );
  if (!devices.length && !links.length)
    return {
      devices: [],
      links: [],
      exact: [],
      rules: dimensions.filter((item) => item.collection === "batchRules"),
    };
  const groupIds = new Set(
    devices.map((device) => device.group).filter(Boolean),
  );
  const linkIds = new Set(links.map((link) => link.id));
  const linkGroups = new Set(
    model.links
      .filter((link) => linkIds.has(link.id))
      .map((link) => link.group)
      .filter(Boolean),
  );
  const ruleIds = new Set(
    (model.batchRules ?? [])
      .filter((rule) => {
        if (rule.kind === "device-count") return groupIds.has(rule.group);
        if (rule.kind === "uplinks-per-leaf")
          return (
            rule.leafGroups?.some((group) => groupIds.has(group)) ||
            ((byLink || !rule.leafGroups?.length) && linkGroups.has(rule.group))
          );
        return (
          [...(rule.targetGroups ?? []), ...(rule.sourceGroups ?? [])].some(
            (group) => groupIds.has(group),
          ) ||
          (byLink && linkGroups.has(rule.linkGroup))
        );
      })
      .map((rule) => rule.id),
  );
  const exact = dimensions.filter(
    (item) =>
      ((selection.type === "device" && item.collection === "devices") ||
        (selection.type === "link" && item.collection === "links")) &&
      item.id === selection.id,
  );
  return {
    devices,
    links,
    exact,
    rules: dimensions.filter(
      (item) => item.collection === "batchRules" && ruleIds.has(item.id),
    ),
  };
}

export function TopologyInspector({
  graph,
  model,
  dimensions,
  selection,
  onSelect,
  edit,
  update,
  drill,
  showInventory,
}) {
  const scope = useMemo(
    () => scopeOf(selection, graph, model, dimensions),
    [selection, graph, model, dimensions],
  );
  const [tab, setTab] = useState("planning");
  const valid = scope.devices.length || scope.links.length;
  const chosen = valid ? selection : null;
  const singleDevice = chosen?.type === "device" ? scope.devices[0] : null;
  const singleLink = chosen?.type === "link" ? scope.links[0] : null;
  const live = scope.devices.filter(
    (device) => device.enabled !== false,
  ).length;
  const liveLinks = scope.links.filter((link) => !link.down).length;
  const names = new Set(scope.devices.map((device) => device.modelName));
  const enabled = dimensions.filter((item) => item.enabled).length;
  const action =
    chosen?.type === "group" && scope.devices.length ? (
      <button className="btn" type="button" onClick={() => drill(chosen)}>
        展开到设备 <ArrowRight size={14} />
      </button>
    ) : null;
  const list = scope.links.slice(0, 24);
  const ruleScopes = new Map(
    (model.batchRules ?? []).map((rule) => [
      rule.id,
      graph.groupNames[rule.group ?? rule.linkGroup],
    ]),
  );
  return (
    <aside className="panel topology-inspector">
      <div className="panel-head">
        <div>
          <h2>
            <SlidersHorizontal size={16} />
            对象属性
          </h2>
          <p>基线和候选范围分别保存</p>
        </div>
        {!!chosen && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setTab("planning");
              onSelect(null);
            }}
          >
            全部规则
          </button>
        )}
      </div>
      <div className="inspector-body">
        <div className="inspector-object">
          <div className="inspector-icon">
            {singleLink || chosen?.type === "edge" ? (
              <Cable size={18} />
            ) : chosen?.type === "group" ? (
              <Layers3 size={18} />
            ) : (
              <Network size={18} />
            )}
          </div>
          <div>
            <span className="muted">
              {singleLink
                ? "物理链路"
                : singleDevice
                  ? "设备实例"
                  : chosen?.type === "group"
                    ? "设备分组"
                    : chosen?.type === "edge"
                      ? "分组连接"
                      : "规划概览"}
            </span>
            <h3>
              {singleDevice?.id ??
                singleLink?.id ??
                chosen?.title ??
                "点选拓扑对象"}
            </h3>
          </div>
        </div>
        {singleLink ? (
          <dl className="inspector-spec">
            <dt>端口</dt>
            <dd>
              {singleLink.aPort} ↔ {singleLink.bPort}
            </dd>
            <dt>速率</dt>
            <dd>{singleLink.gbps} Gbps</dd>
            <dt>状态</dt>
            <dd>{singleLink.down ? "停用或未接通" : "启用"}</dd>
          </dl>
        ) : singleDevice ? (
          <dl className="inspector-spec">
            <dt>型号</dt>
            <dd>{singleDevice.modelName}</dd>
            <dt>端口</dt>
            <dd>
              {scope.links.filter((link) => !link.down).length} 已连接 /{" "}
              {singleDevice.ports} 个
            </dd>
            <dt>状态</dt>
            <dd>{status(singleDevice.enabled)}</dd>
          </dl>
        ) : chosen ? (
          <dl className="inspector-spec">
            {scope.devices.length > 0 && (
              <>
                <dt>型号</dt>
                <dd>{[...names].join("、")}</dd>
                <dt>设备</dt>
                <dd>
                  {live} 启用 / {scope.devices.length} 台
                </dd>
              </>
            )}
            <dt>链路</dt>
            <dd>
              {liveLinks} 启用 / {scope.links.length} 条
            </dd>
          </dl>
        ) : (
          <p className="muted inspector-hint">
            点击左侧的 Spine、Leaf、节点或链路，即可查看可调配置。当前已开放{" "}
            {enabled} 项。
          </p>
        )}
        {action}
        {chosen && scope.links.length > 0 && (
          <div className="segmented inspector-tabs">
            <button
              type="button"
              className={tab === "planning" ? "selected" : ""}
              onClick={() => setTab("planning")}
            >
              寻优维度
            </button>
            <button
              type="button"
              className={tab === "links" ? "selected" : ""}
              onClick={() => setTab("links")}
            >
              关联链路
            </button>
          </div>
        )}
        {chosen && scope.links.length && tab === "links" ? (
          <div className="inspector-link-list">
            {list.map((link) => (
              <button
                key={link.id}
                type="button"
                className="inspector-link"
                onClick={() => {
                  onSelect({
                    type: "link",
                    id: link.id,
                    ids: [link.id],
                    title: link.id,
                  });
                  setTab("planning");
                }}
              >
                <span>
                  <b>{link.id}</b>
                  <small>
                    {link.aPort} ↔ {link.bPort} · {link.gbps}G
                    {link.down ? " · 停用" : ""}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
            {scope.links.length > list.length && (
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  showInventory(
                    "links",
                    scope.links.map((link) => link.id),
                  )
                }
              >
                在链路清单中查看全部 {scope.links.length} 条
              </button>
            )}
          </div>
        ) : (
          <div className="inspector-rules">
            {scope.exact.map((item) => (
              <DimensionCard
                key={item.key}
                item={item}
                edit={edit}
                update={update}
              />
            ))}
            {!!scope.rules.length && (
              <div className="inspector-section-title">
                {chosen ? "关联分组规则" : "批量规划规则"} ·{" "}
                {scope.rules.length}
              </div>
            )}
            {scope.rules.map((item) => (
              <DimensionCard
                key={item.key}
                item={item}
                edit={edit}
                update={update}
                groupScope={ruleScopes.get(item.id)}
              />
            ))}
            {!scope.exact.length && !scope.rules.length && (
              <div className="inspector-empty">
                此对象暂无直接可调项。
                {chosen && scope.links.length
                  ? "可在「关联链路」中选择物理链路。"
                  : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
