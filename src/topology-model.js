const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const KINDS = ["switch", "compute", "storage"];
const present = (row) => row.enabled !== false;
const number = (value, min = 0) => Number.isFinite(value) && value >= min;
const arrays = {
  clusters: 100,
  networks: 100,
  models: 1000,
  devices: 3000,
  ports: 12000,
  links: 6000,
  pools: 1000,
};
const sum = (items, value) =>
  items.reduce((total, item) => total + value(item), 0);

function index(rows, title) {
  const map = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !ID.test(row.id) ||
      map.has(row.id)
    )
      throw Error(title + "存在无效或重复编号：" + (row?.id ?? "空"));
    map.set(row.id, row);
  }
  return map;
}

function reference(map, id, subject) {
  const item = map.get(id);
  if (!item) throw Error(subject + "引用了不存在的编号 " + id);
  return item;
}

function distinctRefs(ids, map, title) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    throw Error(title + "须提供非空且不重复的编号列表");
  ids.forEach((id) => reference(map, id, title));
}

export function inspectModel(model) {
  if (model?.version !== 1) throw Error("对象拓扑版本须为 1");
  const sections = {};
  for (const [key, max] of Object.entries(arrays)) {
    const rows =
      model[key] ?? (["networks", "pools"].includes(key) ? [] : null);
    if (
      !Array.isArray(rows) ||
      rows.length > max ||
      (["clusters", "models", "devices"].includes(key) && !rows.length)
    )
      throw Error(key + "须为对象数组，上限 " + max + " 条");
    sections[key] = index(rows, key);
  }
  const { clusters, networks, models, devices, ports, links, pools } = sections;
  for (const row of [
    ...clusters.values(),
    ...networks.values(),
    ...models.values(),
  ])
    if (typeof row.name !== "string" || !row.name.trim())
      throw Error(row.id + "缺少名称");
  for (const model of models.values()) {
    if (
      !KINDS.includes(model.kind) ||
      !Number.isInteger(model.portCount) ||
      model.portCount < 1 ||
      model.portCount > 4096 ||
      !number(model.maxGbps, 0.01) ||
      (model.cost !== undefined && !number(model.cost)) ||
      (model.switchGbps !== undefined &&
        (model.kind !== "switch" || !number(model.switchGbps, 0.01))) ||
      (model.slots !== undefined &&
        (model.kind !== "compute" ||
          !Number.isInteger(model.slots) ||
          model.slots < 1 ||
          model.slots > 128))
    )
      throw Error(model.id + "的设备类型、端口、速率或成本参数无效");
    if (
      model.ratesGbps !== undefined &&
      (!Array.isArray(model.ratesGbps) ||
        !model.ratesGbps.length ||
        model.ratesGbps.some(
          (rate) => !number(rate, 0.01) || rate > model.maxGbps,
        ))
    )
      throw Error(model.id + "的支持速率无效");
    if (
      model.kind === "storage" &&
      (!number(model.capacityPB) ||
        !number(model.readGBps, 0.01) ||
        !number(model.writeGBps, 0.01) ||
        !number(model.iops, 1) ||
        !number(model.latencyMs))
    )
      throw Error(model.id + "缺少有效的存储容量或 I/O 规格");
  }
  const deviceModels = new Map();
  for (const device of devices.values()) {
    deviceModels.set(device.id, reference(models, device.model, device.id));
    if (device.cluster != null) reference(clusters, device.cluster, device.id);
    if (device.enabled !== undefined && typeof device.enabled !== "boolean")
      throw Error(device.id + "启用状态无效");
    if (
      device.state !== undefined &&
      !["existing", "assigned", "added"].includes(device.state)
    )
      throw Error(device.id + "的资产状态无效");
  }
  const portTotals = new Map();
  for (const port of ports.values()) {
    const device = reference(devices, port.device, port.id);
    const spec = deviceModels.get(device.id);
    if (
      port.maxGbps !== undefined &&
      (!number(port.maxGbps, 0.01) || port.maxGbps > spec.maxGbps)
    )
      throw Error(port.id + "端口速率超过型号规格");
    portTotals.set(device.id, (portTotals.get(device.id) ?? 0) + 1);
    if (portTotals.get(device.id) > spec.portCount)
      throw Error(device.id + "的端口数量超过型号规格");
  }
  const poolClusters = new Map();
  for (const pool of pools.values()) {
    if (!["compute", "storage"].includes(pool.kind))
      throw Error(pool.id + "资源池类型无效");
    distinctRefs(pool.members, devices, pool.id + "成员");
    distinctRefs(pool.clusters, clusters, pool.id + "可访问集群");
    if (pool.kind === "compute" && pool.clusters.length !== 1)
      throw Error(pool.id + "计算池须归属单个集群");
    for (const member of pool.members) {
      if (deviceModels.get(member).kind !== pool.kind)
        throw Error(pool.id + "包含类型不匹配的设备 " + member);
      const access = poolClusters.get(member) ?? new Set();
      for (const cluster of pool.clusters) access.add(cluster);
      poolClusters.set(member, access);
    }
  }
  for (const device of devices.values()) {
    const spec = deviceModels.get(device.id);
    if (spec.kind === "switch") continue;
    const access = poolClusters.get(device.id) ?? new Set();
    if (device.cluster) access.add(device.cluster);
    if (spec.kind === "compute" ? access.size !== 1 : !access.size)
      throw Error(
        device.id +
          (spec.kind === "compute" ? "须归属单个集群" : "须指定可访问集群"),
      );
    poolClusters.set(device.id, access);
  }
  const occupied = new Set();
  for (const link of links.values()) {
    const a = reference(ports, link.a, link.id),
      b = reference(ports, link.b, link.id);
    if (a.device === b.device)
      throw Error(link.id + "不能连接同一台设备的端口");
    if (link.network != null) reference(networks, link.network, link.id);
    if (link.enabled !== undefined && typeof link.enabled !== "boolean")
      throw Error(link.id + "启用状态无效");
    for (const key of ["cost", "upgradeCostPerGbps", "baselineGbps"])
      if (link[key] !== undefined && !number(link[key]))
        throw Error(link.id + "费用或基线速率无效");
    if (
      link.state !== undefined &&
      !["existing", "assigned", "added"].includes(link.state)
    )
      throw Error(link.id + "资产状态无效");
    for (const port of [a, b]) {
      const spec = deviceModels.get(port.device);
      if (
        !number(link.gbps, 0.01) ||
        link.gbps > (port.maxGbps ?? spec.maxGbps) ||
        (spec.ratesGbps && !spec.ratesGbps.includes(link.gbps))
      )
        throw Error(link.id + "速率超出端口 " + port.id + " 的支持规格");
      if (
        present(link) &&
        present(devices.get(a.device)) &&
        present(devices.get(b.device))
      ) {
        if (occupied.has(port.id))
          throw Error(port.id + "被多条已启用链路占用");
        occupied.add(port.id);
      }
    }
  }
  if (model.faultDevices !== undefined) {
    distinctRefs(model.faultDevices, devices, "故障设备");
    if (model.faultDevices.some((id) => deviceModels.get(id).kind !== "switch"))
      throw Error("故障场景只接受交换机编号");
  }
  return { ...sections, deviceModels, poolClusters };
}

export function objectCapacity(model, inspected = inspectModel(model)) {
  return Object.fromEntries(
    [...inspected.clusters.keys()].map((cluster) => [
      cluster,
      sum(
        [...inspected.devices.values()].filter(
          (device) =>
            present(device) &&
            inspected.deviceModels.get(device.id).kind === "storage" &&
            inspected.poolClusters.get(device.id)?.has(cluster),
        ),
        (device) => inspected.deviceModels.get(device.id).capacityPB,
      ),
    ]),
  );
}

export function objectCost(model) {
  const { devices, links, ports, deviceModels } = inspectModel(model);
  const lines = [...devices.values()]
    .filter((device) => present(device) && device.state === "added")
    .map((device) => ({
      name: device.id,
      quantity: 1,
      unit: deviceModels.get(device.id).cost ?? 0,
      total: deviceModels.get(device.id).cost ?? 0,
    }));
  for (const link of links.values()) {
    if (
      !present(link) ||
      ![link.a, link.b].every((port) =>
        present(devices.get(ports.get(port).device)),
      )
    )
      continue;
    const total =
      (link.state === "added" ? (link.cost ?? 0) : 0) +
      Math.max(0, link.gbps - (link.baselineGbps ?? link.gbps)) *
        (link.upgradeCostPerGbps ?? 0);
    if (total) lines.push({ name: link.id, quantity: 1, unit: total, total });
  }
  return {
    lines,
    total: Math.round(sum(lines, (line) => line.total) * 100) / 100,
  };
}

export function objectTopology(model, fault) {
  const data = inspectModel(model);
  if (fault && !model.faultDevices?.length)
    throw Error("请在对象拓扑中配置故障交换机");
  const failed = new Set(fault ? model.faultDevices : []);
  const planes = Object.fromEntries(
    [...data.clusters.keys()].map((id) => [id, { C: [], S: [] }]),
  );
  const endpoints = Object.create(null);
  const devices = [];
  const switchBudgets = new Map();
  for (const device of data.devices.values()) {
    const spec = data.deviceModels.get(device.id);
    const enabled = present(device);
    devices.push({
      ...device,
      type: device.role || spec.kind,
      plane: device.cluster,
      ports: spec.portCount,
      modelName: spec.name,
      enabled,
    });
    if (!enabled) continue;
    if (spec.kind === "switch") {
      switchBudgets.set(device.id, spec.switchGbps ?? null);
      continue;
    }
    const clusters = [...data.poolClusters.get(device.id)];
    const kind = spec.kind === "compute" ? "C" : "S";
    endpoints[device.id] = {
      name: device.id,
      plane: device.cluster ?? clusters[0],
      clusters,
      kind,
      nodes: kind === "C" ? (spec.slots ?? 1) : 1,
      profile: spec,
    };
    for (const cluster of clusters) planes[cluster][kind].push(device.id);
  }
  const links = [];
  const adjacencies = new Map();
  for (const row of data.links.values()) {
    const aPort = data.ports.get(row.a),
      bPort = data.ports.get(row.b);
    const a = aPort.device,
      b = bPort.device;
    const down =
      !present(row) ||
      !present(data.devices.get(a)) ||
      !present(data.devices.get(b)) ||
      failed.has(a) ||
      failed.has(b);
    const network = row.network ?? "fabric";
    const link = {
      id: row.id,
      a,
      b,
      aPort: row.a,
      bPort: row.b,
      ports: 1,
      gbps: row.gbps,
      network,
      plane: null,
      type:
        data.deviceModels.get(a).kind === "switch" &&
        data.deviceModels.get(b).kind === "switch"
          ? "上联"
          : "接入",
      down,
    };
    links.push(link);
    if (down) continue;
    if (!adjacencies.has(network)) adjacencies.set(network, new Map());
    const adjacency = adjacencies.get(network);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from).push({ to, link });
    }
  }
  return {
    objectModel: true,
    devices,
    links,
    endpoints,
    planes,
    switchBudgets,
    adjacencies,
    distances: new Map(),
    capacities: objectCapacity(model, data),
    clusterNames: Object.fromEntries(
      [...data.clusters.values()].map(({ id, name }) => [id, name]),
    ),
    networkNames: Object.fromEntries(
      [...data.networks.values()].map(({ id, name }) => [id, name]),
    ),
  };
}

export function objectRoute(graph, { src, dst }, index) {
  if (!graph.endpoints[src] || !graph.endpoints[dst] || src === dst)
    return null;
  if (!graph.distances.has(dst)) {
    const paths = [];
    for (const adjacency of graph.adjacencies.values()) {
      if (!adjacency.has(dst)) continue;
      const distance = new Map([[dst, 0]]);
      const queue = [dst];
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        if (current !== dst && graph.endpoints[current]) continue;
        for (const { to } of adjacency.get(current) ?? []) {
          if (distance.has(to)) continue;
          distance.set(to, distance.get(current) + 1);
          queue.push(to);
        }
      }
      paths.push({ adjacency, distance });
    }
    graph.distances.set(dst, paths);
  }
  const reachable = graph.distances
    .get(dst)
    .filter(({ distance }) => distance.has(src));
  if (!reachable.length) return null;
  const length = Math.min(
    ...reachable.map(({ distance }) => distance.get(src)),
  );
  const shortest = reachable.filter(
    ({ distance }) => distance.get(src) === length,
  );
  const { adjacency, distance } = shortest[index % shortest.length];
  const hops = [];
  let at = src;
  while (at !== dst) {
    const next = adjacency
      .get(at)
      .filter(
        ({ to }) =>
          (to === dst || !graph.endpoints[to]) &&
          distance.get(to) === distance.get(at) - 1,
      );
    const { to, link } = next[(index + hops.length) % next.length];
    hops.push({ key: link.id + (link.a === at ? ">" : "<"), link, to });
    at = to;
  }
  return hops;
}

export function objectDimensions(config, search) {
  const { model } = config;
  const computeModels = new Set(
    model.models
      .filter((spec) => spec.kind === "compute")
      .map((spec) => spec.id),
  );
  const entries = [
    ...model.links.map((row) => ({
      row,
      collection: "links",
      fields: ["gbps", "enabled"],
    })),
    ...model.devices
      .filter((row) => !computeModels.has(row.model))
      .map((row) => ({
        row,
        collection: "devices",
        fields: ["enabled"],
      })),
  ];
  return entries.flatMap(({ row, collection, fields }) =>
    fields.map((field) => {
      const key = collection + "/" + row.id + "/" + field;
      return {
        key,
        collection,
        id: row.id,
        field,
        current: field === "enabled" ? present(row) : row.gbps,
        enabled: search.object?.[key]?.enabled === true,
        values: search.object?.[key]?.values,
      };
    }),
  );
}

export function objectCandidates(config, search) {
  let combinations = [[]];
  for (const dimension of objectDimensions(config, search).filter(
    (item) => item.enabled,
  )) {
    const raw = String(dimension.values ?? dimension.current)
      .split(/[,，]/)
      .map((value) => value.trim());
    const values = [
      ...new Set(
        raw.map((value) =>
          dimension.field === "enabled"
            ? { 启用: true, 停用: false, true: true, false: false }[value]
            : value
              ? Number(value)
              : NaN,
        ),
      ),
    ];
    if (
      values.some((value) =>
        dimension.field === "enabled"
          ? typeof value !== "boolean"
          : !number(value, 0.01),
      )
    )
      throw Error(dimension.id + "候选值无效");
    if (combinations.length * values.length > 160)
      throw Error("单次评估最多 160 个组合，请缩小范围");
    combinations = combinations.flatMap((choices) =>
      values.map((value) =>
        value === dimension.current
          ? choices
          : [
              ...choices,
              {
                collection: dimension.collection,
                id: dimension.id,
                field: dimension.field,
                current: dimension.current,
                value,
              },
            ],
      ),
    );
  }
  return combinations.map((changes) => ({
    config: applyObjectChanges(config, changes),
    changes,
  }));
}

export function applyObjectChanges(config, changes) {
  if (!changes?.length) return config;
  const model = { ...config.model };
  for (const collection of ["devices", "links"]) {
    const edits = changes.filter((change) => change.collection === collection);
    if (!edits.length) continue;
    model[collection] = model[collection].map((row) =>
      edits
        .filter((change) => change.id === row.id)
        .reduce(
          (next, { field, value }) => ({
            ...next,
            ...(field === "gbps"
              ? { baselineGbps: row.baselineGbps ?? row.gbps }
              : {}),
            [field]: value,
          }),
          row,
        ),
    );
  }
  return { ...config, model };
}
