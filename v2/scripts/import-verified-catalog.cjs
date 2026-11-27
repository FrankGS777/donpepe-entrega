"use strict";

// Rebuilds factual product masters from the supplier's public catalog.
// This script never opens the application database and never creates stock.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
let sharp;
function imageRuntime() {
  sharp ||= require(
    process.env.DONPEPE_SHARP_MODULE ||
      "sharp",
  );
  return sharp;
}
const root = path.resolve(__dirname, "..");
const base = "https://www.vega.pe";
const api = `${base}/api/catalog_system/pub/products/search`;
const verifiedOn = new Date().toISOString().slice(0, 10);
const existing = require("../core/catalog-assets.json");
const cacheRoot = path.join(
  process.env.TMPDIR || "/tmp",
  "donpepe-verified-vega-catalog",
);
const imageRoot = path.join(root, "public/images/expanded");
// The official image for this 180 g SKU shows the 1 kg package. It cannot serve
// as an accurate product representation even though its other metadata is valid.
const rejectedSourcePhotographs = new Set(["160557"]);
const families = [
  {
    code: "ACEITES",
    name: "Aceites",
    ids: [13],
    description: "Aceites vegetales, de oliva y de soya en envases cerrados.",
  },
  {
    code: "ARROCES",
    name: "Arroces",
    ids: [14],
    description: "Arroz en presentaciones de peso fijo para la despensa.",
  },
  {
    code: "AZUCARES",
    name: "Azúcar y endulzantes",
    ids: [15],
    description: "Azúcar blanca, rubia y otros endulzantes envasados.",
  },
  {
    code: "PASTAS",
    name: "Pastas y fideos",
    ids: [20],
    description: "Pastas secas cortas y largas, envasadas y de peso fijo.",
  },
  {
    code: "CONSERVAS",
    name: "Conservas",
    ids: [19],
    description:
      "Conservas de pescado, frutas y vegetales en recipientes cerrados.",
  },
  {
    code: "SALSAS",
    name: "Salsas de mesa",
    ids: [18],
    description:
      "Mayonesas, ketchup, mostazas y salsas selladas para despensa.",
  },
  {
    code: "CONDIMENTOS",
    name: "Condimentos y sazonadores",
    ids: [17],
    description: "Sal, condimentos, vinagres y sazonadores en envase original.",
  },
  {
    code: "GALLETAS",
    name: "Galletas y golosinas",
    ids: [21],
    description:
      "Galletas, chocolate y dulces de marcas comercializadas por el proveedor.",
  },
  {
    code: "BEBIDAS",
    name: "Bebidas sin alcohol",
    ids: [85, 86, 87, 88],
    description: "Aguas, gaseosas y bebidas selladas de conservación ambiente.",
  },
  {
    code: "SNACKS",
    name: "Snacks",
    ids: [89],
    description:
      "Aperitivos salados en envases cerrados y porciones de peso fijo.",
  },
  {
    code: "DESAYUNO",
    name: "Desayuno y despensa láctea",
    ids: [110, 111, 112, 114, 115],
    description:
      "Avena, café, infusiones, mermeladas y leche UHT o evaporada sin abrir.",
  },
  {
    code: "REPOSTERIA",
    name: "Harinas y repostería",
    ids: [22, 24],
    description: "Harinas, mezclas de repostería y postres secos de despensa.",
  },
];
const slug = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
function validGtin(value) {
  if (!/^(?:\d{8}|\d{12,14})$/.test(value)) return false;
  const values = [...value].map(Number),
    check = values.pop();
  return (
    (10 -
      (values
        .reverse()
        .reduce((total, n, i) => total + n * (i % 2 ? 1 : 3), 0) %
        10)) %
      10 ===
    check
  );
}
async function fetchSafe(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(25000),
        headers: {
          "user-agent": "DonPepe educational catalog verification/1.0",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return response;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
async function catalogPage(category, from) {
  const filename = path.join(cacheRoot, `${category}-${from}.json`);
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch {
    /* New verified public query. */
  }
  const url = `${api}?fq=${encodeURIComponent(`C:/${families.find((f) => f.ids.includes(category))?.code === "BEBIDAS" || category === 89 ? "2" : [110, 111, 112, 114, 115].includes(category) ? "4" : "1"}/${category}/`)}&_from=${from}&_to=${from + 49}`;
  const rows = await (await fetchSafe(url)).json();
  const compact = rows.map((product) => ({
    id: product.productId,
    name: product.productName,
    brand: product.brand,
    brandId: product.brandId,
    brandImageUrl: product.brandImageUrl,
    categories: product.categories,
    referenceUrl: product.link,
    apiUrl: `${api}?fq=productId:${product.productId}`,
    items: product.items.map((item) => ({
      id: item.itemId,
      name: item.name,
      barcode: item.ean,
      isKit: item.isKit,
      measurementUnit: item.measurementUnit,
      unitMultiplier: item.unitMultiplier,
      imageUrl: item.images?.[0]?.imageUrl,
      sellers: item.sellers?.map((s) => s.sellerName) || [],
    })),
  }));
  await fs.writeFile(filename, JSON.stringify(compact, null, 2));
  return compact;
}
function eligible(product, item) {
  if (rejectedSourcePhotographs.has(product.id)) return false;
  if (item.isKit || !item.imageUrl || !validGtin(item.barcode || ""))
    return false;
  if (!item.sellers.some((seller) => /vega/i.test(seller))) return false;
  if (
    /\b(?:kg|g)\b/i.test(item.measurementUnit) ||
    (item.unitMultiplier && item.unitMultiplier !== 1)
  )
    return false;
  if (
    /\b(?:20|18|10|25|50)\s*(?:kg|l|lt)\b|\bpeso\s+variable\b|\bx\s*kg\b|\b(?:refrigerad|congelad|yogur|yogurt|fresca|mantequilla)\b/i.test(
      product.name,
    )
  )
    return false;
  if (/pasta rellena|tallar[ií]n fresco/i.test(product.name)) return false;
  return true;
}
function familyMatches(family, product) {
  const name = slug(product.name);
  const patterns = {
    ACEITES: /^aceite-/,
    ARROCES: /^arroz-/,
    AZUCARES: /^(azucar|endulzante|stevia)-/,
    PASTAS: /^(fideos?|pasta|spaghetti|spaguetti|tallarin|semola)-/,
    CONSERVAS: /atun|anchoveta|conserva|durazno|aceituna|pescado|sardina/,
    SALSAS: /mayonesa|ketchup|mostaza|salsa|crema-de-aji/,
    CONDIMENTOS:
      /sal-|sazon|vinagre|comino|pimienta|canela|sillao|caldo|ajinom|apanar|panca|ajos?|oregano|palillo/,
    GALLETAS:
      /galleta|chocolate|gomita|chupete|gomas|chicle|caramelo|wafer|golosina/,
    BEBIDAS: /^(agua|gaseosa|bebida|nectar|jugo|te-helado|refresco)-/,
    SNACKS:
      /papas|snack|chips|pop-corn|habas|tortillas|piqueos|piqueo|mani|cancha|chifles/,
    DESAYUNO:
      /avena|cafe|infusion|te-|leche|lactea|mermelada|miel|cereal|salvado|chocolate-en-polvo|cocoa/,
    REPOSTERIA:
      /harina|chuno|maizena|maicena|gelatina|mazamorra|flan|cobertura|leche|polvo|vainilla|levadura|postre/,
  };
  return patterns[family.code].test(name);
}
function presentation(name) {
  const match = name.match(
    /(?:Botella(?:\s+Vidrio)?|Bolsa|Lata|Caja|Paquete|Empaque|Frasco|Doypack|Pote|Sobre|Gal[oó]n|Bid[oó]n|Pack)\b.*$/i,
  );
  if (match) return match[0].replace(/\s+/g, " ").trim();
  const quantity = name.match(/\d+(?:[.,]\d+)?\s*(?:ml|lt|kg|g|gr|l)\b.*$/i);
  if (quantity) return `Envase de ${quantity[0]}`;
  return "Envase comercial cerrado";
}
async function imageAsset(remote, filename) {
  const sharp = imageRuntime();
  const destination = path.join(imageRoot, filename);
  let output;
  try {
    output = await fs.readFile(destination);
  } catch {
    const binary = Buffer.from(await (await fetchSafe(remote)).arrayBuffer());
    output = await sharp(binary)
      .rotate()
      .resize({
        width: 600,
        height: 600,
        fit: "contain",
        background: "#ffffff",
        withoutEnlargement: true,
      })
      .webp({ quality: 85, effort: 5 })
      .toBuffer();
    await fs.writeFile(destination, output);
  }
  const metadata = await sharp(output).metadata();
  if (metadata.width < 100 || metadata.height < 100)
    throw new Error(`Product photograph too small: ${filename}`);
  return {
    imageUrl: `/images/expanded/${filename}`,
    imageSha256: crypto.createHash("sha256").update(output).digest("hex"),
    imageBytes: output.length,
  };
}
async function main() {
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.mkdir(imageRoot, { recursive: true });
  const barcodeKey = (value) => value.padStart(14, "0");
  const used = new Set(
      existing.products.map((product) => barcodeKey(product.barcode)),
    ),
    chosen = [],
    categories = [];
  const selectedProductIds = new Set();
  const candidateFamilies = [];
  for (const family of families) {
    const categoryBatches = [];
    for (const category of family.ids) {
      const batch = [];
      for (const from of [0, 50]) {
        let rows;
        try {
          rows = await catalogPage(category, from);
        } catch (error) {
          console.warn(
            `Skipped unavailable category query ${category}: ${error.message}`,
          );
          break;
        }
        batch.push(...rows);
        if (rows.length < 50) break;
      }
      categoryBatches.push(batch);
    }
    const candidates = [];
    while (categoryBatches.some((batch) => batch.length))
      for (const batch of categoryBatches)
        if (batch.length) candidates.push(batch.shift());
    candidateFamilies.push({ family, candidates });
  }
  // The supplier also has malformed catalog data. Reject every GTIN reused for
  // different product identities instead of silently adopting a false mapping.
  const barcodeIdentities = new Map();
  for (const { candidates } of candidateFamilies)
    for (const product of candidates)
      for (const item of product.items) {
        if (!validGtin(item.barcode || "")) continue;
        const key = barcodeKey(item.barcode),
          identities = barcodeIdentities.get(key) || new Set();
        identities.add(product.id);
        barcodeIdentities.set(key, identities);
      }
  const ambiguousBarcodes = new Set(
    [...barcodeIdentities]
      .filter(([, identities]) => identities.size > 1)
      .map(([barcode]) => barcode),
  );
  for (const { family, candidates } of candidateFamilies) {
    // Diverse brands first; use only exact, original source identities.
    const byBrand = new Map();
    for (const product of candidates)
      for (const item of product.items) {
        if (
          !eligible(product, item) ||
          !familyMatches(family, product) ||
          used.has(barcodeKey(item.barcode)) ||
          ambiguousBarcodes.has(barcodeKey(item.barcode)) ||
          selectedProductIds.has(product.id)
        )
          continue;
        const entries = byBrand.get(product.brand) || [];
        if (!entries.some((entry) => entry.item.barcode === item.barcode))
          entries.push({ product, item });
        byBrand.set(product.brand, entries);
      }
    const ordered = [],
      groups = [...byBrand.values()];
    while (groups.some((group) => group.length))
      for (const group of groups) if (group.length) ordered.push(group.shift());
    let selected = 0;
    for (const { product, item } of ordered) {
      if (
        used.has(barcodeKey(item.barcode)) ||
        selectedProductIds.has(product.id)
      )
        continue;
      used.add(barcodeKey(item.barcode));
      selectedProductIds.add(product.id);
      selected++;
      const brandId = `BRAND-${slug(product.brand).toUpperCase()}`;
      chosen.push({
        id: `SKU-CAT-${product.id}`,
        code: `DP-${String(100 + chosen.length + 1).padStart(4, "0")}`,
        name: item.name || product.name,
        brandId,
        categoryId: `CAT-${family.code}`,
        brand: product.brand,
        category: family.name,
        presentation: presentation(item.name || product.name),
        barcode: item.barcode,
        imageUrl: `/images/expanded/sku-${product.id}.webp`,
        referenceUrl: product.referenceUrl,
        supplierId: "PROV-1",
        zoneId: "DRY",
        temperature: "AMBIENT",
        expiryControlled: true,
        unitsPerCase: 12,
        caseLabel: "Caja × 12",
        maxCasesPerHu: 24,
        reorderPoint: 12,
        active: true,
        logisticsNote:
          "Caja de 12 envases y máximo 24 cajas por unidad de carga: parámetros de simulación DonPepe; confirmar embalaje logístico con el proveedor antes de uso real.",
        sourceProductId: product.id,
        sourceItemId: item.id,
        sourceCategoryPath: product.categories?.[0] || "",
        sourceApiUrl: product.apiUrl,
        sourceImageUrl: item.imageUrl,
        sourceSeller: item.sellers.find((seller) => /vega/i.test(seller)),
        verifiedOn,
      });
      if (selected >= 10) break;
    }
    if (!selected) throw new Error(`No verified products in ${family.name}`);
    categories.push({
      id: `CAT-${family.code}`,
      code: family.code,
      name: family.name,
      description: family.description,
      zoneIds: ["DRY"],
      imageUrl: `/images/expanded/category-${slug(family.code)}.webp`,
      active: true,
      referenceUrl: `${api}?fq=C:/${family.code === "BEBIDAS" || family.code === "SNACKS" ? "2" : family.code === "DESAYUNO" ? "4" : "1"}/${family.ids[0]}/`,
    });
    console.log(`${family.name}: ${selected} verified records`);
  }
  if (chosen.length < 100)
    throw new Error(
      `Only ${chosen.length} products passed factual checks (100 required).`,
    );
  const brands = [...new Set(chosen.map((product) => product.brand))].map(
    (name) => ({
      id: `BRAND-${slug(name).toUpperCase()}`,
      code: slug(name).toUpperCase(),
      name,
      description: `Marca comercial identificada en el catálogo público de Corporación Vega.`,
      imageUrl: `/images/expanded/brand-${slug(name)}.webp`,
      supplierIds: ["PROV-1"],
      active: true,
      imageKind: "REAL_PRODUCT_REFERENCE",
      referenceUrl: chosen.find((product) => product.brand === name)
        .referenceUrl,
    }),
  );
  // A single supplier listing is evidence of assortment, not exclusive distribution or manufacturer ownership.
  const suppliers = [
    {
      id: "PROV-1",
      code: "VEGA",
      name: "Corporación Vega",
      zones: ["DRY"],
      logoUrl: "/images/catalog/prov-1.png",
      site: base,
      referenceUrl: `${base}/ventas-corporativas`,
      active: true,
      contact: "Ventas corporativas",
      email: "ventascorporativas@corporacionvega.pe",
      phone: "994078838",
      sourcingNote:
        "Los productos ampliados se verificaron individualmente en el catálogo público de Corporación Vega. La configuración de suministro a DonPepe es un escenario académico; no implica un contrato real ni distribución exclusiva.",
      catalogBasis: "PUBLIC_SUPPLIER_ASSORTMENT",
      verifiedOn,
    },
  ];
  let cursor = 0;
  const workers = Array.from({ length: 5 }, async () => {
    while (cursor < chosen.length) {
      const product = chosen[cursor++];
      Object.assign(
        product,
        await imageAsset(
          product.sourceImageUrl,
          `sku-${product.sourceProductId}.webp`,
        ),
      );
    }
  });
  await Promise.all(workers);
  for (const brand of brands) {
    const product = chosen.find((entry) => entry.brandId === brand.id);
    await fs.copyFile(
      path.join(root, "public", product.imageUrl),
      path.join(root, "public", brand.imageUrl),
    );
  }
  for (const category of categories) {
    const product = chosen.find((entry) => entry.categoryId === category.id);
    await fs.copyFile(
      path.join(root, "public", product.imageUrl),
      path.join(root, "public", category.imageUrl),
    );
  }
  const result = {
    schemaVersion: 1,
    verifiedOn,
    scope: "ADDITIVE_MASTER_DATA_ONLY_NO_INITIAL_STOCK",
    products: chosen,
    brands,
    categories,
    suppliers,
    sources: [
      {
        id: "VEGA-CATALOG",
        organization: "Corporación Vega",
        title: "Catálogo público de productos",
        url: api,
        verifiedOn,
        use: "Nombre, marca, presentación, GTIN, vendedor y fotografía de cada producto.",
      },
      {
        id: "VEGA-CATEGORIES",
        organization: "Corporación Vega",
        title: "Categorías públicas",
        url: `${base}/api/catalog_system/pub/category/tree/3`,
        verifiedOn,
        use: "Clasificación del surtido del proveedor.",
      },
      {
        id: "VEGA-ASSORTMENT",
        organization: "Corporación Vega",
        title: "Abarrotes — Vega Supermercado Mayorista",
        url: `${base}/abarrotes`,
        verifiedOn,
        use: "Comprobación del carácter mayorista y de las marcas ofertadas.",
      },
      {
        id: "VEGA-B2B",
        organization: "Corporación Vega",
        title: "Ventas corporativas y abastecimiento por volumen",
        url: `${base}/ventas-corporativas`,
        verifiedOn,
        use: "Canal de suministro empresarial, correo y teléfono públicos del proveedor.",
      },
    ],
    audit: {
      totalProducts: chosen.length,
      totalBrands: brands.length,
      totalCategories: categories.length,
      uniqueBarcodes: new Set(chosen.map((product) => product.barcode)).size,
      gtinChecksumVerified: true,
      existing12Preserved: true,
      allSupplierIdentitiesVerified: true,
      rejectedAmbiguousSourceGtins: ambiguousBarcodes.size,
      semanticCategoryVerification: true,
      rejectedMismatchedSourcePhotographs: rejectedSourcePhotographs.size,
      initialStockCreated: false,
      imageSource: "REAL_SUPPLIER_PHOTOGRAPHS",
      generatedCommercialPackaging: false,
      casePackSource: "SCENARIO_PARAMETER_NOT_MANUFACTURER_FACT",
    },
  };
  const destination = path.join(root, "core/expanded-catalog.json");
  await fs.writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ destination, ...result.audit }, null, 2));
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { validGtin, eligible, presentation };
