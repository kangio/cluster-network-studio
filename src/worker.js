import { simulate, optimize } from "./engine.js";
self.onmessage = ({
  data: { type, config, workload, limits, fault, search },
}) => {
  try {
    const result =
      type === "search"
        ? optimize(config, workload, limits, search, (done, total, feasible) =>
            self.postMessage({ progress: { done, total, feasible } }),
          )
        : simulate(config, workload, limits, fault);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
