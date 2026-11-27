const crypto = require("crypto");
const pad = (value, length) => String(value).padStart(length, "0");
const purchaseCode = (id, date = new Date()) =>
  `OC-${date.getFullYear()}-${pad(id, 5)}`;
const receiptCode = (id) => `B001-${pad(id, 8)}`;
const warehouseTaskCode = (id, date = new Date()) =>
  `TA-${date.getFullYear()}-${pad(id, 6)}`;
const branchOrderCode = (id, date = new Date()) =>
  `PS-${date.getFullYear()}-${pad(id, 5)}`;
const handlingUnitCode = () =>
  `HU-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
const temporaryCode = (prefix) =>
  `T${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
module.exports = {
  purchaseCode,
  receiptCode,
  warehouseTaskCode,
  branchOrderCode,
  handlingUnitCode,
  temporaryCode,
};
