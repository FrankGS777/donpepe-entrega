const DEFAULT_DAYS = 365;

function normalizeDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 3650) return DEFAULT_DAYS;
  return days;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + normalizeDays(days));
  return date.toISOString().slice(0, 10);
}

function expiryFromCategory(fechaIngreso, product) {
  if (!product?.control_vencimiento) return null;
  return addDays(fechaIngreso, product.vida_util_dias);
}

module.exports = { DEFAULT_DAYS, normalizeDays, addDays, expiryFromCategory };
