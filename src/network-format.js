const domainKeys = { A2: "D01", A5: "D02" };
const endpointFields = new Set([
  "leaf",
  "spine",
  "endpoint",
  "src",
  "dst",
  "a",
  "b",
]);
const normalizeDomain = (value) => domainKeys[value] ?? value;
const normalizeEndpoint = (value) =>
  value.replace(/^A[25](?=-)/, normalizeDomain);

// Legacy matrices use the old endpoint prefix in the source and destination columns.
export function normalizeMatrix(value) {
  const convert = (cell) =>
    cell.replace(
      /^(\s*"?)(A[25])(?=-)/,
      (_, prefix, id) => prefix + normalizeDomain(id),
    );
  return value.replace(
    /^([^,\t\r\n]*[,\t])([^,\t\r\n]*)([,\t])([^,\t\r\n]*)/gm,
    (_, time, source, separator, target) =>
      time + convert(source) + separator + convert(target),
  );
}

function normalizeKey(key) {
  return key === "A2" || key === "A5"
    ? normalizeDomain(key)
    : key
        .replace(/^a2(?=[A-Z])/, "domain01")
        .replace(/^a5(?=[A-Z])/, "domain02");
}

// Upgrade structural identifiers in saved projects and topology imports.
export function normalizeNetworkData(value, field) {
  if (Array.isArray(value))
    return value.map((item) => normalizeNetworkData(item, field));
  if (value && typeof value === "object") {
    if (
      value.config?.model ||
      value.model?.version === 1 ||
      value.input?.config?.model
    )
      return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        normalizeKey(key),
        normalizeNetworkData(item, key),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  if (field === "domain" || field === "plane" || field === "connectionDomains")
    return normalizeDomain(value);
  if (endpointFields.has(field)) return normalizeEndpoint(value);
  if (field === "matrix") return normalizeMatrix(value);
  if (field === "label" || field === "issues")
    return value.replace(/^A[25](?=\s)/, normalizeDomain);
  if (field === "key") return normalizeKey(value);
  return value;
}
