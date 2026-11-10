import { simulate, optimize, evaluateFaults } from "./engine.js";

self.onmessage = ({
  data: {
    type,
    config,
    workload,
    limits,
    fault,
    faults,
    search,
    cached,
    detail,
    detailOnly,
  },
}) => {
  try {
    if (type === "search") {
      const result = optimize(
        config,
        workload,
        limits,
        search,
        (done, total, feasible) =>
          self.postMessage({ progress: { done, total, feasible } }),
        { ...cached, detail, fault, faults },
      );
      self.postMessage({ result });
      return;
    }
    const result =
      !fault && !detailOnly && cached?.baseline
        ? cached.baseline
        : simulate(config, workload, limits, fault);
    const faultResults =
      !fault && !detailOnly
        ? (cached?.baselineFaultResults ??
          evaluateFaults(config, workload, limits, faults))
        : undefined;
    self.postMessage({ result, faultResults });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
