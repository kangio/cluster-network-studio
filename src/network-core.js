import { objectRoute } from "./topology-model.js";

export const EPS = 1e-7;

export function route(graph, flow, index) {
  if (graph.objectModel) return objectRoute(graph, flow, index);
  const a = graph.endpoints[flow.src],
    b = graph.endpoints[flow.dst];
  if (a.access.down || b.access.down) return null;
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

export function allocateFlows(active, resources) {
  const budgets = new Map();
  const rates = new Map();
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
        amount < f.remaining - EPS && !f.req.some((r) => constrained.has(r.key))
      );
    });
  }
  return { budgets, rates };
}
