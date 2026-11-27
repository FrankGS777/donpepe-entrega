"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{tmpdir}=require("node:os"),{DatabaseSync}=require("node:sqlite"),crypto=require("node:crypto");
const {createSimulation}=require("../core/engine"),{migrateSupplierPortfolios,eligibleSupplierIds}=require("../core/catalog-domain"),manifest=require("../core/supplier-portfolios.json");
const OPS={id:"OPS",role:"operations"},ADMIN={id:"ADMIN",role:"admin"};
function setup(t,options={}){const s=createSimulation(options);t.after(()=>s.close());return s;}
const state=s=>s.snapshot(OPS),cfg=(s,type,p)=>s.command(type,{expectedRevision:state(s).configuration.revision,...p},ADMIN);
test("portafolios oficiales suman fabricantes sin reemplazar los proveedores trazados y cubren todo el catálogo",t=>{
  const s=setup(t),v=state(s);assert.equal(v.catalog.suppliers.length,12);assert.equal(v.catalog.skus.length,131);assert.equal(v.catalog.skus.find(p=>p.id==="SKU-ARROZ").supplierId,"PROV-1");assert.equal(v.catalog.skus.find(p=>p.id==="SKU-YOGUR").supplierId,"PROV-2");
  for(const sku of v.catalog.skus.filter(p=>p.active)){assert.ok(sku.eligibleSupplierIds.length,sku.name);for(const id of sku.eligibleSupplierIds){const supplier=v.catalog.suppliers.find(p=>p.id===id);assert.ok(supplier.active&&supplier.zones.includes(sku.zoneId));}}
  for(const source of manifest.suppliers)for(const brandId of source.brandIds){const brand=v.catalog.brands.find(b=>b.id===brandId);assert.ok(brand,brandId);assert.ok(brand.supplierIds.includes(source.id));}
  assert.equal(v.ledger.initialCases,360);assert.equal(v.orders.length,1);assert.equal(v.purchases.length,0);
});
test("pedidos admiten fabricante alternativo por marca sin sustituir preferido ni habilitar marcas ajenas",t=>{
  const s=setup(t);for(const [skuId,supplierId]of[["SKU-ARROZ","PROV-COSTENO"],["SKU-LECHE","PROV-GLORIA"],["SKU-HELADO","PROV-NESTLE"],["SKU-ACEITE","PROV-3"]]){const sku=state(s).catalog.skus.find(p=>p.id===skuId),preferred=sku.supplierId;assert.ok(sku.eligibleSupplierIds.includes(supplierId),skuId);const purchase=s.command("purchase.create",{supplierId,lines:[{skuId,cases:1}]},OPS);assert.equal(state(s).purchases.find(p=>p.id===purchase.id).supplierId,supplierId);assert.equal(state(s).catalog.skus.find(p=>p.id===skuId).supplierId,preferred);}
  const before=state(s).purchases.length;assert.throws(()=>s.command("purchase.create",{supplierId:"PROV-NESTLE",lines:[{skuId:"SKU-ARROZ",cases:1}]},OPS),e=>e.status===422&&!!e.fieldErrors["lines.0.skuId"]);assert.equal(state(s).purchases.length,before);
});
test("proveedor desactivado y condición térmica incompatible excluyen catálogo y compras nuevas",t=>{
  const s=setup(t);cfg(s,"config.supplier.deactivate",{id:"PROV-COSTENO"});assert.ok(!state(s).catalog.skus.find(p=>p.id==="SKU-ARROZ").eligibleSupplierIds.includes("PROV-COSTENO"));assert.throws(()=>s.command("purchase.create",{supplierId:"PROV-COSTENO",lines:[{skuId:"SKU-ARROZ",cases:1}]},OPS),{status:422});
  const v=state(s),yogurt=v.catalog.skus.find(p=>p.id==="SKU-YOGUR"),supplier=v.catalog.suppliers.find(p=>p.id==="PROV-GLORIA");supplier.zones=["DRY"];assert.ok(!eligibleSupplierIds(v,yogurt).includes(supplier.id));
});
test("migración aditiva conserva personalización, documentos, stock y selección preferida; no reaplica relaciones retiradas",t=>{
  const folder=fs.mkdtempSync(path.join(tmpdir(),"dp-portfolios-")),filename=path.join(folder,"test.sqlite");t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));let s=createSimulation({filename});s.close();const db=new DatabaseSync(filename),v=JSON.parse(db.prepare("SELECT state_json FROM simulation WHERE id=1").get().state_json);delete v.supplierPortfoliosVersion;v.catalog.suppliers=v.catalog.suppliers.filter(p=>!p.id.startsWith("PROV-")||["PROV-1","PROV-2","PROV-3"].includes(p.id));const target=v.catalog.suppliers.find(p=>p.id==="PROV-3");target.name="Mi proveedor configurado";target.logoUrl="/images/catalog/upload.png";target.updatedAt="2026-10-17";const hus=structuredClone(v.hus),orders=structuredClone(v.orders);db.prepare("UPDATE simulation SET state_json=? WHERE id=1").run(JSON.stringify(v));db.close();
  s=createSimulation({filename});let after=state(s);assert.equal(after.catalog.suppliers.find(p=>p.id==="PROV-3").name,target.name);assert.equal(after.catalog.suppliers.find(p=>p.id==="PROV-3").logoUrl,target.logoUrl);assert.deepEqual(after.orders,orders);assert.deepEqual(after.hus.map(({motionHistory,...h})=>h),hus);assert.equal(after.catalog.suppliers.length,12);assert.equal(migrateSupplierPortfolios(after),false);s.close();
});
test("cada nuevo proveedor conserva logo completo local, huella y fuente primaria sin afirmar contrato DonPepe",()=>{
  assert.equal(new Set(manifest.suppliers.map(p=>p.id)).size,manifest.suppliers.length);assert.match(manifest.basis,/no commercial partnership/);
  for(const supplier of manifest.suppliers){assert.ok(supplier.referenceUrl.startsWith("https://"));assert.equal(supplier.sourceType,"OFFICIAL_MANUFACTURER_PORTFOLIO");assert.match(supplier.sourcingNote,/no acreditan un contrato/);assert.equal(supplier.logoUrl,supplier.imageUrl);const file=path.join(__dirname,"../public",supplier.logoUrl),bytes=fs.readFileSync(file);assert.equal(bytes.toString("ascii",0,4),"RIFF");assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),supplier.imageSha256);assert.ok(supplier.brandIds.length);}
});
