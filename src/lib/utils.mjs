export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function toNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function sortByDateAsc(items, field = "date") {
  return [...items].sort((left, right) =>
    String(left[field]).localeCompare(String(right[field])),
  );
}

export function sortByDateDesc(items, field = "date") {
  return [...items].sort((left, right) =>
    String(right[field]).localeCompare(String(left[field])),
  );
}

export function sumBy(items, selector) {
  return items.reduce((total, item) => total + toNumber(selector(item), 0), 0);
}

export function pickTop(items, count, selector) {
  return [...items]
    .sort((left, right) => toNumber(selector(right)) - toNumber(selector(left)))
    .slice(0, count);
}

export function safeJsonParse(value, fallback = null) {
  if (!value || typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function ensureDir(path, fs) {
  return fs.mkdir(path, { recursive: true });
}

export function formatPercent(value) {
  return `${(toNumber(value) * 100).toFixed(1)}%`;
}
