import React, { useId, useMemo, useState } from "react";

export const deviceGroupKey = (device, tier) =>
  JSON.stringify([device.group ?? device.plane, tier, device.model]);
const active = (device) => device.enabled !== false;
const SWATCHES = {
  spine: ["#215bc1", "#edf4ff", "#b3cbfa"],
  leaf: ["#0f797d", "#e9f8f5", "#a8dcd3"],
  C: ["#4f579b", "#f1f1fe", "#c6c8f0"],
  S: ["#80533a", "#fff5e9", "#edcba9"],
};
const TIER = { spine: "Spine", leaf: "Leaf", C: "计算节点", S: "存储节点" };
const trim = (value, count) =>
  value.length > count ? value.slice(0, count - 1) + "…" : value;

export function topologyTiers(graph) {
  const byId = new Map(graph.devices.map((device) => [device.id, device]));
  const access = new Set();
  const connected = new Set();
  for (const link of graph.links) {
    for (const [id, peer] of [
      [link.a, link.b],
      [link.b, link.a],
    ]) {
      connected.add(id);
      if (byId.get(peer)?.kind !== "switch") access.add(id);
    }
  }
  return new Map(
    graph.devices.map((device) => {
      let tier;
      if (device.kind === "compute") tier = "C";
      else if (device.kind === "storage") tier = "S";
      else if (/spine|core|核心|汇聚/i.test(device.type)) tier = "spine";
      else if (
        /leaf|tor|接入/i.test(device.type) ||
        access.has(device.id) ||
        !connected.has(device.id)
      )
        tier = "leaf";
      else tier = "spine";
      return [device.id, tier];
    }),
  );
}

export function deviceGroupTitle(graph, device, tier) {
  return (
    graph.groupNames[device.group]?.split(" · ").at(-1) ??
    (["compute", "storage", "switch"].includes(device.type)
      ? TIER[tier]
      : device.type)
  );
}

function collect(graph, network, mode, focus, reserve) {
  const enabled = graph.links.filter(
    (link) => !link.down && (!network || link.network === network),
  );
  const scoped = graph.links.filter(
    (link) => !network || link.network === network,
  );
  const incident = new Map();
  for (const link of scoped) {
    for (const [id, peer] of [
      [link.a, link.b],
      [link.b, link.a],
    ]) {
      if (!incident.has(id))
        incident.set(id, { networks: new Set(), peers: new Set() });
      incident.get(id).networks.add(link.network);
      if (!link.down || reserve) incident.get(id).peers.add(peer);
    }
  }
  const adjacent = new Set(focus?.ids ?? []);
  if (focus)
    for (const id of focus.ids)
      for (const peer of incident.get(id)?.peers ?? []) adjacent.add(peer);
  const devices = graph.devices.filter(
    (device) =>
      (mode === "group" ||
        reserve ||
        active(device) ||
        focus?.ids.includes(device.id)) &&
      (!network || incident.has(device.id)) &&
      (!focus || adjacent.has(device.id)),
  );
  const tiers = topologyTiers(graph);
  const nodes = new Map();
  const projection = new Map();
  for (const device of devices) {
    const networks = [...(incident.get(device.id)?.networks ?? [])];
    const lane = network || (networks.length === 1 ? networks[0] : "shared");
    const type = tiers.get(device.id);
    const key =
      mode === "group" ? deviceGroupKey(device, type) + "@" + lane : device.id;
    projection.set(device.id, key);
    if (!nodes.has(key))
      nodes.set(key, {
        key,
        id: device.id,
        lane,
        type,
        title:
          mode === "device" ? device.id : deviceGroupTitle(graph, device, type),
        model: device.modelName,
        ids: [],
        count: 0,
      });
    const node = nodes.get(key);
    node.ids.push(device.id);
    node.count += Number(active(device));
  }

  const edges = new Map();
  for (const link of mode === "device" && reserve ? scoped : enabled) {
    const a = projection.get(link.a),
      b = projection.get(link.b);
    if (!a || !b || a === b) continue;
    const key = JSON.stringify([a, b].sort());
    if (!edges.has(key))
      edges.set(key, { key, a, b, ids: [], capacity: 0, up: 0 });
    const edge = edges.get(key);
    edge.ids.push(link.id);
    edge.capacity += link.down ? 0 : link.gbps;
    edge.up += Number(!link.down);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function arrange(nodes, networkNames, mode) {
  const lanes = new Map();
  for (const node of nodes) {
    if (!lanes.has(node.lane))
      lanes.set(node.lane, {
        key: node.lane,
        title:
          networkNames[node.lane] ??
          (node.lane === "shared" ? "共享或未接线设备" : "物理网络"),
        nodes: [],
      });
    lanes.get(node.lane).nodes.push(node);
  }
  const slots = 4;
  const cell = mode === "group" ? 140 : 127;
  const height = mode === "group" ? 61 : 50;
  const gap = 13;
  const order = ["spine", "leaf", "C", "S"];
  const bands = ["spine", "leaf", "end"];
  const heights = [110, 110, 115];
  let width = 0;
  for (const lane of lanes.values()) {
    const byTier = order.map((type) =>
      lane.nodes.filter((node) => node.type === type),
    );
    const split = byTier[2].length && byTier[3].length;
    const perTier = byTier.map((group, i) =>
      Math.max(1, Math.min(split && i >= 2 ? 3 : slots, group.length)),
    );
    const widths = byTier.map((group, i) =>
      group.length ? perTier[i] * cell : 0,
    );
    lane.width = Math.max(
      lanes.size === 1 ? 620 : 310,
      widths[0] + 30,
      widths[1] + 30,
      widths[2] + widths[3] + (split ? 16 : 0) + 30,
    );
    lane.x = width + 10;
    width += lane.width + 14;
    lane.rows = byTier;
    lane.slots = perTier;
    lane.split = split;
    lane.endWidths = widths.slice(2);
    const rowCounts = byTier.map((group, i) =>
      Math.ceil(group.length / perTier[i]),
    );
    for (let i = 0; i < 3; i++)
      heights[i] = Math.max(
        heights[i],
        63 +
          Math.max(rowCounts[i], i === 2 ? rowCounts[3] : 0) * (height + gap),
      );
  }
  const y = [54, 54 + heights[0], 54 + heights[0] + heights[1]];
  const positions = new Map();
  for (const lane of lanes.values()) {
    for (const [index, group] of lane.rows.entries()) {
      const band = Math.min(2, index);
      const slots = lane.slots[index];
      const endTotal = lane.endWidths[0] + lane.endWidths[1] + 16;
      const center =
        lane.split && index >= 2
          ? lane.x +
            (lane.width - endTotal) / 2 +
            (index === 2
              ? lane.endWidths[0] / 2
              : lane.endWidths[0] + 16 + lane.endWidths[1] / 2)
          : lane.x + lane.width / 2;
      group.forEach((node, i) => {
        const row = Math.floor(i / slots),
          col = i % slots;
        const last = Math.min(slots, group.length - row * slots);
        positions.set(node.key, {
          x: center + (col - (last - 1) / 2) * cell,
          y: y[band] + 53 + row * (height + gap),
          w: cell - 13,
          h: height,
        });
      });
    }
  }
  return {
    lanes: [...lanes.values()],
    bands,
    heights,
    y,
    width: Math.max(width + 8, 640),
    height: y[2] + heights[2] + 10,
    positions,
  };
}

function edgePath(a, b) {
  if (a.y === b.y) {
    const top = Math.min(a.y - a.h / 2, b.y - b.h / 2) - 14;
    return (
      "M " +
      a.x +
      " " +
      (a.y - a.h / 2) +
      " Q " +
      (a.x + b.x) / 2 +
      " " +
      (top - 14) +
      " " +
      b.x +
      " " +
      (b.y - b.h / 2)
    );
  }
  const [start, end] = a.y < b.y ? [a, b] : [b, a];
  const first = start.y + start.h / 2,
    last = end.y - end.h / 2;
  const mid = (first + last) / 2;
  return (
    "M " +
    start.x +
    " " +
    first +
    " C " +
    start.x +
    " " +
    mid +
    " " +
    end.x +
    " " +
    mid +
    " " +
    end.x +
    " " +
    last
  );
}

export function ObjectGraphView({
  graph,
  selection,
  onSelect,
  mode: selectedMode,
  onMode,
  focus,
  clearFocus,
}) {
  const pattern = useId();
  const [localMode, setLocalMode] = useState("group");
  const [filter, setFilter] = useState("");
  const [reserve, setReserve] = useState(false);
  const mode = selectedMode ?? localMode;
  const setMode = onMode ?? setLocalMode;
  const networkIds = [...new Set(graph.links.map((link) => link.network))];
  const network = networkIds.includes(filter) ? filter : "";
  const { nodes, edges } = useMemo(
    () => collect(graph, network, mode, focus, reserve),
    [graph, network, mode, focus, reserve],
  );
  const nameCounts = new Map();
  for (const node of nodes) {
    const key = JSON.stringify([node.lane, node.type, node.title]);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const layout = useMemo(
    () => arrange(nodes, graph.networkNames, mode),
    [nodes, graph.networkNames, mode],
  );
  const activeIds = new Set(selection?.ids ?? []);
  const linksSelected =
    selection?.type === "link" || selection?.type === "edge";
  const selectedNodes = new Set(
    nodes
      .filter(
        (node) => !linksSelected && node.ids.some((id) => activeIds.has(id)),
      )
      .map((node) => node.key),
  );
  const selectedEdges = new Set(
    edges
      .filter((edge) =>
        linksSelected
          ? edge.ids.some((id) => activeIds.has(id))
          : selectedNodes.has(edge.a) || selectedNodes.has(edge.b),
      )
      .map((edge) => edge.key),
  );
  const emphasis = selectedNodes.size || selectedEdges.size;
  const aria = (fn) =>
    onSelect
      ? {
          role: "button",
          tabIndex: 0,
          onClick: fn,
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fn();
            }
          },
        }
      : {};
  return (
    <div className="object-graph topology-canvas">
      <div className="topology-toolbar">
        <div className="segmented" aria-label="拓扑粒度">
          <button
            type="button"
            className={mode === "group" ? "selected" : ""}
            aria-pressed={mode === "group"}
            onClick={() => {
              clearFocus?.();
              setMode("group");
            }}
          >
            分组级
          </button>
          <button
            type="button"
            className={mode === "device" ? "selected" : ""}
            aria-pressed={mode === "device"}
            onClick={() => setMode("device")}
          >
            设备级
          </button>
        </div>
        {networkIds.length > 1 && (
          <label className="topology-filter">
            网络
            <select
              aria-label="图中网络"
              value={network}
              onChange={(event) => {
                setFilter(event.target.value);
                clearFocus?.();
              }}
            >
              <option value="">全部网络</option>
              {networkIds.map((key) => (
                <option key={key} value={key}>
                  {graph.networkNames[key] ?? key}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "device" && (
          <label className="checkline">
            <input
              type="checkbox"
              checked={reserve}
              onChange={(event) => setReserve(event.target.checked)}
            />
            预留设备
          </label>
        )}
      </div>
      {focus && (
        <div className="topology-focus">
          <span>已展开 {focus.title} 及直连设备</span>
          <button className="text-button" type="button" onClick={clearFocus}>
            查看全网
          </button>
        </div>
      )}
      {nodes.length ? (
        <div className="topology-scroll">
          <svg
            viewBox={"0 0 " + layout.width + " " + layout.height}
            style={{
              minWidth:
                mode === "group" ? Math.min(720, layout.width) : layout.width,
            }}
            role={onSelect ? "group" : "img"}
            aria-label="设备与实际连接拓扑"
          >
            <defs>
              <pattern
                id={pattern}
                width="18"
                height="18"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="2" cy="2" r=".7" fill="#d2e1f5" />
              </pattern>
            </defs>
            <rect
              width={layout.width}
              height={layout.height}
              fill={`url(#${pattern})`}
            />
            {layout.lanes.map((lane) => (
              <g key={lane.key}>
                <text className="topology-network-title" x={lane.x + 16} y="30">
                  {trim(lane.title, 28)}
                </text>
                {layout.bands.map((band, i) => (
                  <g key={band}>
                    <rect
                      x={lane.x}
                      y={layout.y[i] - 8}
                      width={lane.width}
                      height={layout.heights[i] - 5}
                      rx="12"
                      className={"topology-band band-" + band}
                    />
                    <text
                      className="topology-band-title"
                      x={lane.x + 15}
                      y={layout.y[i] + 13}
                    >
                      {band === "end" ? "计算 / 存储节点" : TIER[band]}
                    </text>
                  </g>
                ))}
              </g>
            ))}
            {edges.map((edge) => {
              const a = layout.positions.get(edge.a),
                b = layout.positions.get(edge.b);
              const hot = selectedEdges.has(edge.key);
              return (
                <g
                  key={edge.key}
                  {...aria(() =>
                    onSelect?.({
                      type: edge.ids.length === 1 ? "link" : "edge",
                      id: edge.ids[0],
                      ids: edge.ids,
                      title:
                        edge.ids.length === 1
                          ? edge.ids[0]
                          : edge.ids.length + " 条物理链路",
                    }),
                  )}
                  aria-label={
                    edge.ids.length === 1
                      ? edge.ids[0]
                      : edge.ids.length + " 条链路 " + edge.ids[0]
                  }
                  className={"topology-edge" + (hot ? " selected" : "")}
                  opacity={emphasis && !hot ? 0.26 : 1}
                >
                  <title>
                    {edge.ids.length} 条链路 · {edge.capacity} Gbps
                    {edge.up ? "" : " · 预留"}
                  </title>
                  <path
                    d={edgePath(a, b)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="13"
                  />
                  <path
                    d={edgePath(a, b)}
                    fill="none"
                    className="topology-edge-line"
                    strokeDasharray={edge.up ? undefined : "5 5"}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
            {nodes.map((node) => {
              const { x, y, w, h } = layout.positions.get(node.key);
              const [ink, background, border] = SWATCHES[node.type];
              const selected = selectedNodes.has(node.key);
              const duplicate =
                nameCounts.get(
                  JSON.stringify([node.lane, node.type, node.title]),
                ) > 1;
              const count = node.count + " / " + node.ids.length + " 台";
              const note =
                mode === "device"
                  ? node.model
                  : duplicate
                    ? count + " · " + node.model
                    : count;
              return (
                <g
                  key={node.key}
                  {...aria(() =>
                    onSelect?.({
                      type: mode === "group" ? "group" : "device",
                      id: node.id,
                      ids: node.ids,
                      title: node.title,
                    }),
                  )}
                  aria-label={
                    (mode === "group" ? "分组 " : "设备 ") + node.title
                  }
                  data-tier={node.type}
                  className={"topology-node" + (selected ? " selected" : "")}
                  opacity={node.count ? 1 : 0.62}
                >
                  <title>
                    {node.title} · {mode === "group" ? count + " · " : ""}
                    {node.model}
                  </title>
                  <rect
                    x={x - w / 2}
                    y={y - h / 2}
                    width={w}
                    height={h}
                    rx="10"
                    fill={selected ? "#e8f2ff" : background}
                    stroke={selected ? "#6798df" : border}
                    strokeWidth="1.2"
                  />
                  <rect
                    x={x - w / 2 + 9}
                    y={y - h / 2 + 10}
                    width="19"
                    height="19"
                    rx="5"
                    fill={ink}
                  />
                  <path
                    d={
                      node.type === "spine" || node.type === "leaf"
                        ? "M 4 7 h11 M 4 12 h11 M 7 5 v4 M 12 10 v4"
                        : "M 5 6 h9 v7 H5 Z M 7 15 h5"
                    }
                    transform={
                      "translate(" +
                      (x - w / 2 + 9) +
                      " " +
                      (y - h / 2 + 10) +
                      ")"
                    }
                    fill="none"
                    stroke="white"
                    strokeWidth="1.3"
                  />
                  <text
                    x={x - w / 2 + 35}
                    y={y - h / 2 + 23}
                    className="topology-card-title"
                    style={{ fill: ink }}
                  >
                    {trim(node.title, mode === "group" ? 9 : 11)}
                  </text>
                  <text
                    x={x - w / 2 + 10}
                    y={y + h / 2 - 11}
                    className="topology-card-note"
                  >
                    {trim(note, mode === "group" ? 20 : 17)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="object-note">
          当前范围没有设备。可调整网络筛选或导入拓扑。
        </div>
      )}
      <div className="topology-foot">
        <span>
          {nodes.length} 个{mode === "group" ? "分组" : "设备"}
        </span>
        <span>
          {mode === "group"
            ? edges.length
            : edges.reduce((count, edge) => count + edge.ids.length, 0)}{" "}
          条{mode === "group" ? "分组连接" : "物理链路"}
        </span>
        {onSelect && <span>点选对象查看属性与寻优维度</span>}
      </div>
    </div>
  );
}
