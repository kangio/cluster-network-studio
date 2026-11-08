import { normalizeMatrix } from "./network-format.js";
const seq = (n) => Array.from({ length: n }, (_, i) => i);
const round = (n, digits = 2) => Number(n.toFixed(digits));
const id = (plane, kind, i) =>
  plane + "-" + kind + String(i + 1).padStart(2, "0");
const linkId = (a, b) => [a, b].sort().join("~");
const hash = (n) => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296;
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const hardware = [
  ["spines", "每域 Spine 数", "台", 1, 32],
  ["spinePorts", "Spine 端口", "个", 1, 256],
  ["uplinkGbps", "上联端口速率", "Gbps", 1, 1600],
  ["accessGbps", "接入端口速率", "Gbps", 1, 1600],
  ["leafPorts", "Leaf 端口", "个", 2, 128],
  ["domain01Uplinks", "D01 每 Leaf 上联", "条", 1, 32],
  ["uplinks", "D02 每 Leaf 上联", "条", 1, 32],
  ["domain01Leaves", "D01 计算 Leaf", "台", 1, 32],
  ["domain02Leaves", "D02 计算 Leaf", "台", 1, 32],
  ["computeNodesPerLeaf", "每 Leaf 计算节点", "台", 1, 64],
  ["domain01StorageLeaves", "D01 存量存储 Leaf", "台", 1, 32],
  ["reuseInventory", "候选利旧 Leaf", "台", 0, 64],
  ["reuseLeaves", "D02 利旧存储 Leaf", "台", 0, 64],
  ["newLeaves", "D02 新增存储 Leaf", "台", 0, 64],
  ["domain01Nodes", "D01 专用存储节点", "台", 0, 1024],
  ["sharedNodes", "D02 利旧存储节点", "台", 0, 1024],
  ["newNodes", "D02 新购存储节点", "台", 0, 1024],
  ["domain01StoragePB", "D01 专用容量", "PB", 0, 1000, 0.1],
  ["sharedPB", "D02 利旧容量", "PB", 0, 1000, 0.1],
  ["nodePB", "新购节点容量", "PB/台", 0.01, 100, 0.01],
  ["readGBps", "单存储节点读吞吐", "GB/s", 0.1, 500, 0.1],
  ["writeGBps", "单存储节点写吞吐", "GB/s", 0.1, 500, 0.1],
  ["nodeIOPS", "单存储节点 IOPS", "次/s", 1, 1e7],
  ["deviceMs", "设备基础服务时延", "ms", 0, 100, 0.01],
  ["leafCost", "新购 Leaf", "万元/台", 0, 10000, 0.1],
  ["reuseCost", "Leaf 利旧改造", "万元/台", 0, 10000, 0.1],
  ["portCost", "上联部署", "万元/条", 0, 10000, 0.01],
  ["storageCost", "新购存储节点", "万元/台", 0, 10000, 0.1],
  ["spineCost", "新购 Spine", "万元/台", 0, 10000, 0.1],
];
export const capacity = (c) => ({
  D01: c.domain01StoragePB,
  D02: round(c.sharedPB + c.newNodes * c.nodePB),
});
export function cost(c) {
  const usesImportedD02 =
    c.connections && (c.connectionDomains ?? ["D01", "D02"]).includes("D02");
  const uplinkCount = usesImportedD02
    ? c.connections
        .filter((row) => row.leaf.startsWith("D02-"))
        .reduce((sum, row) => sum + row.ports, 0)
    : (c.domain02Leaves + c.reuseLeaves + c.newLeaves) * c.uplinks;
  const lines = [
    ["D02 新建 Spine", c.spines, c.spineCost],
    ["D02 新建计算 Leaf", c.domain02Leaves, c.leafCost],
    ["利旧存储 Leaf 改造", c.reuseLeaves, c.reuseCost],
    ["新购存储 Leaf", c.newLeaves, c.leafCost],
    ["D02 上联部署", uplinkCount, c.portCost],
    ["新购存储节点", c.newNodes, c.storageCost],
  ].map(([name, quantity, unit]) => ({
    name,
    quantity,
    unit,
    total: round(quantity * unit),
  }));
  return {
    lines,
    total: round(lines.reduce((sum, row) => sum + row.total, 0)),
  };
}
export function topology(c, fault = false) {
  const devices = [],
    links = [],
    endpoints = {},
    planes = {};
  const attached = new Map(
    (c.attachments ?? []).map((a) => [a.endpoint, a.nodes]),
  );
  const imported = new Map();
  for (const row of c.connections ?? []) {
    if (!imported.has(row.leaf)) imported.set(row.leaf, []);
    imported.get(row.leaf).push(row);
  }
  for (const plane of ["D01", "D02"]) {
    const isD01 = plane === "D01";
    const compute = isD01 ? c.domain01Leaves : c.domain02Leaves;
    const storage = isD01
      ? c.domain01StorageLeaves
      : c.reuseLeaves + c.newLeaves;
    const storageNodes = isD01 ? c.domain01Nodes : c.sharedNodes + c.newNodes;
    const groups = { C: [], S: [] };
    const uplinks = isD01 ? c.domain01Uplinks : c.uplinks;
    const weights = seq(storage).map((i) =>
      !isD01 && c.distribution === "集中" && i < Math.ceil(storage / 2) ? 2 : 1,
    );
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    let cumulative = 0;
    const allocation = weights.map((weight) => {
      const before = Math.round((cumulative * storageNodes) / weightTotal);
      cumulative += weight;
      return Math.round((cumulative * storageNodes) / weightTotal) - before;
    });
    planes[plane] = groups;
    seq(c.spines).forEach((i) =>
      devices.push({
        id: id(plane, "SP", i),
        plane,
        type: "Spine",
        role: isD01 ? "existing" : "added",
        ports: c.spinePorts,
      }),
    );
    for (const [kind, count] of [
      ["C", compute],
      ["S", storage],
    ]) {
      seq(count).forEach((i) => {
        const name = id(plane, kind, i);
        const leaf = id(plane, kind === "C" ? "CL" : "SL", i);
        const nodes =
          attached.get(name) ??
          (kind === "C" ? c.computeNodesPerLeaf : allocation[i]);
        const role = isD01
          ? "existing"
          : kind === "S" && i < c.reuseLeaves
            ? "assigned"
            : "added";
        devices.push({
          id: leaf,
          plane,
          type: kind === "C" ? "计算 Leaf" : "存储 Leaf",
          role,
          ports: c.leafPorts,
          nodes,
        });
        const access = {
          id: linkId(name, leaf),
          a: name,
          b: leaf,
          gbps: c.accessGbps * nodes,
          ports: nodes,
          plane,
          type: "接入",
          down: false,
        };
        links.push(access);
        const routes = {};
        if (
          c.connections &&
          (c.connectionDomains ?? ["D01", "D02"]).includes(plane)
        ) {
          for (const row of imported.get(leaf) ?? [])
            routes[row.spine] = row.ports;
        } else
          seq(uplinks).forEach((u) => {
            const spine = id(plane, "SP", (i + u) % c.spines);
            routes[spine] = (routes[spine] || 0) + 1;
          });
        for (const [spine, ports] of Object.entries(routes)) {
          const uplink = {
            id: linkId(leaf, spine),
            a: leaf,
            b: spine,
            gbps: ports * c.uplinkGbps,
            ports,
            plane,
            type: "上联",
            down: fault && spine === id(plane, "SP", 0),
          };
          links.push(uplink);
          routes[spine] = uplink;
        }
        endpoints[name] = { name, plane, kind, leaf, nodes, access, routes };
        if (nodes) groups[kind].push(name);
      });
    }
  }
  return { devices, links, endpoints, planes };
}
export function validate(c) {
  const issues = [];
  for (const [key, label, , min, max, step] of hardware) {
    const value = c[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (!step && !Number.isInteger(value))
    )
      issues.push(label + "超出允许范围");
  }
  if (!["集中", "均衡"].includes(c.distribution))
    issues.push("接入分布须为集中或均衡");
  if (issues.length) return issues;
  if (c.reuseLeaves > c.reuseInventory) issues.push("利旧 Leaf 数超过候选库存");
  if (c.sharedPB && !c.sharedNodes) issues.push("利旧容量缺少对应存储节点");
  if (c.domain01StoragePB && !c.domain01Nodes)
    issues.push("D01 容量缺少对应存储节点");
  if (c.sharedNodes + c.newNodes && !c.reuseLeaves && !c.newLeaves)
    issues.push("D02 存储节点缺少接入 Leaf");
  const template = topology({
    ...c,
    connections: undefined,
    attachments: undefined,
  });
  const lookup = new Map(template.devices.map((d) => [d.id, d]));
  if (
    c.connectionDomains !== undefined &&
    (!Array.isArray(c.connectionDomains) ||
      !c.connectionDomains.length ||
      c.connectionDomains.some((d) => d !== "D01" && d !== "D02"))
  )
    return [...issues, "连接域只支持 D01 和 D02"];
  if (c.connections !== undefined) {
    if (!Array.isArray(c.connections) || c.connections.length > 10000)
      return [...issues, "连接表最多支持 10,000 行"];
    const seen = new Set();
    for (const row of c.connections) {
      const a = lookup.get(row?.leaf),
        b = lookup.get(row?.spine);
      const key = row?.leaf + "|" + row?.spine;
      if (
        !a ||
        !b ||
        a.type === "Spine" ||
        b.type !== "Spine" ||
        a.plane !== b.plane ||
        !Number.isInteger(row.ports) ||
        row.ports < 1 ||
        row.ports > 128 ||
        seen.has(key)
      ) {
        issues.push("上联表存在非法端点、端口数或重复连接：" + key);
        break;
      }
      seen.add(key);
    }
  }
  if (c.attachments !== undefined) {
    if (!Array.isArray(c.attachments) || c.attachments.length > 512)
      return [...issues, "接入表最多支持 512 行"];
    const seen = new Set();
    for (const row of c.attachments) {
      if (
        !template.endpoints[row?.endpoint] ||
        !Number.isInteger(row.nodes) ||
        row.nodes < 0 ||
        row.nodes > 128 ||
        seen.has(row.endpoint)
      ) {
        issues.push("接入表存在非法端点、节点数或重复配置：" + row?.endpoint);
        break;
      }
      seen.add(row.endpoint);
    }
  }
  if (issues.length) return issues;
  const graph = c.connections || c.attachments ? topology(c) : template;
  if (c.attachments) {
    for (const plane of ["D01", "D02"])
      for (const kind of ["C", "S"]) {
        const actual = graph.planes[plane][kind].reduce(
          (n, e) => n + graph.endpoints[e].nodes,
          0,
        );
        const expected = template.planes[plane][kind].reduce(
          (n, e) => n + template.endpoints[e].nodes,
          0,
        );
        if (actual !== expected)
          issues.push(
            plane +
              " " +
              (kind === "S" ? "存储" : "计算") +
              "接入节点总数与资源池不符",
          );
      }
  }
  for (const plane of ["D01", "D02"]) {
    for (const src of graph.planes[plane].C)
      for (const dest of graph.planes[plane].S) {
        const a = graph.endpoints[src],
          b = graph.endpoints[dest];
        if (
          !Object.keys(a.routes).some((sp) => b.routes[sp]) &&
          issues.length < 12
        )
          issues.push(src + " 与 " + dest + " 没有共同 Spine");
      }
  }
  const ports = {};
  for (const link of graph.links) {
    ports[link.a] = (ports[link.a] || 0) + link.ports;
    ports[link.b] = (ports[link.b] || 0) + link.ports;
  }
  for (const d of graph.devices)
    if (ports[d.id] > d.ports)
      issues.push(
        d.id + " 需 " + ports[d.id] + " 个端口，可用 " + d.ports + " 个",
      );
  return issues;
}
export function parseMatrix(raw, graph, duration) {
  const rows = raw.trim().split(/\r?\n/).filter(Boolean);
  if (/^"?(时间|time)/i.test(rows[0] || "")) rows.shift();
  if (!rows.length) throw Error("通信矩阵为空");
  if (rows.length > 2000) throw Error("Demo 支持最多 2,000 行通信记录");
  return rows.map((line, i) => {
    const [t, src, dst, m, p, type = "业务读取"] = line
      .split(/[,\t](?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((s) => s.trim().replace(/^"|"$/g, "").replaceAll('""', '"'));
    const time = Number(t),
      mb = Number(m),
      parallel = Number(p);
    const a = graph.endpoints[src],
      b = graph.endpoints[dst];
    if (
      !a?.nodes ||
      !b?.nodes ||
      a.plane !== b.plane ||
      src === dst ||
      !t ||
      !Number.isFinite(time) ||
      time < 0 ||
      time >= duration ||
      !(mb > 0 && mb <= 1e6) ||
      !Number.isInteger(parallel) ||
      parallel < 1 ||
      parallel > 100000
    )
      throw Error(
        "通信矩阵第 " +
          (i + 1) +
          " 条记录无效，请检查端点、发送时间、消息大小与并发",
      );
    return { time, src, dst, mb, parallel, type, plane: a.plane };
  });
}
export function traffic(workload, graph, distribution) {
  if (
    !Number.isInteger(workload.duration) ||
    workload.duration < 10 ||
    workload.duration > 400
  )
    throw Error("负载窗口须为 10–400 ms 的整数");
  if (workload.mode === "matrix")
    return parseMatrix(
      normalizeMatrix(workload.matrix),
      graph,
      workload.duration,
    );
  if (workload.mode !== "profile") throw Error("未知的业务负载模式");
  if (
    !Array.isArray(workload.profiles) ||
    !workload.profiles.length ||
    workload.profiles.length > 8
  )
    throw Error("至少配置一个业务画像，最多八个");
  const flows = [];
  for (const [pIndex, p] of workload.profiles.entries()) {
    const endpoints = graph.planes[p.domain];
    if (
      !endpoints ||
      !p.model ||
      !Number.isInteger(p.instances) ||
      p.instances < 1 ||
      p.instances > 256 ||
      !Number.isInteger(p.peak) ||
      p.peak < 1 ||
      p.peak > 50000 ||
      !(p.messageMB > 0 && p.messageMB <= 1e5) ||
      !Number.isInteger(p.interval) ||
      p.interval < 3 ||
      p.interval > 400 ||
      !Number.isInteger(p.checkpoint) ||
      p.checkpoint < 3 ||
      p.checkpoint > 400 ||
      [p.hotspot, p.loadShare, p.readShare].some((x) => !(x >= 0 && x <= 100))
    )
      throw Error("业务画像字段超出范围，请检查实例数、并发、消息大小和时序");
    if (!endpoints.C.length || !endpoints.S.length)
      throw Error(p.domain + " 缺少可访问的计算或存储端点");
    const { C, S } = endpoints;
    const groups = Math.min(C.length * 2, p.instances, 16);
    for (let time = 0; time < workload.duration; time += p.interval) {
      const burst = (1 + Math.sin(time * 0.24 + pIndex)) * 0.17 + 0.65;
      const launch = time < p.interval * 2;
      const checkpoint = time > 0 && time % p.checkpoint < p.interval;
      for (let i = 0; i < groups; i++) {
        const n = time * 97 + i * 31 + pIndex * 7;
        const compute = C[i % C.length];
        const strategy = p.domain === "D01" ? "集中" : distribution;
        const hot = strategy === "集中" && hash(n) < p.hotspot / 100;
        const hotSize = Math.max(1, Math.ceil(S.length * 0.13));
        const store =
          S[
            hot
              ? i % hotSize
              : strategy === "均衡"
                ? (i + Math.floor(time / p.interval)) % S.length
                : Math.floor(hash(n + 29) * S.length)
          ];
        const isLoad = launch && hash(n + 55) < p.loadShare / 100;
        const isWrite =
          !isLoad &&
          ((checkpoint && i % 3 === 0) || hash(n + 73) >= p.readShare / 100);
        const parallel = Math.round(
          ((p.peak * burst) / groups) *
            (isLoad ? 1.3 : checkpoint && isWrite ? 1.1 : 1),
        );
        if (!parallel) continue;
        flows.push({
          time: time + (i % 4) * 0.25,
          src: isWrite ? compute : store,
          dst: isWrite ? store : compute,
          mb: p.messageMB * (isLoad ? 1.35 : isWrite ? 0.8 : 1),
          parallel,
          plane: p.domain,
          type: isLoad
            ? "模型加载"
            : checkpoint && isWrite
              ? "周期持久化"
              : isWrite
                ? "业务写入"
                : "业务读取",
          model: p.model,
        });
      }
    }
  }
  if (!flows.length) throw Error("画像未生成任何流量");
  if (flows.length > 20000)
    throw Error("业务画像生成的通信批次超过 20,000，请缩短窗口或增大发送间隔");
  return flows;
}
function route(graph, flow, index) {
  const a = graph.endpoints[flow.src],
    b = graph.endpoints[flow.dst];
  const hops = [];
  const append = (link, from) =>
    hops.push({ key: link.id + (link.a === from ? ">" : "<"), link });
  append(a.access, a.name);
  if (a.leaf !== b.leaf) {
    const spines = Object.keys(a.routes).filter(
      (s) => !a.routes[s].down && b.routes[s] && !b.routes[s].down,
    );
    if (!spines.length) return null;
    const spine = spines[index % spines.length];
    append(a.routes[spine], a.leaf);
    append(b.routes[spine], spine);
  }
  append(b.access, b.leaf);
  return hops;
}
function percentile(rows, p) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  const goal = sorted.reduce((sum, r) => sum + r.weight, 0) * p;
  let sum = 0;
  return round(sorted.find((r) => (sum += r.weight) >= goal).value, 3);
}
const STEP = 0.5;
const EPS = 1e-7;
const LIMITS = [
  ["domain01PB", "D01 容量", "PB"],
  ["domain02PB", "D02 容量", "PB"],
  ["domain01GBps", "D01 有效吞吐", "GB/s"],
  ["domain02GBps", "D02 有效吞吐", "GB/s"],
  ["domain01IOPS", "D01 完成 IOPS", "IOPS"],
  ["domain02IOPS", "D02 完成 IOPS", "IOPS"],
  ["p99", "分域最大 P99 完成时延", "ms"],
  ["util", "最大链路利用率", "%"],
];
export { LIMITS };
function run(c, w, limits, fault, detail) {
  const graph = topology(c, fault);
  const offered = traffic(w, graph, c.distribution);
  const pending = [],
    completed = [];
  let dropped = 0;
  const resources = new Map();
  const linkStats = new Map(
    graph.links.map((l) => [
      l.id,
      {
        ...l,
        peak: 0,
        queue: 0,
        types: Object.create(null),
        sources: Object.create(null),
        series: detail ? [] : undefined,
      },
    ]),
  );
  function resource(key, budget, coef, stat, kind) {
    if (!resources.has(key)) resources.set(key, { budget, kind });
    return { key, coef, stat };
  }
  offered.forEach((flow, i) => {
    const source = graph.endpoints[flow.src],
      dest = graph.endpoints[flow.dst];
    const storage = [
      [source, "read"],
      [dest, "write"],
    ].filter(([e]) => e.kind === "S");
    const shards = Math.min(flow.parallel, 4, c.spines);
    for (let j = 0; j < shards; j++) {
      const parallel =
        Math.floor(flow.parallel / shards) +
        (j < flow.parallel % shards ? 1 : 0);
      const hops = route(graph, flow, i + j);
      if (!hops) {
        dropped += parallel;
        continue;
      }
      const req = hops.map((h) =>
        resource(
          h.key,
          (h.link.gbps * STEP) / 8,
          1,
          linkStats.get(h.link.id),
          "network",
        ),
      );
      for (const [endpoint, direction] of storage) {
        req.push(
          resource(
            endpoint.name + direction,
            (direction === "read" ? c.readGBps : c.writeGBps) *
              endpoint.nodes *
              STEP,
            1,
            null,
            "storage",
          ),
        );
        req.push(
          resource(
            endpoint.name + "ops",
            (c.nodeIOPS * endpoint.nodes * STEP) / 1000,
            1 / flow.mb,
            null,
            "storage",
          ),
        );
      }
      pending.push({
        ...flow,
        parallel,
        req,
        storageOps: storage.length,
        remaining: flow.mb * parallel,
        delay: storage.length * c.deviceMs + hops.length * 0.003,
      });
    }
  });
  pending.sort((a, b) => a.time - b.time);
  const active = [],
    series = [];
  let cursor = 0,
    last = 0,
    waiting = 0;
  const stepStats = new Map();
  for (let t = 0; t < w.duration + Math.min(400, w.duration * 3); t += STEP) {
    while (cursor < pending.length && pending[cursor].time <= t + EPS)
      active.push(pending[cursor++]);
    if (!active.length && cursor === pending.length && t >= w.duration) break;
    const budgets = new Map();
    const rates = new Map();
    const pressure = new Map();
    if (detail) {
      for (const f of active)
        for (const r of f.req)
          if (r.stat)
            pressure.set(
              r.stat.id,
              (pressure.get(r.stat.id) || 0) + f.remaining,
            );
    }
    let unsettled = [...active];
    // Progressive filling: every co-routed message receives the same increment until a path resource saturates.
    while (unsettled.length) {
      const weights = new Map();
      let increment = Infinity;
      for (const f of unsettled) {
        increment = Math.min(
          increment,
          (f.remaining - (rates.get(f) || 0)) / f.parallel,
        );
        for (const r of f.req) {
          weights.set(r.key, (weights.get(r.key) || 0) + f.parallel * r.coef);
          if (!budgets.has(r.key))
            budgets.set(r.key, resources.get(r.key).budget);
        }
      }
      for (const [key, weight] of weights)
        increment = Math.min(increment, budgets.get(key) / weight);
      const constrained = new Set();
      for (const [key, weight] of weights) {
        const left = Math.max(0, budgets.get(key) - weight * increment);
        budgets.set(key, left);
        if (left < EPS) constrained.add(key);
      }
      unsettled = unsettled.filter((f) => {
        const amount = (rates.get(f) || 0) + increment * f.parallel;
        rates.set(f, amount);
        return (
          amount < f.remaining - EPS &&
          !f.req.some((r) => constrained.has(r.key))
        );
      });
    }
    let transferred = 0,
      queue = 0;
    const finishedThisStep = [];
    const directionUse = new Map();
    for (let i = active.length - 1; i >= 0; i--) {
      const f = active[i],
        amount = rates.get(f) || 0;
      f.remaining = Math.max(0, f.remaining - amount);
      transferred += amount;
      queue += f.remaining;
      for (const r of f.req)
        if (r.stat) {
          directionUse.set(r.key, (directionUse.get(r.key) || 0) + amount);
          if (detail && amount) {
            r.stat.types[f.type] = (r.stat.types[f.type] || 0) + amount;
            const source =
              f.src +
              " → " +
              f.dst +
              " · " +
              (f.model ? f.model + " / " : "") +
              f.type;
            r.stat.sources[source] = (r.stat.sources[source] || 0) + amount;
          }
        }
      if (f.remaining <= EPS) {
        const finish = t + STEP + f.delay;
        const row = {
          plane: f.plane,
          time: finish,
          value: finish - f.time,
          weight: f.parallel,
          mb: f.mb * f.parallel,
          ops: f.parallel * f.storageOps,
        };
        completed.push(row);
        if (detail) finishedThisStep.push(row);
        last = Math.max(last, finish);
        active.splice(i, 1);
      } else {
        for (const r of f.req) {
          if ((budgets.get(r.key) ?? 1) > EPS) continue;
          const kind = resources.get(r.key).kind;
          stepStats.set(kind, (stepStats.get(kind) || 0) + f.parallel * STEP);
        }
      }
    }
    waiting = Math.max(queue, waiting);
    for (const [key, amount] of directionUse) {
      const stat = linkStats.get(key.slice(0, -1));
      stat.peak = Math.max(
        stat.peak,
        (100 * amount) / resources.get(key).budget,
      );
    }
    if (detail) {
      for (const stat of linkStats.values()) {
        stat.queue = Math.max(stat.queue, pressure.get(stat.id) || 0);
        stat.series.push(
          round(
            (100 *
              Math.max(
                directionUse.get(stat.id + ">") || 0,
                directionUse.get(stat.id + "<") || 0,
              )) /
              ((stat.gbps * STEP) / 8 || 1),
            1,
          ),
        );
      }
      series.push({
        t: round(t + STEP),
        rate: round(transferred / STEP),
        queue: round(queue),
        latency: percentile(finishedThisStep, 0.99),
      });
    }
  }
  const unfinished =
    active.reduce((sum, f) => sum + f.parallel, 0) +
    pending.slice(cursor).reduce((sum, f) => sum + f.parallel, 0);
  const span = Math.max(w.duration, last);
  const domains = Object.fromEntries(
    ["D01", "D02"].map((plane) => {
      const rows = completed.filter((f) => f.plane === plane);
      const requests = rows.reduce((sum, r) => sum + r.weight, 0);
      return [
        plane,
        {
          throughput: round(rows.reduce((sum, r) => sum + r.mb, 0) / span),
          iops: Math.round(
            (rows.reduce((sum, r) => sum + r.ops, 0) * 1000) / span,
          ),
          p95: percentile(rows, 0.95),
          p99: percentile(rows, 0.99),
          capacity: capacity(c)[plane],
          requests,
        },
      ];
    }),
  );
  const allLinks = [...linkStats.values()];
  allLinks.forEach((s) => {
    s.peak = round(s.peak, 1);
    s.queue = round(s.queue);
    s.sources = Object.entries(s.sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  });
  allLinks.sort((a, b) => b.peak - a.peak || b.queue - a.queue);
  const p99 = Math.max(...Object.values(domains).map((d) => d.p99 ?? 0));
  const values = [
    domains.D01.capacity,
    domains.D02.capacity,
    domains.D01.throughput,
    domains.D02.throughput,
    domains.D01.iops,
    domains.D02.iops,
    p99,
    allLinks[0]?.peak ?? 0,
  ];
  const checks = LIMITS.map(([key, label, unit], i) => ({
    key,
    label,
    unit,
    value: values[i],
    limit: limits[key],
    pass: i < 6 ? values[i] >= limits[key] : values[i] <= limits[key],
  }));
  checks.push({
    key: "delivery",
    label: "通信完成率",
    unit: "%",
    value: round(
      100 *
        (1 -
          (unfinished + dropped) /
            offered.reduce((sum, f) => sum + f.parallel, 0)),
    ),
    limit: 100,
    pass: !unfinished && !dropped,
  });
  return {
    pass: checks.every((x) => x.pass),
    checks,
    domains,
    p99,
    p95: percentile(completed, 0.95),
    util: values[7],
    throughput: round(domains.D01.throughput + domains.D02.throughput),
    span: round(span),
    waiting: round(waiting),
    unfinished,
    dropped,
    networkPressure: stepStats.get("network") || 0,
    storagePressure: stepStats.get("storage") || 0,
    links: detail ? allLinks.filter((l) => l.gbps) : [],
    series,
    flowCount: offered.reduce((s, f) => s + f.parallel, 0),
  };
}
export function simulate(c, w, limits, fault = false, detail = true) {
  const issues = validate(c);
  if (issues.length) throw Error(issues.slice(0, 3).join("；"));
  if (
    LIMITS.some(([key]) => !Number.isFinite(limits[key]) || limits[key] < 0) ||
    limits.util > 100
  )
    throw Error("性能约束必须为非负数，利用率不得超过 100%");
  return run(c, w, limits, fault, detail);
}
function numbers(raw, min, max) {
  const parts = String(raw)
    .split(/[,，]/)
    .map((x) => x.trim());
  if (
    parts.some(
      (x) =>
        !x ||
        !Number.isInteger(Number(x)) ||
        Number(x) < min ||
        Number(x) > max,
    )
  )
    throw Error("搜索范围须输入合法的逗号分隔整数");
  return [...new Set(parts.map(Number))];
}
export function optimize(c, w, limits, search, onProgress = () => {}) {
  if (
    LIMITS.some(([key]) => !Number.isFinite(limits[key]) || limits[key] < 0) ||
    limits.util > 100
  )
    throw Error("性能约束必须为非负数，利用率不得超过 100%");
  const reuse = numbers(search.reuse, 0, 64),
    nodes = numbers(search.newNodes, 0, 1024),
    up = numbers(search.uplinks, 1, 32);
  const distributions = [
    ...new Set(search.distributions.split(/[,，]/).map((x) => x.trim())),
  ];
  if (distributions.some((x) => !["集中", "均衡"].includes(x)))
    throw Error("接入分布只接受集中和均衡");
  const total = reuse.length * nodes.length * up.length * distributions.length;
  if (total > 160) throw Error("单次搜索最多 160 个组合，请缩小范围");
  const rows = [];
  for (const r of reuse)
    for (const n of nodes)
      for (const u of up)
        for (const distribution of distributions) {
          const connections =
            c.connections &&
            (c.connectionDomains ?? ["D01", "D02"]).includes("D01")
              ? c.connections.filter((row) => row.leaf.startsWith("D01-"))
              : undefined;
          const attachments = c.attachments?.filter((row) =>
            row.endpoint.startsWith("D01-"),
          );
          const config = {
            ...c,
            reuseLeaves: r,
            newNodes: n,
            uplinks: u,
            distribution,
            connections,
            connectionDomains: connections ? ["D01"] : undefined,
            attachments,
          };
          const cap = capacity(config);
          const issues = validate(config);
          const legal = !issues.length;
          if (cap.D01 < limits.domain01PB)
            issues.push(
              "D01 容量缺口 " + round(limits.domain01PB - cap.D01) + " PB",
            );
          if (cap.D02 < limits.domain02PB)
            issues.push(
              "D02 容量缺口 " + round(limits.domain02PB - cap.D02) + " PB",
            );
          const row = {
            id: "P" + String(rows.length + 1).padStart(3, "0"),
            config,
            cost: cost(config).total,
            issues,
            cap,
            legal,
          };
          if (!issues.length) {
            try {
              const normal = simulate(config, w, limits, false, false);
              const fault = limits.fault
                ? simulate(config, w, limits, true, false)
                : null;
              row.result = normal;
              row.fault = fault;
              row.pass = normal.pass && (!fault || fault.pass);
              row.margin = Math.min(
                ...[normal, ...(fault ? [fault] : [])].flatMap((x) =>
                  x.checks
                    .filter((k) => k.limit && k.key !== "delivery")
                    .map(
                      (k) =>
                        (["p99", "util"].includes(k.key)
                          ? k.limit - k.value
                          : k.value - k.limit) / k.limit,
                    ),
                ),
              );
            } catch (error) {
              row.issues.push(error.message);
            }
          }
          rows.push(row);
          if (rows.length === total || rows.length % 3 === 0)
            onProgress(rows.length, total, rows.filter((r) => r.pass).length);
        }
  const feasible = rows.filter((r) => r.pass);
  for (const r of feasible)
    r.pareto = !feasible.some(
      (s) =>
        s.cost <= r.cost &&
        s.result.throughput >= r.result.throughput &&
        s.result.p99 <= r.result.p99 &&
        (s.cost < r.cost ||
          s.result.throughput > r.result.throughput ||
          s.result.p99 < r.result.p99),
    );
  feasible.sort(
    (a, b) =>
      (search.objective === "throughput"
        ? b.result.throughput - a.result.throughput
        : search.objective === "margin"
          ? b.margin - a.margin
          : a.cost - b.cost) ||
      a.cost - b.cost ||
      a.result.p99 - b.result.p99,
  );
  const legal = rows.filter((r) => r.legal);
  const capacityGap = Object.fromEntries(
    ["D01", "D02"].map((plane) => {
      const target = plane === "D01" ? limits.domain01PB : limits.domain02PB;
      const best = legal.length
        ? Math.max(...legal.map((r) => r.cap[plane]))
        : null;
      return [plane, best === null ? null : Math.max(0, round(target - best))];
    }),
  );
  return {
    rows,
    recommended: feasible[0]?.id || null,
    total,
    feasible: feasible.length,
    filtered: rows.filter((r) => !r.result).length,
    capacityGap,
  };
}
