const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function limaDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addLimaDays(value, days) {
  if (!limaDate(value) || !Number.isInteger(days)) return "";
  const [year, month, day] = limaDate(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function formatLima(value, options = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "—";
  return (
    new Intl.DateTimeFormat("es-PE", {
      dateStyle: "medium",
      timeStyle: "short",
      ...options,
      timeZone: "America/Lima",
    }).format(date) + " PET"
  );
}

export function formatCalendarDate(value) {
  if (!value) return "—";
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-05:00` : value,
  );
  return Number.isFinite(+date)
    ? new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeZone: "America/Lima",
      }).format(date)
    : "—";
}

export function newestFirst(records = []) {
  const stamp = (row) =>
    Date.parse(
      row.createdAt ||
        row.requestedAt ||
        row.receivedAt ||
        row.at ||
        row.observedAt ||
        row.updatedAt ||
        "",
    ) || 0;
  return [...records].sort(
    (a, b) =>
      stamp(b) - stamp(a) ||
      String(b.id || "").localeCompare(String(a.id || ""), "es", {
        numeric: true,
      }),
  );
}
