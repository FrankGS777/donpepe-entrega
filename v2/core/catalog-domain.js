"use strict";
const { Fields, problem, normalized } = require("./validation");
const ZONES = ["DRY", "COLD", "FROZEN", "CLEANING"];
const slug = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "GENERAL";
function expansion() {
  try { return require("./expanded-catalog.json"); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND" && error.message.includes("expanded-catalog.json")) return null; throw error; }
}
function imageManifest(name) { try { return require(`./${name}.json`); } catch (error) { if (error.code === "MODULE_NOT_FOUND" && error.message.includes(`${name}.json`)) return null; throw error; } }
function migrateRepresentations(s) {
  let changed = false;
  for (const [kind, manifestName] of [["categories", "category-scene-assets"], ["brands", "brand-logo-assets"], ["brands", "brand-illustration-assets"]]) {
    const manifest = imageManifest(manifestName); if (!manifest) continue;
    for (const source of manifest[kind] || []) {
      const record = s.catalog[kind].find(record => record.id === source.id); if (!record) continue;
      const formerUrl = source.imageUrl.replace("/brands/illustration-", "/brands/generated-");
      const currentMatches = record.imageUrl === source.imageUrl || record.imageUrl === formerUrl;
      const knownProductReference = !record.imageUrl || /^\/images\/(?:catalog|expanded)\//.test(record.imageUrl) || record.imageKind === "REAL_PRODUCT_REFERENCE";
      if (!currentMatches && (record.updatedAt || !knownProductReference)) continue;
      for (const field of ["imageUrl", "imageKind", "imageSourceUrl", "referenceUrl", "sourceOrganization", "sourceType", "verifiedOn", "imageSha256", "preferredBackground"]) if (source[field] !== undefined && record[field] !== source[field]) { record[field] = source[field]; changed = true; }
      if (kind === "categories" && record.imageGeneratedOn !== manifest.generatedOn) { record.imageGeneratedOn = manifest.generatedOn; changed = true; }
    }
  }
  return changed;
}
function migrateCatalog(s) {
  let changed = false;
  for (const key of ["brands", "categories"]) if (!s.catalog[key]) { s.catalog[key] = []; changed = true; }
  const derive = (kind, name, sku) => {
    const list = s.catalog[kind], field = kind === "brands" ? "supplierIds" : "zoneIds", ref = kind === "brands" ? sku.supplierId : sku.zoneId;
    let record = list.find(row => normalized(row.name) === normalized(name));
    if (!record) {
      record = { id: `${kind === "brands" ? "BRAND" : "CAT"}-${slug(name)}`, code: `${kind === "brands" ? "M" : "C"}-${slug(name)}`, name, imageUrl: sku.imageUrl || "", description: "", active: true, [field]: [] };
      list.push(record); changed = true;
    }
    if (!record[field]) { record[field] = []; changed = true; }
    if (!record[field].includes(ref)) { record[field].push(ref); changed = true; }
    return record;
  };
  // Upgrade original free-text masters once. Later edits must use first-class refs.
  if (!s.masterReferencesVersion) {
    for (const sku of s.catalog.skus) {
      const brand = derive("brands", sku.brand || "Sin marca", sku), category = derive("categories", sku.category || "General", sku);
      sku.brandId ||= brand.id; sku.categoryId ||= category.id;
    }
    s.masterReferencesVersion = 1; changed = true;
  }
  const extra = expansion();
  if (extra && !s.catalogExpansionVersion) {
    const remap = { brands: {}, categories: {}, suppliers: {} };
    for (const key of ["suppliers", "brands", "categories"]) for (const source of extra[key] || []) {
      const target = s.catalog[key].find(row => row.id === source.id || normalized(row.name) === normalized(source.name));
      if (target) {
        remap[key][source.id] = target.id;
        // Referenced legacy entries retain their configuration and physical meaning.
        for (const field of ["imageUrl", "logoUrl", "site", "referenceUrl", "description", "contact", "email", "phone", "sourcingNote", "catalogBasis", "verifiedOn"]) if (!target[field] && source[field]) target[field] = source[field];
        for (const field of ["supplierIds", "zoneIds"]) if (source[field]) target[field] = [...new Set([...(target[field] || []), ...source[field].map(id => remap.suppliers[id] || id)])];
      } else {
        const row = structuredClone(source); row.active ??= true; row.code ||= row.id;
        if (row.supplierIds) row.supplierIds = row.supplierIds.map(id => remap.suppliers[id] || id);
        s.catalog[key].push(row); remap[key][source.id] = row.id;
      }
    }
    for (const source of extra.products || []) {
      // Never overwrite user data or import artificial stock. Duplicate GTIN/code
      // denotes the same trade article even if the source uses a different id.
      if (s.catalog.skus.some(row => row.id === source.id || row.code === source.code || (source.barcode && String(row.barcode || "").padStart(14, "0") === String(source.barcode).padStart(14, "0")))) continue;
      const row = { ...structuredClone(source), active: true, supplierId: remap.suppliers[source.supplierId] || source.supplierId, brandId: remap.brands[source.brandId] || source.brandId, categoryId: remap.categories[source.categoryId] || source.categoryId, reorderPoint: source.reorderPoint ?? 0, importSource: "VERIFIED_PUBLIC_CATALOG", importedAt: s.clock.now };
      if (!s.catalog.suppliers.some(supplier => supplier.id === row.supplierId) || !s.catalog.brands.some(brand => brand.id === row.brandId) || !s.catalog.categories.some(category => category.id === row.categoryId)) problem(`El catálogo ampliado contiene una referencia incompleta en ${source.code}.`, 500);
      row.brand = s.catalog.brands.find(brand => brand.id === row.brandId).name; row.category = s.catalog.categories.find(category => category.id === row.categoryId).name;
      row.caseLabel ||= `Caja × ${row.unitsPerCase}`;
      s.catalog.skus.push(row);
    }
    s.catalogExpansionVersion = 1; s.catalogSources = { verifiedOn: extra.verifiedOn, sources: structuredClone(extra.sources || []) }; changed = true;
  }
  const districtImages = { "TIENDA-1": ["San Miguel", "san-miguel"], "TIENDA-2": ["Pueblo Libre", "pueblo-libre"], "TIENDA-3": ["Jesús María", "jesus-maria"] };
  for (const branch of s.catalog.branches) {
    const seed = districtImages[branch.id];
    if (seed && branch.imageUrl === undefined) { branch.imageUrl = `/images/representations/branch-${seed[1]}.webp`; branch.district ||= seed[0]; branch.address ||= ""; branch.manager ||= ""; branch.phone ||= ""; branch.imageKind = "GENERATED_REPRESENTATION"; changed = true; }
  }
  if (migrateRepresentations(s)) { changed = true; if (s.configuration) s.configuration.revision++; }
  if (migrateSupplierPortfolios(s)) { changed = true; if (s.configuration) s.configuration.revision++; }
  if (changed) s.layout.branches = structuredClone(s.catalog.branches);
  return changed;
}
function eligibleSupplierIds(s,sku) {
  const brand = s.catalog.brands.find(brand => brand.id === sku.brandId);
  const candidates = new Set([sku.supplierId,...(brand?.active ? brand.supplierIds || [] : [])]);
  return s.catalog.suppliers.filter(supplier => supplier.active && supplier.zones?.includes(sku.zoneId) && candidates.has(supplier.id)).map(supplier => supplier.id);
}
function migrateSupplierPortfolios(s) {
  const manifest = imageManifest("supplier-portfolios");
  if (!manifest || s.supplierPortfoliosVersion >= manifest.version) return false;
  for (const source of manifest.suppliers || []) {
    let target = s.catalog.suppliers.find(supplier => supplier.id === source.id || normalized(supplier.name) === normalized(source.name));
    if (!target) {
      target = { ...structuredClone(source),active:true,importSource:"VERIFIED_PUBLIC_PORTFOLIO",importedAt:s.clock.now };
      delete target.brandIds; s.catalog.suppliers.push(target);
    } else {
      // Extend verified coverage, never replace a user's name, image, contacts,
      // archive status, or the preferred supplier of a traced article.
      target.zones = [...new Set([...(target.zones || []),...(source.zones || [])])];
      for (const field of ["logoUrl","imageUrl","site","referenceUrl","sourceType","sourcingNote","preferredBackground"]) if (!target[field] && source[field]) target[field] = source[field];
      if (!target.updatedAt && source.logoUrl && (!target.logoUrl || /^\/images\/catalog\//.test(target.logoUrl))) for (const field of ["logoUrl","imageUrl","imageKind","imageSourceUrl","imageSha256","sourceSha256","preferredBackground"]) if (source[field] !== undefined) target[field] = source[field];
    }
    target.kind ||= source.kind || "DISTRIBUTOR";
    target.portfolioSources = [...new Set([...(target.portfolioSources || []),...(source.referenceUrl ? [source.referenceUrl] : [])])];
    target.portfolioVerifiedOn = manifest.verifiedOn;
    for (const brandId of source.brandIds || []) {
      const brand = s.catalog.brands.find(brand => brand.id === brandId);
      if (brand) brand.supplierIds = [...new Set([...(brand.supplierIds || []),target.id])];
    }
  }
  s.supplierPortfoliosVersion = manifest.version;
  return true;
}
function masterCommand(s, kind, action, p, context) {
  const list = s.catalog[kind === "brand" ? "brands" : "categories"], fields = new Fields();
  if (!["create", "update"].includes(action)) problem("Acción de catálogo desconocida.", 404);
  const existing = action === "create" ? null : list.find(row => row.id === p.id);
  if (action !== "create" && !existing) problem("El registro de catálogo no existe.", 404);
  if (existing?.deletedAt) problem("El registro fue eliminado y no puede modificarse.", 404);
  const data = p.data || p, next = { ...existing };
  next.code = fields.code(data.code ?? existing?.code);
  next.name = fields.string(data.name ?? existing?.name, "name", "Nombre", { min: 2, max: 100, required: true });
  next.description = fields.string(data.description ?? existing?.description ?? "", "description", "Descripción", { max: 500, multiline: true });
  next.imageUrl = fields.image(data.imageUrl ?? existing?.imageUrl ?? "");
  if (existing && next.imageUrl !== existing.imageUrl && next.imageUrl) {
    next.imageKind = "USER_PROVIDED";
    for (const key of ["imageSourceUrl", "sourceOrganization", "sourceType", "verifiedOn", "imageSha256", "imageGeneratedOn", "preferredBackground"]) next[key] = null;
  }
  if (!next.imageUrl && !fields.errors.imageUrl) fields.add("imageUrl", "Añade una imagen de referencia para este registro.");
  next.active = fields.boolean(data.active ?? existing?.active ?? true, "active", "Estado");
  if (next.active !== (existing?.active ?? true)) fields.add("active", "Utiliza Activar o Desactivar para cambiar el estado del registro.");
  fields.unique(list, next.code, "code", "un registro", existing?.id); fields.unique(list, next.name, "name", "un registro", existing?.id);
  if (kind === "brand") next.supplierIds = fields.refs(data.supplierIds ?? existing?.supplierIds, "supplierIds", "Proveedores de la marca", s.catalog.suppliers);
  else next.zoneIds = fields.refs(data.zoneIds ?? existing?.zoneIds, "zoneIds", "Conservación compatible", ZONES.map(id => ({ id, active: true })), { max: 4 });
  fields.assert();
  if (existing) {
    const assigned = s.catalog.skus.filter(sku => sku.active && sku[kind === "brand" ? "brandId" : "categoryId"] === existing.id);
    if (kind === "brand" && assigned.some(sku => !next.supplierIds.includes(sku.supplierId))) problem("Un producto activo usa uno de los proveedores que intentas retirar.", 409, { supplierIds: "Conserva los proveedores de los productos vinculados." });
    if (kind === "category" && assigned.some(sku => !next.zoneIds.includes(sku.zoneId))) problem("La categoría tiene productos activos que necesitan esa conservación.", 409, { zoneIds: "Conserva las zonas de los productos vinculados." });
    for (const sku of s.catalog.skus.filter(sku => sku[kind === "brand" ? "brandId" : "categoryId"] === existing.id)) sku[kind] = next.name;
  }
  next.id = existing?.id || context.id(s, kind === "brand" ? "MARCA" : "CATEGORIA"); next.updatedAt = s.clock.now;
  if (existing) Object.assign(existing, next); else list.push(next);
  return next.id;
}
function productReferences(s, data, next, existing, tracked) {
  const fields = new Fields();
  for (const [kind, key, label] of [["brands", "brandId", "Marca"], ["categories", "categoryId", "Categoría"]]) {
    const selected = data[key] ?? existing?.[key];
    const row = s.catalog[kind].find(record => record.id === selected);
    if (!row || !row.active) { fields.add(key, `${label}: selecciona un registro activo.`); continue; }
    next[key] = row.id; next[kind === "brands" ? "brand" : "category"] = row.name;
    if (kind === "brands" && !row.supplierIds.includes(next.supplierId)) fields.add(key, "La marca no está vinculada a ese proveedor. Configura su relación comercial antes de usarla.");
    if (kind === "categories" && !row.zoneIds.includes(next.zoneId)) fields.add(key, "La categoría no permite esa condición de conservación.");
    if (tracked && kind === "brands" && existing.brandId && existing.brandId !== next.brandId) fields.add(key, "No sustituyas la marca de un artículo trazado. Crea otro producto.");
  }
  fields.assert();
}
module.exports = { migrateCatalog, masterCommand, productReferences, migrateRepresentations, migrateSupplierPortfolios, eligibleSupplierIds };
