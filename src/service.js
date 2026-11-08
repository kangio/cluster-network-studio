export const SERVICE_FIELDS = [
  ["rate", "请求到达率", "请求/s", 1, 1000],
  ["input", "平均输入长度", "token", 1, 100000],
  ["output", "平均输出长度", "token", 2, 10000],
  ["instances", "固定推理实例数", "个", 1, 128],
  ["slots", "每实例并发槽位", "个", 1, 128],
  ["prefillRate", "单槽 Prefill 速度", "token/s", 1, 1e7],
  ["decodeMs", "单槽生成间隔", "ms/token", 0.1, 1000, 0.1],
  ["readMB", "请求依赖的读取量", "MB/请求", 0, 100000, 0.1],
  ["background", "后台持久化流量", "GB/s", 0, 2000, 0.1],
  ["ttftLimit", "P99 首 token 上限", "ms", 1, 60000, 0.1],
  ["tpotLimit", "P99 TPOT 上限", "ms", 0.1, 1000, 0.1],
  ["goodputLimit", "达标请求吞吐下限", "请求/s", 0, 1000, 0.1],
  ["completionLimit", "请求完成率下限", "%", 1, 100, 0.1],
];

export function serviceProfile(domain, model = "推理服务") {
  return {
    domain,
    model,
    rate: 20,
    input: 1800,
    output: 80,
    instances: 8,
    slots: 8,
    prefillRate: 60000,
    decodeMs: 8,
    readMB: 0,
    background: 0,
    ttftLimit: 180,
    tpotLimit: 12,
    goodputLimit: 16,
    completionLimit: 99,
  };
}

const hash = (index) => (Math.imul(index + 1, 2654435761) >>> 0) / 4294967296;
const round = (value) => Math.round(value * 1000) / 1000;
function p99(values) {
  if (!values.length) return null;
  return round(
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.99) - 1],
  );
}

export function prepareService(workload, graph) {
  const { seconds, services } = workload;
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 30)
    throw Error("推理负载持续时间须为 2–30 秒");
  if (!Array.isArray(services) || !services.length || services.length > 8)
    throw Error("请配置 1–8 个推理服务");
  const duration = seconds * 1000;
  const flows = [];
  const profiles = [];
  let count = 0;
  const deployed = new Map();
  for (const [index, profile] of services.entries()) {
    if (!profile.model?.trim() || !Object.hasOwn(graph.planes, profile.domain))
      throw Error("请选择网络域并填写模型名称");
    for (const [key, label, , min, max, step] of SERVICE_FIELDS) {
      const value = profile[key];
      if (
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (!step && !Number.isInteger(value))
      )
        throw Error(profile.model + " · " + label + "超出范围");
    }
    const { C: compute, S: storage } = graph.planes[profile.domain];
    const computeSlots = [];
    for (
      let slot = 0;
      slot < Math.max(0, ...compute.map((id) => graph.endpoints[id].nodes));
      slot++
    )
      for (const id of compute)
        if (slot < graph.endpoints[id].nodes) computeSlots.push(id);
    const offset = deployed.get(profile.domain) ?? 0;
    const instances = computeSlots.slice(offset, offset + profile.instances);
    if (instances.length < profile.instances)
      throw Error(profile.model + " · 固定部署所需计算节点不足");
    deployed.set(profile.domain, offset + profile.instances);
    if ((profile.readMB || profile.background) && !storage.length)
      throw Error(profile.model + " · 当前业务需要可访问的存储节点");
    // Each request has a stable logical shard key. Only the configured physical attachment can move its path.
    const storageSlots = storage.flatMap((id) =>
      Array(graph.endpoints[id].nodes).fill(id),
    );
    const endpointForShard = (key) =>
      storageSlots[Math.floor(hash(key) * storageSlots.length)];
    const requests = [];
    const requested = profile.rate * seconds;
    count += requested;
    if (count > 5000)
      throw Error("单次评估最多 5,000 个请求，请缩短时长或降低到达率");
    for (let i = 0; i < requested; i++) {
      const arrival = ((i + 0.5) * 1000) / profile.rate;
      const instance = i % instances.length;
      const id = index + ":" + i;
      requests.push({ id, instance, arrival });
      if (profile.readMB) {
        const src = endpointForShard(i + index * 47);
        flows.push({
          time: arrival,
          src,
          dst: instances[instance],
          mb: profile.readMB,
          parallel: 1,
          plane: profile.domain,
          type: "推理依赖读取",
          model: profile.model,
          request: id,
        });
      }
    }
    if (profile.background) {
      for (let time = 0, i = 0; time < duration; time += 25, i++) {
        const src = instances[i % instances.length];
        const dst = endpointForShard(i + index * 37 + 1);
        flows.push({
          time,
          src,
          dst,
          mb: profile.background * 25,
          parallel: 1,
          plane: profile.domain,
          type: "后台持久化",
          model: profile.model,
        });
      }
    }
    profiles.push({ profile, requests });
  }
  return { duration, flows, profiles };
}

export function finishService(prepared, networkCompleted, cutoff) {
  const readEnds = new Map(
    networkCompleted
      .filter((row) => row.request !== undefined)
      .map((row) => [row.request, row.time]),
  );
  const profiles = prepared.profiles.map(({ profile, requests }, index) => {
    const queues = Array.from({ length: profile.instances }, () =>
      Array(profile.slots).fill(0),
    );
    const eligible = requests
      .flatMap((request) => {
        const ready = profile.readMB
          ? readEnds.get(request.id)
          : request.arrival;
        return ready === undefined ? [] : [{ ...request, ready }];
      })
      .sort((a, b) => a.ready - b.ready || a.arrival - b.arrival);
    const finished = [];
    let last = 0;
    for (const request of eligible) {
      const slots = queues[request.instance];
      const next = slots.indexOf(Math.min(...slots));
      const start = Math.max(request.ready, slots[next]);
      const compute = (profile.input * 1000) / profile.prefillRate;
      const first = start + compute + profile.decodeMs;
      const end = start + compute + profile.output * profile.decodeMs;
      slots[next] = end;
      if (end > cutoff) continue;
      last = Math.max(last, end);
      finished.push({
        ttft: first - request.arrival,
        io: request.ready - request.arrival,
        queue: start - request.ready,
        compute,
        tpot: profile.decodeMs,
      });
    }
    const ttft = p99(finished.map((request) => request.ttft));
    const tpot = p99(finished.map((request) => request.tpot));
    const good = finished.filter(
      (request) =>
        request.ttft <= profile.ttftLimit && request.tpot <= profile.tpotLimit,
    ).length;
    const completion = (finished.length * 100) / requests.length;
    const span = Math.max(
      prepared.duration,
      last,
      finished.length < requests.length ? cutoff : 0,
    );
    const goodput = (good * 1000) / span;
    const checks = [
      ["ttft", "P99 首 token 时延", "ms", ttft, profile.ttftLimit, true],
      ["tpot", "P99 TPOT", "ms", tpot, profile.tpotLimit, true],
      [
        "goodput",
        "达标请求吞吐",
        "请求/s",
        goodput,
        profile.goodputLimit,
        false,
      ],
      [
        "completion",
        "请求完成率",
        "%",
        completion,
        profile.completionLimit,
        false,
      ],
    ].map(([key, label, unit, value, limit, max]) => ({
      key: "service-" + index + "-" + key,
      label: profile.domain + " " + profile.model + " · " + label,
      unit,
      value: value == null ? null : round(value),
      limit,
      max,
      pass: value != null && (max ? value <= limit : value >= limit),
    }));
    const tail = finished.filter(
      (request) => ttft !== null && round(request.ttft) >= ttft,
    );
    const tailAverage = (key) =>
      tail.length
        ? round(
            tail.reduce((sum, request) => sum + request[key], 0) / tail.length,
          )
        : null;
    return {
      domain: profile.domain,
      model: profile.model,
      requests: requests.length,
      completed: finished.length,
      ttft,
      tpot,
      goodput: round(goodput),
      completion: round(completion),
      checks,
      tail: {
        io: tailAverage("io"),
        queue: tailAverage("queue"),
        prefill: tailAverage("compute"),
      },
    };
  });
  const ttfts = profiles.flatMap((profile) =>
    profile.ttft == null ? [] : [profile.ttft],
  );
  return {
    profiles,
    checks: profiles.flatMap((profile) => profile.checks),
    p99: ttfts.length ? Math.max(...ttfts) : null,
    throughput: round(
      profiles.reduce((total, profile) => total + profile.goodput, 0),
    ),
  };
}
