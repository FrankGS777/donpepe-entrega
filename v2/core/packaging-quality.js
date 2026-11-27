"use strict";

const DEFECT_LABELS = Object.freeze({
  DENTED: "Embalaje aplastado o abollado",
  OPEN_SEAL: "Cierre abierto o sello desprendido",
  TORN_BAG: "Bolsa o envoltura rasgada",
  LIQUID_LEAK: "Fuga de producto líquido",
  WET_LEAK: "Humedad o derrame visible",
});

const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function defectForProduct(sku) {
  const name = normalize(sku.name), presentation = normalize(sku.presentation);
  const category = normalize(sku.category);
  const product = `${name} ${presentation}`;
  if (/\b(?:latas?|enlatad[oa]s?)\b/.test(product)) return "DENTED";
  if (sku.zoneId === "FROZEN" || /\bcongelad[oa]s?\b/.test(category)) return "OPEN_SEAL";

  // Flexible sauces, brined pouches and semisolid foods fail at the seal.
  const flexible = /\b(?:bolsas?|sacos?|costales?|sobres?|paquetes?|envolturas?|empaques?)\b/;
  const semisolid = /\b(?:ketchup|mayonesa|mostaza|mermelada|crema|pasta de aji|salsa)\b/;
  if (/\bdoypack\b/.test(product) ||
      (semisolid.test(product) && !/\bsalsa inglesa\b/.test(product)) ||
      (category === "conservas" && flexible.test(product))) return "OPEN_SEAL";

  // Ambient storage also includes liquids, such as oil and shelf-stable milk.
  const liquidProduct = /^(?:aceites?|vinagre|leche\b(?!.*\b(?:polvo|evaporada|condensada)\b))/.test(name) ||
    /\b(?:agua|bebidas?|gaseosas?|jugos?|zumos?|bebibles?|liquid[oa]s?|cloro|lejia)\b/.test(product) ||
    /\b(?:aceites|bebidas)\b/.test(category);
  const liquidVolume = /\d\s*(?:ml|l|lt|litros?)\b/.test(presentation) &&
    /\b(?:botellas?|bidones?|bidon|galones?|galon|frascos?|cajas?|tetrapak)\b/.test(product);
  if (liquidProduct || liquidVolume) return "LIQUID_LEAK";
  if (sku.zoneId === "COLD" || /\brefrigerad[oa]s?\b/.test(category)) return "OPEN_SEAL";
  if (/\b(?:cajas?|frascos?|potes?|tarros?|bandejas?)\b/.test(presentation)) return "DENTED";
  if (flexible.test(product) || /\b(?:harinas?|arroces|pastas|fideos)\b/.test(category)) return "TORN_BAG";
  return "DENTED";
}

function defectLabel(code) { return DEFECT_LABELS[code] || code; }

function damageKind(code) {
  if (code === "WET_LEAK" || code === "LIQUID_LEAK") return "liquid";
  if (code === "DENTED") return "crushed";
  if (code === "OPEN_SEAL") return "open";
  if (code === "TORN_BAG") return "torn";
  return null;
}

function damagedCaseCount(load) {
  return load.packagingDefect ? (load.damagedCaseIndexes?.length ?? load.cases) : 0;
}

function caseDamageKind(load, index) {
  if (Array.isArray(load.damagedCaseIndexes) && !load.damagedCaseIndexes.includes(index)) return null;
  return damageKind(load.packagingDefect);
}

module.exports = { defectForProduct, defectLabel, damageKind, damagedCaseCount, caseDamageKind };
