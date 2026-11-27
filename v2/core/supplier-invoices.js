"use strict";
const {createHash}=require('node:crypto');
const {limaDate,addLimaDays}=require('./time');
const {problem}=require('./validation');
const BUYER={id:'DP-CD-001',legalName:'DonPepe Distribución',name:'DonPepe',address:'Centro de distribución DonPepe, Lima, Perú',email:'compras@donpepe.local',currency:'PEN'};
// Scenario purchase tariffs, not retail prices or a quoted commercial offer.
const BASE={ 'SKU-ARROZ':320,'SKU-ACEITE':640,'SKU-FIDEOS':290,'SKU-AZUCAR':310,'SKU-ATUN':480,'SKU-LECHE':380,'SKU-YOGUR':620,'SKU-QUESO':1650,'SKU-POLLO':1190,'SKU-HELADO':1590,'SKU-DETERGENTE':720,'SKU-LEJIA':280};
function defaultUnitCost(sku){
 if(BASE[sku.id])return BASE[sku.id];
 const n=(sku.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(n.includes('aceite')){if(/5\s*l/.test(n))return n.includes('oliva')?13900:3200;return n.includes('oliva')?(/250\s*ml/.test(n)?1350:2200):640;}
 if(n.includes('arroz'))return /5\s*kg/.test(n)?1650:390;
 if(n.includes('azucar'))return /5\s*kg/.test(n)?1550:350;
 if(/agua|gaseosa|jugo|nectar/.test(n))return /3\s*l/.test(n)?790:/2\s*l/.test(n)?590:/1\s*l/.test(n)?450:250;
 if(/atun|conserva/.test(n))return 490;
 if(/leche/.test(n))return 390;
 if(/detergente/.test(n))return /4\s*kg|5\s*kg/.test(n)?4200:790;
 return sku.zoneId==='FROZEN'?1290:sku.zoneId==='COLD'?690:sku.zoneId==='CLEANING'?590:390;
}
function migrateCommercialCatalog(s){
 let changed=false;
 if(s.commercialInvoiceVersion!==2){s.commercialInvoiceVersion=2;changed=true;}
 for(const sku of s.catalog.skus){if(sku.purchaseUnitNetCents===undefined){sku.purchaseUnitNetCents=defaultUnitCost(sku);sku.purchasePriceSource='SCENARIO_TARIFF';changed=true;}if(sku.purchaseTaxRateBps===undefined){sku.purchaseTaxRateBps=1800;changed=true;}}
 for(const p of s.catalog.suppliers){for(const [k,v] of Object.entries({legalName:p.name,billingAddress:'Lima, Perú',paymentTermDays:30,invoiceSeries:'F001',invoiceCurrency:'PEN'})){if(p[k]===undefined){p[k]=v;changed=true;}}}
 if(!s.configuration.company){s.configuration.company=structuredClone(BUYER);changed=true;}
 return changed;
}
function makeInvoiceLines(s,purchase){return purchase.lines.map(line=>{
 const sku=s.catalog.skus.find(r=>r.id===line.skuId);
 if(!sku||!Number.isSafeInteger(sku.purchaseUnitNetCents)||sku.purchaseUnitNetCents<=0||sku.purchaseUnitNetCents>10000000)problem('El producto necesita una tarifa de compra válida.',422);
 if(!Number.isInteger(sku.purchaseTaxRateBps)||sku.purchaseTaxRateBps<0||sku.purchaseTaxRateBps>10000)problem('El impuesto configurado del producto no es válido.',422);
 const caseUnitNetCents=sku.purchaseUnitNetCents*sku.unitsPerCase,netCents=caseUnitNetCents*line.cases,taxCents=Math.round(netCents*sku.purchaseTaxRateBps/10000);
 if(!Number.isSafeInteger(netCents)||netCents>10000000000)problem('El importe de la compra supera el límite permitido.',422);
 return {lineId:line.id,skuId:sku.id,code:sku.code,name:sku.name,brand:sku.brand||'',presentation:sku.presentation||'',barcode:sku.barcode||'',unit:'CAJA',unitsPerCase:sku.unitsPerCase,cases:line.cases,unitNetCents:sku.purchaseUnitNetCents,caseUnitNetCents,taxRateBps:sku.purchaseTaxRateBps,netCents,taxCents,totalCents:netCents+taxCents,priceSource:sku.purchasePriceSource||'CATALOG_TARIFF'};
 });}
function issueSupplierInvoice(s,purchase,{id,event}){
 migrateCommercialCatalog(s);s.finance||={bills:[],payments:[]};
 const existing=s.finance.bills.find(b=>b.purchaseId===purchase.id);if(existing)return existing;
 const supplier=s.catalog.suppliers.find(p=>p.id===purchase.supplierId);if(!supplier)problem('Proveedor inexistente.',422);
 const lines=makeInvoiceLines(s,purchase),subtotalCents=lines.reduce((n,l)=>n+l.netCents,0),taxCents=lines.reduce((n,l)=>n+l.taxCents,0);
 const sequence=1+Math.max(0,...s.finance.bills.filter(b=>b.supplierId===supplier.id&&b.automatic).map(b=>b.sequence||0));
 const bill={id:id(s,'DOC'),automatic:true,version:2,source:'SIMULATED_SUPPLIER',purchaseId:purchase.id,supplierId:supplier.id,sequence,reference:`${supplier.invoiceSeries}-${String(sequence).padStart(8,'0')}`,date:limaDate(s.clock.now),dueDate:addLimaDays(s.clock.now,supplier.paymentTermDays),currency:'PEN',createdAt:s.clock.now,createdBy:'SUPPLIER-AUTOMATION',paymentTermDays:supplier.paymentTermDays,subtotalCents,taxCents,totalCents:subtotalCents+taxCents,lines,
 issuer:{id:supplier.id,code:supplier.code||supplier.id,name:supplier.name,legalName:supplier.legalName||supplier.name,taxId:supplier.taxId||'',address:supplier.billingAddress,email:supplier.email||'',phone:supplier.phone||'',logoUrl:supplier.logoUrl||''},buyer:structuredClone(s.configuration.company),purchaseCreatedAt:purchase.createdAt};
 bill.documentHash=createHash('sha256').update(JSON.stringify(bill)).digest('hex');
 s.finance.bills.push(bill);purchase.invoiceId=bill.id;purchase.invoiceReference=bill.reference;purchase.commercialTotalCents=bill.totalCents;
 event(s,'SUPPLIER_INVOICE_ISSUED',`${supplier.name}: factura ${bill.reference} recibida automáticamente para ${purchase.id}.`,{purchaseId:purchase.id,documentId:bill.id,totalCents:bill.totalCents});return bill;
}
function cancelSupplierInvoice(s,purchase,context){const b=s.finance?.bills.find(b=>b.purchaseId===purchase.id&&b.automatic);if(!b)return;
 if(s.finance.payments.some(p=>p.billId===b.id))problem('La compra tiene pagos registrados. Requiere resolver la devolución del pago antes de cancelar.',409);
 b.cancelledAt=s.clock.now;b.cancelReason=purchase.cancelReason;context.event(s,'SUPPLIER_INVOICE_CANCELLED',`${b.reference}: anulada por cancelación de ${purchase.id}.`,{purchaseId:purchase.id,documentId:b.id});}
module.exports={migrateCommercialCatalog,issueSupplierInvoice,cancelSupplierInvoice,makeInvoiceLines};
