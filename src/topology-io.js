import { serviceProfile } from "./service.js";

export const OBJECT_SHEETS = {
  clusters: "Clusters",
  networks: "Networks",
  models: "Models",
  devices: "Devices",
  ports: "Ports",
  links: "Links",
  pools: "Pools",
  groups: "Groups",
  batchRules: "BatchRules",
};
const LISTS = new Set([
  "members",
  "clusters",
  "ratesGbps",
  "leafGroups",
  "sourceGroups",
  "targetGroups",
]);
const split = (value) =>
  String(value)
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function readObjectWorkbook(xlsx, book) {
  if (
    !["Clusters", "Models", "Devices", "Ports", "Links"].every(
      (name) => book.Sheets[name],
    )
  )
    throw Error("对象拓扑工作簿须包含 Clusters、Models、Devices、Ports、Links");
  const model = { version: 1 };
  for (const [key, title] of Object.entries(OBJECT_SHEETS)) {
    model[key] = book.Sheets[title]
      ? xlsx.utils
          .sheet_to_json(book.Sheets[title])
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([field, value]) => [
                field,
                LISTS.has(field)
                  ? split(value).map((entry) =>
                      field === "ratesGbps" ? Number(entry) : entry,
                    )
                  : field === "enabled" && typeof value === "string"
                    ? ({ true: true, false: false }[value.toLowerCase()] ??
                      value)
                    : value,
              ]),
            ),
          )
      : [];
  }
  const faults = book.Sheets.Faults
    ? xlsx.utils.sheet_to_json(book.Sheets.Faults).map((row) => row.id)
    : [];
  if (faults.length) model.faultDevices = faults;
  return model;
}

export function writeObjectWorkbook(xlsx, model, name) {
  const book = xlsx.utils.book_new();
  for (const [key, title] of Object.entries(OBJECT_SHEETS)) {
    const rows = (model[key] ?? []).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([field, value]) => [
          field,
          Array.isArray(value) ? value.join(",") : value,
        ]),
      ),
    );
    xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(rows), title);
  }
  if (model.faultDevices?.length)
    xlsx.utils.book_append_sheet(
      book,
      xlsx.utils.json_to_sheet(model.faultDevices.map((id) => ({ id }))),
      "Faults",
    );
  xlsx.writeFile(book, name);
}

export function singleClusterBundle() {
  const devices = [
    { id: "leaf-a", model: "switch-100", role: "计算 Leaf" },
    { id: "leaf-b", model: "switch-200", role: "存储 Leaf" },
    { id: "compute-01", model: "compute", cluster: "cluster-01" },
    { id: "storage-01", model: "storage" },
  ];
  const ports = [
    ["a-nic", "leaf-a"],
    ["a-u1", "leaf-a"],
    ["a-u2", "leaf-a"],
    ["b-nic", "leaf-b"],
    ["b-u1", "leaf-b"],
    ["b-u2", "leaf-b"],
    ["c-nic", "compute-01"],
    ["s-nic", "storage-01"],
  ].map(([id, device]) => ({ id, device }));
  const model = {
    version: 1,
    clusters: [{ id: "cluster-01", name: "推理集群" }],
    networks: [{ id: "data", name: "业务网络" }],
    models: [
      {
        id: "switch-100",
        name: "24 口 100G 交换机",
        kind: "switch",
        portCount: 24,
        maxGbps: 100,
        ratesGbps: [25, 100],
        switchGbps: 1200,
      },
      {
        id: "switch-200",
        name: "32 口 200G 交换机",
        kind: "switch",
        portCount: 32,
        maxGbps: 200,
        ratesGbps: [25, 100, 200],
        switchGbps: 3200,
      },
      {
        id: "compute",
        name: "100G 计算节点",
        kind: "compute",
        portCount: 1,
        maxGbps: 100,
        slots: 8,
      },
      {
        id: "storage",
        name: "100G 存储节点",
        kind: "storage",
        portCount: 1,
        maxGbps: 100,
        capacityPB: 0.25,
        readGBps: 11,
        writeGBps: 8,
        iops: 20000,
        latencyMs: 0.2,
      },
    ],
    devices,
    ports,
    links: [
      {
        id: "compute-access",
        a: "c-nic",
        b: "a-nic",
        gbps: 100,
        network: "data",
      },
      {
        id: "storage-access",
        a: "b-nic",
        b: "s-nic",
        gbps: 100,
        network: "data",
      },
      {
        id: "uplink-01",
        a: "a-u1",
        b: "b-u1",
        gbps: 25,
        network: "data",
        upgradeCostPerGbps: 0.02,
      },
      {
        id: "uplink-02",
        a: "a-u2",
        b: "b-u2",
        gbps: 100,
        network: "data",
        enabled: false,
        state: "added",
        cost: 2,
      },
    ],
    pools: [
      {
        id: "storage-pool",
        kind: "storage",
        members: ["storage-01"],
        clusters: ["cluster-01"],
      },
    ],
  };
  return {
    model,
    workload: {
      mode: "service",
      seconds: 5,
      duration: 60,
      profiles: [
        {
          domain: "cluster-01",
          model: "推理服务",
          instances: 4,
          peak: 8,
          messageMB: 64,
          interval: 8,
          hotspot: 0,
          checkpoint: 16,
          loadShare: 0,
          readShare: 100,
        },
      ],
      matrix:
        "时间ms,源端点,目的端点,消息MB,并发,类型,集群\n0,storage-01,compute-01,128,5,模型读取,cluster-01",
      services: [
        {
          ...serviceProfile("cluster-01"),
          instances: 4,
          rate: 36,
          readMB: 128,
          ttftLimit: 150,
          goodputLimit: 25,
        },
      ],
    },
    limits: { util: 100, clusters: { "cluster-01": { pb: 0.25 } } },
    search: {
      objective: "cost",
      object: { "links/uplink-01/gbps": { enabled: true, values: "25,100" } },
    },
  };
}
