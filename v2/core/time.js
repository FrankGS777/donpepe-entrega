"use strict";

const DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_ZONE = "America/Lima";
const TIME_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hourCycle: "h23",
});

function limaDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(
    DATE_PARTS.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addLimaDays(value, days = 0) {
  const base = limaDate(value);
  if (!base || !Number.isInteger(days)) return "";
  const [year, month, day] = base.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

// Keep UTC instants for comparisons; expose the same instant with Peru's offset
// in records and exports. A calendar-only expiry is never shifted to yesterday.
function limaTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const p = Object.fromEntries(
    TIME_PARTS.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond}-05:00`;
}
function timeFields(value) {
  return {
    atLocal: limaTimestamp(value),
    localDate: limaDate(value),
    timeZone: TIME_ZONE,
  };
}

module.exports = {
  TIME_ZONE,
  limaDate,
  addLimaDays,
  limaTimestamp,
  timeFields,
};
