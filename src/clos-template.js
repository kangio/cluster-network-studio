import { reconcileBatches } from "./topology-batch.js";
import { serviceProfile } from "./service.js";

const seq = (count) => Array.from({ length: count }, (_, index) => index);
const key = (cluster, prefix, index) =>
  cluster + "-" + prefix + String(index + 1).padStart(2, "0");
const present = (row) => row.enabled !== false;

export function buildClos({ clusters, hardware }) {
  const model = {
    version: 1,
    clusters: clusters.map(({ id, name }) => ({ id, name })),
    networks: [],
    models: [],
    devices: [],
    ports: [],
    links: [],
    pools: [],
    groups: [],
    batchRules: [],
  };
  const aliases = new Map();
  const pendingRules = [];
  for (const cluster of clusters) {
    const {
      id,
      spines,
      computeLeaves,
      computeNodes,
      uplinks,
      access,
      storage,
      editable,
      price = {},
      legacyFault = true,
    } = cluster;
    const network = id + "-fabric";
    model.networks.push({
      id: network,
      name: cluster.name + " 物理网络",
      maxHops: 4,
    });
    const group = (suffix, name) => {
      const value = id + "-" + suffix;
      model.groups.push({ id: value, name: cluster.name + " · " + name });
      return value;
    };
    const spineGroup = group("spine", "Spine");
    const computeLeafGroup = group("compute-leaf", "计算 Leaf");
    const computeNodeGroup = group("compute-node", "计算节点");
    const storageLeafGroups = storage.leaves
      .filter((row) => row.inventory)
      .map((row) => ({ ...row, group: group(row.key, row.name) }));
    const storageNodeGroups = storage.nodes
      .filter((row) => row.inventory)
      .map((row) => ({ ...row, group: group(row.key, row.name) }));
    const groupUplink = group("uplink", "上联");
    const groupAccess = group("storage-access", "存储接入");
    const modelId = (suffix, spec) => {
      const value = id + "-" + suffix;
      model.models.push({ id: value, ...spec });
      return value;
    };
    const spineSpec = modelId("spine-spec", {
      name: "Spine · " + hardware.spinePorts + " 口",
      kind: "switch",
      portCount: hardware.spinePorts,
      maxGbps: hardware.uplinkGbps,
      cost: price.spine ?? 0,
    });
    const leafMax = Math.max(hardware.uplinkGbps, hardware.accessGbps);
    const leafSpec = (suffix, cost) =>
      modelId(suffix, {
        name: "Leaf · " + hardware.leafPorts + " 口",
        kind: "switch",
        portCount: hardware.leafPorts,
        maxGbps: leafMax,
        cost,
      });
    const computeLeafSpec = leafSpec("compute-leaf-spec", price.leaf ?? 0);
    const computeSpec = modelId("compute-spec", {
      name: "计算节点 · " + hardware.accessGbps + "G",
      kind: "compute",
      portCount: 1,
      maxGbps: hardware.accessGbps,
    });
    const portByDevice = new Map();
    const addDevice = (
      device,
      spec,
      deviceGroup,
      role,
      state,
      enabled,
      ports,
    ) => {
      const item = {
        id: device,
        model: spec,
        cluster: id,
        group: deviceGroup,
        role,
        state,
        enabled,
      };
      model.devices.push(item);
      const list = seq(ports).map((index) => device + ":p" + (index + 1));
      list.forEach((port) => model.ports.push({ id: port, device }));
      portByDevice.set(device, list);
      return item;
    };
    const switchState = price.spine || price.leaf ? "added" : "existing";
    const core = seq(spines).map((i) =>
      addDevice(
        key(id, "SP", i),
        spineSpec,
        spineGroup,
        "Spine",
        switchState,
        true,
        hardware.spinePorts,
      ),
    );
    const compute = seq(computeLeaves).map((i) =>
      addDevice(
        key(id, "CL", i),
        computeLeafSpec,
        computeLeafGroup,
        "计算 Leaf",
        switchState,
        true,
        hardware.leafPorts,
      ),
    );
    const stores = [];
    for (const part of storageLeafGroups) {
      const spec = leafSpec(part.key + "-spec", part.cost ?? 0);
      // Reserve stable IDs for inventory while keeping active leaves in the original order.
      seq(part.inventory).forEach((i) =>
        stores.push(
          addDevice(
            part.state === "assigned" || !editable
              ? key(id, "SL", i + (part.offset ?? 0))
              : key(id, "NL", i),
            spec,
            part.group,
            "存储 Leaf",
            part.state,
            i < part.count,
            hardware.leafPorts,
          ),
        ),
      );
      if (part.variable)
        model.batchRules.push({
          id: part.group + "-count",
          name: part.name + " 数量",
          kind: "device-count",
          group: part.group,
          current: part.count,
        });
    }
    const storageNodes = [];
    for (const part of storageNodeGroups) {
      const spec = modelId(part.key + "-spec", {
        name: part.name + " · " + hardware.accessGbps + "G",
        kind: "storage",
        portCount: 1,
        maxGbps: hardware.accessGbps,
        capacityPB: part.capacityPB,
        readGBps: hardware.readGBps,
        writeGBps: hardware.writeGBps,
        iops: hardware.nodeIOPS,
        latencyMs: hardware.deviceMs,
        cost: part.cost ?? 0,
      });
      seq(part.inventory).forEach((i) =>
        storageNodes.push(
          addDevice(
            key(id, part.prefix, i),
            spec,
            part.group,
            "存储节点",
            part.state,
            i < part.count,
            1,
          ),
        ),
      );
      if (part.variable)
        model.batchRules.push({
          id: part.group + "-count",
          name: part.name + " 数量",
          kind: "device-count",
          group: part.group,
          current: part.count,
        });
    }
    const connect = (id, a, b, gbps, extra = {}) =>
      model.links.push({ id, a, b, gbps, network, ...extra });
    const computeCount = (index) =>
      access?.[key(id, "C", index)] ?? computeNodes;
    for (
      let slot = 0;
      slot < Math.max(...seq(computeLeaves).map(computeCount));
      slot++
    ) {
      for (let i = 0; i < compute.length; i++) {
        if (slot >= computeCount(i)) continue;
        const origin = key(id, "C", i);
        const host = slot ? origin + "-n" + (slot + 1) : origin;
        addDevice(
          host,
          computeSpec,
          computeNodeGroup,
          "计算节点",
          "existing",
          true,
          1,
        );
        const leafPort = portByDevice.get(compute[i].id).at(-1 - slot);
        if (!leafPort) throw Error(compute[i].id + "计算接入端口不足");
        connect(
          host + "-access",
          portByDevice.get(host)[0],
          leafPort,
          hardware.accessGbps,
        );
        if (!slot) aliases.set(origin, host);
      }
    }
    const activeStores = stores.filter(present);
    const leaves = [
      ...compute,
      ...activeStores,
      ...stores.filter((item) => !present(item)),
    ];
    const nextCorePort = new Map(core.map((item) => [item.id, 0]));
    const imported = cluster.connections
      ? new Map(
          leaves.map((item) => [
            item.id,
            cluster.connections
              .filter((row) => row.leaf === item.id)
              .flatMap((row) => seq(row.ports).map(() => row.spine)),
          ]),
        )
      : null;
    // Older templates numbered only active storage leaves. Translate new-stock IDs without changing wiring.
    if (imported && editable)
      activeStores.forEach((device, i) => {
        if (!device.id.includes("-NL")) return;
        imported.set(
          device.id,
          cluster.connections
            .filter((row) => row.leaf === key(id, "SL", i))
            .flatMap((row) => seq(row.ports).map(() => row.spine)),
        );
      });
    const baselineOrders = new Map(
      leaves.map((item, i) => {
        const index = i < compute.length ? i : i - compute.length;
        const importedLanes = imported?.get(item.id);
        const baseline =
          present(item) && importedLanes
            ? importedLanes
            : seq(uplinks).map((lane) => core[(index + lane) % core.length].id);
        return [item.id, { index, baseline }];
      }),
    );
    const availableUplinks = Math.min(
      hardware.leafPorts,
      Math.max(uplinks, cluster.maxUplinks ?? uplinks),
    );
    const maxLanes = Math.max(
      availableUplinks,
      ...[...baselineOrders.values()].map(({ baseline }) => baseline.length),
    );
    // Allocate live ports first. Spare links only use genuinely unused ports.
    for (const reserve of [false, true])
      for (const device of leaves) {
        const { index, baseline } = baselineOrders.get(device.id);
        for (let lane = 0; lane < maxLanes; lane++) {
          const enabled = present(device) && lane < baseline.length;
          if (reserve === enabled) continue;
          const target =
            baseline[lane] ?? core[(index + lane) % core.length].id;
          const used = nextCorePort.get(target);
          const a = portByDevice.get(device.id)[lane],
            b = portByDevice.get(target)?.[used];
          if (!a || !b) {
            if (enabled) throw Error(device.id + "上联端口不足");
            continue;
          }
          nextCorePort.set(target, used + 1);
          connect(device.id + "-up" + (lane + 1), a, b, hardware.uplinkGbps, {
            group: groupUplink,
            order: lane + 1,
            enabled: lane < baseline.length,
            state: price.port ? "added" : "existing",
            cost: price.port ?? 0,
          });
        }
      }
    if (
      editable &&
      leaves
        .filter(present)
        .every(
          (device) => baselineOrders.get(device.id).baseline.length === uplinks,
        )
    )
      model.batchRules.push({
        id: groupUplink + "-count",
        name: "每台 Leaf 上联",
        kind: "uplinks-per-leaf",
        group: groupUplink,
        current: uplinks,
        leafGroups: [
          computeLeafGroup,
          ...storageLeafGroups.map(({ group }) => group),
        ],
      });
    if (storageNodes.length) {
      if (!stores.length) throw Error(cluster.name + "缺少存储 Leaf");
      const firstPort = portByDevice.get(stores[0].id).at(-1);
      for (const node of storageNodes)
        connect(
          node.id + "-access",
          portByDevice.get(node.id)[0],
          firstPort,
          hardware.accessGbps,
          { group: groupAccess, enabled: false },
        );
      model.pools.push({
        id: id + "-storage-pool",
        kind: "storage",
        members: storageNodes.map(({ id }) => id),
        clusters: [id],
      });
      const rule = {
        id: groupAccess + "-distribution",
        name: "存储节点接入分布",
        kind: "attachment-distribution",
        sourceGroups: storageNodeGroups.map(({ group }) => group),
        targetGroups: storageLeafGroups.map(({ group }) => group),
        linkGroup: groupAccess,
        current: storage.distribution,
      };
      model.batchRules.push(rule);
      if (storage.attachmentCounts) {
        let cursor = 0;
        const attached = new Map();
        const used = new Set(
          model.links
            .filter(
              (link) =>
                link.network === network &&
                link.enabled !== false &&
                !link.group?.includes("storage-access"),
            )
            .flatMap((link) => [link.a, link.b]),
        );
        const live = storageNodes.filter(present);
        activeStores.forEach((device, i) => {
          const free = [...portByDevice.get(device.id)]
            .reverse()
            .filter((port) => !used.has(port));
          const count = storage.attachmentCounts[i] ?? 0;
          if (count > free.length) throw Error(device.id + "存储接入端口不足");
          for (let j = 0; j < count; j++, cursor++)
            attached.set(live[cursor].id + "-access", free[j]);
        });
        for (const link of model.links)
          if (attached.has(link.id)) {
            link.b = attached.get(link.id);
            link.enabled = true;
          }
      } else pendingRules.push({ id: rule.id, value: rule.current });
    }
    if (legacyFault && core.length)
      (model.faultDevices ??= []).push(core[0].id);
  }
  const result = reconcileBatches(model, pendingRules);
  const owner = new Map(result.ports.map(({ id, device }) => [id, device]));
  for (const cluster of clusters) {
    const liveLeaves = result.devices.filter(
      (device) =>
        device.cluster === cluster.id &&
        device.role === "存储 Leaf" &&
        present(device),
    );
    liveLeaves.forEach((leaf, i) => {
      const link = result.links.find(
        (item) =>
          item.group === cluster.id + "-storage-access" &&
          present(item) &&
          owner.get(item.b) === leaf.id,
      );
      if (link) aliases.set(key(cluster.id, "S", i), owner.get(link.a));
    });
  }
  return { model: result, aliases };
}

export function legacyClos(config, display, search = {}) {
  const inventory = Math.max(config.reuseLeaves, config.reuseInventory);
  const stock = (key, baseline, minimum, max) => {
    const values = String(search[key] ?? "")
      .split(/[,，]/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= max);
    return Math.max(baseline, minimum, ...values);
  };
  const leaves = (
    count,
    inventory,
    state,
    key,
    name,
    cost = 0,
    variable = false,
  ) => ({ count, inventory, state, key, name, cost, variable });
  const nodes = (
    count,
    inventory,
    state,
    key,
    name,
    prefix,
    capacityPB,
    cost = 0,
    variable = false,
  ) => ({
    count,
    inventory,
    state,
    key,
    name,
    prefix,
    capacityPB,
    cost,
    variable,
  });
  const access = Object.fromEntries(
    (config.attachments ?? []).map(({ endpoint, nodes }) => [endpoint, nodes]),
  );
  const connections = (domain) =>
    config.connections &&
    (config.connectionDomains ?? ["D01", "D02"]).includes(domain)
      ? config.connections.filter((row) => row.leaf.startsWith(domain + "-"))
      : undefined;
  const base = {
    spines: config.spines,
    computeNodes: config.computeNodesPerLeaf,
    access,
  };
  const currentStorage = [
    {
      count: config.domain01StorageLeaves,
      nodes: config.domain01Nodes,
      mode: "均衡",
    },
    {
      count: config.reuseLeaves + config.newLeaves,
      nodes: config.sharedNodes + config.newNodes,
      mode: config.distribution,
    },
  ];
  function attachmentCounts(index) {
    if (!config.attachments) return undefined;
    const domain = index ? "D02" : "D01";
    const { count, nodes, mode } = currentStorage[index];
    const weights = seq(count).map((i) =>
      index && mode === "集中" && i < Math.ceil(count / 2) ? 2 : 1,
    );
    const sum = weights.reduce((a, b) => a + b, 0);
    let before = 0;
    return weights.map((w, i) => {
      const next = before + w;
      const value =
        access[key(domain, "S", i)] ??
        Math.round((nodes * next) / sum) - Math.round((nodes * before) / sum);
      before = next;
      return value;
    });
  }
  const scope = [
    {
      ...base,
      id: "D01",
      name: display?.domains?.D01 ?? "网络域 01",
      computeLeaves: config.domain01Leaves,
      uplinks: config.domain01Uplinks,
      connections: connections("D01"),
      storage: {
        distribution: "均衡",
        attachmentCounts: attachmentCounts(0),
        leaves: [
          leaves(
            config.domain01StorageLeaves,
            config.domain01StorageLeaves,
            "existing",
            "storage-leaf",
            "存量存储 Leaf",
          ),
        ],
        nodes: [
          nodes(
            config.domain01Nodes,
            config.domain01Nodes,
            "existing",
            "storage-node",
            "存量存储节点",
            "ST",
            config.domain01Nodes
              ? config.domain01StoragePB / config.domain01Nodes
              : 0,
          ),
        ],
      },
    },
    {
      ...base,
      id: "D02",
      name: display?.domains?.D02 ?? "网络域 02",
      computeLeaves: config.domain02Leaves,
      uplinks: config.uplinks,
      maxUplinks: stock("uplinks", config.uplinks, 12, 32),
      editable: true,
      connections: connections("D02"),
      price: {
        spine: config.spineCost,
        leaf: config.leafCost,
        port: config.portCost,
      },
      storage: {
        distribution: config.distribution,
        attachmentCounts: attachmentCounts(1),
        leaves: [
          leaves(
            config.reuseLeaves,
            inventory,
            "assigned",
            "reuse-leaf",
            (display?.assigned ?? "沿用") + "存储 Leaf",
            config.reuseCost,
            true,
          ),
          leaves(
            config.newLeaves,
            stock("newLeaves", config.newLeaves, 2, 64),
            "added",
            "new-leaf",
            "新增存储 Leaf",
            config.leafCost,
            true,
          ),
        ],
        nodes: [
          nodes(
            config.sharedNodes,
            config.sharedNodes,
            "existing",
            "shared-node",
            "存量存储节点",
            "ST",
            config.sharedNodes ? config.sharedPB / config.sharedNodes : 0,
          ),
          nodes(
            config.newNodes,
            stock("newNodes", config.newNodes, 28, 1024),
            "added",
            "new-node",
            "新增存储节点",
            "NS",
            config.nodePB,
            config.storageCost,
            true,
          ),
        ],
      },
    },
  ];
  return buildClos({ clusters: scope, hardware: config });
}

const ruleKey = (id) => "batchRules/" + id + "/current";

export function migrateClos(project) {
  const { config, display, workload, limits, search } = project;
  if (config.model) return project;
  const { model, aliases } = legacyClos(config, display, search);
  const legacyRules = {
    "D02-reuse-leaf-count": "reuse",
    "D02-new-leaf-count": "newLeaves",
    "D02-new-node-count": "newNodes",
    "D02-uplink-count": "uplinks",
    "D02-storage-access-distribution": "distributions",
  };
  const object = Object.fromEntries(
    model.batchRules.flatMap((rule) => {
      const key = legacyRules[rule.id];
      return key
        ? [
            [
              ruleKey(rule.id),
              {
                enabled: search.enabled?.[key] ?? key !== "newLeaves",
                values: search[key] ?? String(rule.current),
              },
            ],
          ]
        : [];
    }),
  );
  const matrix = workload.matrix?.replace(
    /^([^,\t\r\n]*[,\t])([^,\t\r\n]*)([,\t])([^,\t\r\n]*)/gm,
    (_, time, src, sep, dst) =>
      time +
      replaceEndpoint(src, aliases) +
      sep +
      replaceEndpoint(dst, aliases),
  );
  const { analysis, ...retained } = project;
  return {
    ...retained,
    config: { model },
    workload: { ...workload, matrix },
    search: { objective: search.objective ?? "cost", object },
    limits: {
      util: limits.util,
      ...(workload.mode !== "service" ? { p99: limits.p99 } : {}),
      clusters: Object.fromEntries(
        ["D01", "D02"].map((id, i) => [
          id,
          {
            pb: limits["domain0" + (i + 1) + "PB"],
            ...(workload.mode !== "service"
              ? {
                  gbps: limits["domain0" + (i + 1) + "GBps"],
                  iops: limits["domain0" + (i + 1) + "IOPS"],
                }
              : {}),
          },
        ]),
      ),
    },
  };
}

function replaceEndpoint(value, aliases) {
  const id = value.trim().replace(/^"|"$/g, "");
  const next = aliases.get(id);
  return next === undefined ? value : value.replace(id, next);
}

export function newTopologyProject(start, clusterCount, settings = {}) {
  const empty = {
    version: 1,
    clusters: [{ id: "cluster-01", name: "集群 01" }],
    models: [],
    devices: [],
    ports: [],
    links: [],
    pools: [],
  };
  if (start !== "clos")
    return {
      config: { model: empty },
      workload: {
        mode: "service",
        duration: 60,
        seconds: 5,
        services: [],
        profiles: [],
        matrix: "",
      },
      limits: { util: 100 },
      search: { objective: "cost", object: {} },
    };
  const {
    spines = 2,
    computeLeaves = 2,
    storageLeaves = 2,
    uplinks = 2,
    uplinkGbps = 100,
    accessGbps = 100,
  } = settings;
  for (const [name, value, min, max] of [
    ["集群数", clusterCount, 1, 8],
    ["Spine 数", spines, 1, 8],
    ["计算 Leaf 数", computeLeaves, 1, 16],
    ["存储 Leaf 数", storageLeaves, 0, 16],
    ["上联数", uplinks, 1, 8],
    ["上联速率", uplinkGbps, 1, 1600],
    ["接入速率", accessGbps, 1, 1600],
  ])
    if (!Number.isInteger(value) || value < min || value > max)
      throw Error(name + "超出可生成范围 " + min + "–" + max);
  const clusters = seq(clusterCount).map((i) => ({
    id: key("cluster", "", i),
    name: "集群 " + String(i + 1).padStart(2, "0"),
    spines,
    computeLeaves,
    computeNodes: 2,
    uplinks,
    maxUplinks: Math.max(uplinks, 4),
    editable: true,
    storage: {
      distribution: "均衡",
      leaves: [
        {
          key: "storage-leaf",
          name: "存储 Leaf",
          count: storageLeaves,
          inventory: storageLeaves + 2,
          state: "added",
          variable: true,
          cost: 18,
        },
      ],
      nodes: [
        {
          key: "storage-node",
          name: "存储节点",
          prefix: "ST",
          count: storageLeaves * 2,
          inventory: storageLeaves * 2 + 4,
          state: "added",
          variable: true,
          cost: 28,
          capacityPB: 0.25,
        },
      ],
    },
  }));
  const { model } = buildClos({
    clusters,
    hardware: {
      spinePorts: 64,
      leafPorts: 32,
      uplinkGbps,
      accessGbps,
      readGBps: 11,
      writeGBps: 8,
      nodeIOPS: 20000,
      deviceMs: 0.18,
    },
  });
  return {
    config: { model },
    workload: {
      mode: "service",
      duration: 60,
      seconds: 5,
      profiles: [],
      matrix: "",
      services: clusters.map(({ id }) => ({
        ...serviceProfile(id),
        instances: Math.min(4, computeLeaves * 2),
        rate: 12,
        readMB: storageLeaves ? 32 : 0,
        goodputLimit: 8,
      })),
    },
    limits: { util: 100 },
    search: { objective: "cost", object: {} },
  };
}
