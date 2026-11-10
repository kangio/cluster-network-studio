export const BATCH_KINDS = {
  "device-count": "启用设备数",
  "uplinks-per-leaf": "每 Leaf 上联数",
  "attachment-distribution": "接入分布",
};

function active(row) {
  return row.enabled !== false;
}

export function verifyBatchRules(model, devices, links, ports) {
  const groups = new Set((model.groups ?? []).map(({ id }) => id));
  for (const rule of model.batchRules ?? []) {
    if (
      !Object.hasOwn(BATCH_KINDS, rule.kind) ||
      typeof rule.name !== "string" ||
      !rule.name.trim()
    )
      throw Error(rule.id + "的批量规则类型或名称无效");
    if (rule.kind === "attachment-distribution") {
      for (const field of ["sourceGroups", "targetGroups"]) {
        if (
          !Array.isArray(rule[field]) ||
          !rule[field].length ||
          rule[field].some((id) => !groups.has(id))
        )
          throw Error(rule.id + "引用了不存在的接入分组");
      }
      if (
        !["集中", "均衡"].includes(rule.current) ||
        ![...links.values()].some((link) => link.group === rule.linkGroup)
      )
        throw Error(rule.id + "的接入分布或链路分组无效");
    } else {
      const pool =
        rule.kind === "device-count"
          ? [...devices.values()].filter(
              (device) => device.group === rule.group,
            )
          : [...links.values()].filter((link) => link.group === rule.group);
      if (
        rule.kind === "device-count" &&
        pool.filter(active).length !== rule.current
      )
        throw Error(rule.id + "的当前值与实际启用的设备数不一致");
      if (rule.kind === "uplinks-per-leaf" && rule.leafGroups) {
        if (
          !Array.isArray(rule.leafGroups) ||
          rule.leafGroups.some((id) => !groups.has(id))
        )
          throw Error(rule.id + "引用了不存在的 Leaf 分组");
        const counts = new Map();
        for (const link of pool.filter(active)) {
          const owner = ports.get(link.a)?.device;
          counts.set(owner, (counts.get(owner) ?? 0) + 1);
        }
        for (const device of devices.values())
          if (
            active(device) &&
            rule.leafGroups.includes(device.group) &&
            (counts.get(device.id) ?? 0) !== rule.current
          )
            throw Error(device.id + "的实际启用上联数与批量规则不一致");
      }
      if (
        !groups.has(rule.group) ||
        !pool.length ||
        !Number.isInteger(rule.current) ||
        rule.current < 0 ||
        (rule.kind === "device-count" && rule.current > pool.length) ||
        (rule.kind === "uplinks-per-leaf" &&
          (rule.current < 1 ||
            pool.some(
              (link) => !Number.isInteger(link.order) || link.order < 1,
            ) ||
            rule.current > Math.max(...pool.map((link) => link.order))))
      )
        throw Error(rule.id + "的当前值、库存或批量分组无效");
    }
  }
}

export function batchDimensions(model, search) {
  return (model.batchRules ?? []).map((rule) => ({
    key: "batchRules/" + rule.id + "/current",
    collection: "batchRules",
    id: rule.id,
    field: "current",
    name: rule.name,
    kind: rule.kind,
    current: rule.current,
    enabled:
      search.object?.["batchRules/" + rule.id + "/current"]?.enabled === true,
    values: search.object?.["batchRules/" + rule.id + "/current"]?.values,
  }));
}

export function validateBatchValue(model, dimension, value) {
  const rule = model.batchRules.find((item) => item.id === dimension.id);
  if (rule.kind === "attachment-distribution")
    return ["集中", "均衡"].includes(value);
  if (!Number.isInteger(value)) return false;
  if (rule.kind === "device-count")
    return (
      value >= 0 &&
      value <= model.devices.filter((item) => item.group === rule.group).length
    );
  const max = Math.max(
    0,
    ...model.links
      .filter((item) => item.group === rule.group)
      .map((item) => item.order),
  );
  return value >= 1 && value <= max;
}

export function reconcileBatches(model, changes) {
  if (!changes.length) return model;
  const overrides = new Map(changes.map(({ id, value }) => [id, value]));
  const batchRules = (model.batchRules ?? []).map((rule) =>
    overrides.has(rule.id)
      ? { ...rule, current: overrides.get(rule.id) }
      : rule,
  );
  let devices = model.devices;
  let links = model.links;
  for (const rule of batchRules) {
    if (!overrides.has(rule.id)) continue;
    if (rule.kind === "device-count") {
      let count = 0;
      devices = devices.map((device) =>
        device.group === rule.group
          ? { ...device, enabled: count++ < rule.current }
          : device,
      );
    } else if (rule.kind === "uplinks-per-leaf") {
      links = links.map((link) =>
        link.group === rule.group
          ? { ...link, enabled: link.order <= rule.current }
          : link,
      );
    }
  }
  for (const rule of batchRules.filter(
    ({ kind }) => kind === "uplinks-per-leaf",
  )) {
    if (
      !rule.leafGroups ||
      (!overrides.has(rule.id) &&
        !batchRules.some(
          (other) =>
            other.kind === "device-count" &&
            overrides.has(other.id) &&
            rule.leafGroups.includes(other.group),
        ))
    )
      continue;
    const owner = new Map(model.ports.map(({ id, device }) => [id, device]));
    const counts = new Map();
    for (const link of links.filter(
      (item) => item.group === rule.group && active(item),
    )) {
      const id = owner.get(link.a);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const device of devices.filter(
      (item) => active(item) && rule.leafGroups.includes(item.group),
    ))
      if ((counts.get(device.id) ?? 0) !== rule.current)
        throw Error(device.id + "缺少 " + rule.current + " 条可用上联");
  }
  const portOwner = new Map(model.ports.map(({ id, device }) => [id, device]));
  const portsByDevice = new Map();
  for (const port of model.ports) {
    const list = portsByDevice.get(port.device) ?? [];
    list.push(port.id);
    portsByDevice.set(port.device, list);
  }
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  for (const rule of batchRules.filter(
    (item) => item.kind === "attachment-distribution",
  )) {
    const related = new Set([...rule.sourceGroups, ...rule.targetGroups]);
    const needsMapping =
      overrides.has(rule.id) ||
      batchRules.some(
        (other) =>
          overrides.has(other.id) &&
          other.kind === "device-count" &&
          related.has(other.group),
      ) ||
      batchRules.some(
        (other) =>
          overrides.has(other.id) &&
          other.kind === "uplinks-per-leaf" &&
          links.some(
            (link) =>
              link.group === other.group &&
              related.has(deviceById.get(portOwner.get(link.a))?.group),
          ),
      );
    if (!needsMapping) continue;
    const source = devices.filter(
      (device) => active(device) && rule.sourceGroups.includes(device.group),
    );
    const target = devices.filter(
      (device) => active(device) && rule.targetGroups.includes(device.group),
    );
    if (!target.length && source.length)
      throw Error(rule.name + "缺少启用的接入设备");
    const managed = links.filter((link) => link.group === rule.linkGroup);
    const bySource = new Map(
      managed.map((link) => [portOwner.get(link.a), link]),
    );
    const busy = new Set(
      links
        .filter(
          (link) =>
            link.group !== rule.linkGroup &&
            active(link) &&
            active(deviceById.get(portOwner.get(link.a))) &&
            active(deviceById.get(portOwner.get(link.b))),
        )
        .flatMap((link) => [link.a, link.b]),
    );
    const weights = target.map((_, i) =>
      rule.current === "集中" && i < Math.ceil(target.length / 2) ? 2 : 1,
    );
    const total = weights.reduce((sum, n) => sum + n, 0);
    let cursor = 0,
      weight = 0;
    const assigned = new Map();
    target.forEach((device, i) => {
      weight += weights[i];
      const end = Math.round((source.length * weight) / total);
      const free = [...(portsByDevice.get(device.id) ?? [])]
        .reverse()
        .filter((port) => !busy.has(port));
      if (end - cursor > free.length) throw Error(device.id + "接入端口不足");
      for (let j = 0; cursor < end; cursor++, j++) {
        const link = bySource.get(source[cursor].id);
        if (!link) throw Error(source[cursor].id + "缺少可重配接入链路");
        assigned.set(link.id, free[j]);
      }
    });
    links = links.map((link) =>
      link.group === rule.linkGroup
        ? {
            ...link,
            ...(assigned.has(link.id)
              ? { b: assigned.get(link.id), enabled: true }
              : { enabled: false }),
          }
        : link,
    );
  }
  return { ...model, devices, links, batchRules };
}
