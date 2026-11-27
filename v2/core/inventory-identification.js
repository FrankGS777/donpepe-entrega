"use strict";

// Presentation of authorized inventory facts. A HU identifies a handling group,
// not an invented serial for each carton. Never synthesise carton identities.
function packaging(cases, unitsPerCase) {
  const valid =
    Number.isInteger(cases) &&
    cases >= 0 &&
    Number.isInteger(unitsPerCase) &&
    unitsPerCase > 0;
  return {
    cases,
    unitsPerCase: valid ? unitsPerCase : null,
    units: valid ? cases * unitsPerCase : null,
  };
}

function lotOverview(hus = [], storeStock = [], unitsPerCase) {
  const lots = new Map();
  function add(record, region, kind) {
    if (!Number.isInteger(record.cases) || record.cases <= 0) return;
    if (kind === "load" && record.state === "DELIVERED") return;
    const key = JSON.stringify([record.lot || "", record.expiry || ""]);
    if (!lots.has(key))
      lots.set(key, {
        key,
        lot: record.lot || "",
        expiry: record.expiry || null,
        cases: 0,
        centerCases: 0,
        transitCases: 0,
        storeCases: 0,
        discrepancyCases: 0,
        records: [],
      });
    const lot = lots.get(key);
    lot.cases += record.cases;
    lot[`${region}Cases`] += record.cases;
    lot.records.push({
      ...record,
      kind,
      region,
      ...packaging(record.cases, unitsPerCase),
    });
  }
  for (const hu of hus)
    add(
      hu,
      hu.state === "IN_TRANSIT"
        ? "transit"
        : hu.state === "DISCREPANCY"
          ? "discrepancy"
          : "center",
      "load",
    );
  for (const stock of storeStock) add(stock, "store", "stock");
  return [...lots.values()]
    .map((lot) => ({
      ...lot,
      ...packaging(lot.cases, unitsPerCase),
      loadCount: lot.records.filter((row) => row.kind === "load").length,
    }))
    .sort(
      (a, b) =>
        String(a.expiry || "9999").localeCompare(String(b.expiry || "9999")) ||
        a.lot.localeCompare(b.lot, "es"),
    );
}
module.exports = { packaging, lotOverview };
