"use strict";
// Public manufacturer portfolios add sourcing alternatives, not commercial
// contracts, inventory, addresses, tax identities or fictitious product brands.
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const sharp = require(process.env.DONPEPE_SHARP_MODULE || "sharp");
const root = path.resolve(__dirname, "..");
const definitions = [
  { id:"PROV-3",name:"Alicorp S.A.A.",code:"PROV-003",zones:["DRY","CLEANING"],brands:["PRIMOR","DON-VITTORIO","COCINERO","NICOLINI","ALACENA","TARI","BLANCA-FLOR","SAPOLIO"],site:"https://www.alicorp.com.pe",referenceUrl:"https://www.alicorp.com.pe/pe/es/productos/consumo-masivo",imageSourceUrl:"https://www.alicorp.com.pe/images/logo-alicorp-header.svg",kind:"MANUFACTURER" },
  { id:"PROV-GLORIA",name:"Leche Gloria",code:"PROV-GLORIA",zones:["DRY","COLD"],brands:["GLORIA","BONLE"],site:"https://www.gloria.com.pe",referenceUrl:"https://www.gloria.com.pe/Site/nosotros/archivos/visita_nuestra_planta",copyBrand:"GLORIA",kind:"MANUFACTURER" },
  { id:"PROV-NESTLE",name:"Nestlé Perú",code:"PROV-NESTLE",zones:["DRY","FROZEN"],brands:["NESTLE","NESCAFE","KIRMA","D-ONOFRIO"],site:"https://www.nestle.com.pe",referenceUrl:"https://tiendanestle.pe/collections/kirma",imageReferenceUrl:"https://www.nestle.com/about/history/logo-evolution",imageSourceUrl:"https://www.nestle.com/sites/default/files/about-history-logo-2018.jpg",sourceCrop:{left:95,top:135,width:300,height:300},sourceCropNote:"Se retira únicamente el marco de presentación; se conserva íntegro el nido y el nombre corporativo, sin recoloración ni modificación de sus formas.",kind:"MANUFACTURER" },
  { id:"PROV-MOLITALIA",name:"Molitalia",code:"PROV-MOLITALIA",zones:["DRY"],brands:["MOLITALIA","FANNY","COSTA","AMBROSOLI"],site:"https://www.molitalia.com.pe",referenceUrl:"https://www.molitalia.com.pe/productos/marcas/costa/",imageSourceUrl:"https://www.molitalia.com.pe/wp-content/uploads/2020/09/Logo.png",preferredBackground:"dark",kind:"MANUFACTURER" },
  { id:"PROV-LINDLEY",name:"Arca Continental Lindley",code:"PROV-LINDLEY",zones:["DRY"],brands:["COCA-COLA","FANTA","FRUGOS","SAN-LUIS","SPRITE"],site:"https://www.arcacontinentallindley.pe",referenceUrl:"https://www.arcacontinentallindley.pe/promociones-y-ganadores/",imageSourceUrl:"https://www.arcacontinentallindley.pe/wp-content/uploads/2023/07/Logotipo.png",kind:"BOTTLER_DISTRIBUTOR" },
  { id:"PROV-AJE",name:"Grupo AJE",code:"PROV-AJE",zones:["DRY"],brands:["CIELO","VOLT","ORO"],site:"https://www.ajegroup.com",referenceUrl:"https://www.ajegroup.com/nuestras-marcas/",evidenceUrl:"https://www.ajegroup.com/wp-content/uploads/2026/01/Reporte2024.pdf",imageSourceUrl:"https://www.ajegroup.com/aje-assets/aje_group/wp-content/uploads/2020/09/24234609/LOGO-AJE.png",kind:"MANUFACTURER" },
  { id:"PROV-PEPSICO",name:"PepsiCo",code:"PROV-PEPSICO",zones:["DRY"],brands:["CHEETOS","DORITOS","QUAKER"],site:"https://www.pepsico.com",referenceUrl:"https://www.pepsico.com/newsroom/stories/2026/pepsico-first-corporate-brand-campaign",imageReferenceUrl:"https://www.pepsico.com/media/logo-files",imageSourceUrl:"https://digitalassets.pepsico.com/transform/7c417867-1251-4602-8b69-1ea452a03bbe/Pepsico-logo-footer?q=75&w=1200",preferredBackground:"dark",kind:"MANUFACTURER" },
  { id:"PROV-COSTENO",name:"Costeño Alimentos",code:"PROV-COSTENO",zones:["DRY"],brands:["COSTENO","PAISANA"],site:"https://www.costenoalimentos.com.pe",referenceUrl:"https://www.costenoalimentos.com.pe/",imageSourceUrl:"https://www.costenoalimentos.com.pe/images/logo.png",kind:"MANUFACTURER" },
  { id:"PROV-SAN-FERNANDO",name:"San Fernando",code:"PROV-SAN-FERNANDO",zones:["COLD","FROZEN"],brands:["SAN-FERNANDO"],site:"https://corporativo.sanfernando.pe",referenceUrl:"https://corporativo.sanfernando.pe/contacto/",copyBrand:"SAN-FERNANDO",preferredBackground:"dark",kind:"MANUFACTURER" },
  { id:"PROV-FLORALP",name:"Floralp Perú",code:"PROV-FLORALP",zones:["COLD"],brands:["FLORALP"],site:"https://www.floralpperu.com",referenceUrl:"https://www.floralpperu.com/",copyBrand:"FLORALP",kind:"MANUFACTURER" },
];
const digest = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
async function main() {
  const priorLogos = JSON.parse(await fs.readFile(path.join(root,"core/brand-logo-assets.json"),"utf8"));
  await fs.mkdir(path.join(root,"public/images/suppliers"),{recursive:true});
  const suppliers=[];
  for(const definition of definitions){
    let binary,imageSourceUrl=definition.imageSourceUrl;
    if(definition.copyBrand){
      const source=priorLogos.brands.find(b=>b.id===`BRAND-${definition.copyBrand}`);
      if(!source)throw Error(`No verified logo for ${definition.name}`);
      binary=await fs.readFile(path.join(root,"public",source.imageUrl));
      imageSourceUrl=source.imageSourceUrl;
    } else {
      const response=await fetch(imageSourceUrl,{signal:AbortSignal.timeout(25000),headers:{"User-Agent":"Mozilla/5.0 DonPepe public portfolio research"}});
      if(!response.ok)throw Error(`${definition.id}: HTTP${response.status}`);
      binary=Buffer.from(await response.arrayBuffer());
      if(definition.inlineTitle){
        const svg=[...binary.toString("utf8").matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].find(m=>m[0].includes(definition.inlineTitle));
        if(!svg)throw Error(`Missing public header logo for ${definition.name}`);
        binary=Buffer.from(svg[0]);
      }
      if(/<script|<foreignObject|\b(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/)|@import|url\s*\(\s*["']?(?:https?:|\/\/)/i.test(binary.toString("utf8")))throw Error(`Unsafe source for ${definition.id}`);
    }
    const imageUrl=`/images/suppliers/${definition.id.toLowerCase()}.webp`;
    const normalized=sharp(binary,{density:180}).rotate();
    if(definition.sourceCrop)normalized.extract(definition.sourceCrop);
    const output=await normalized.resize(720,360,{fit:"contain",background:{r:255,g:255,b:255,alpha:0}}).webp({quality:95}).toBuffer();
    await fs.writeFile(path.join(root,"public",imageUrl),output);
    const {brands,copyBrand,inlineTitle,...record}=definition;
    suppliers.push({...record,imageSourceUrl,logoUrl:imageUrl,imageUrl,imageKind:"OFFICIAL_SUPPLIER_LOGO",sourceType:"OFFICIAL_MANUFACTURER_PORTFOLIO",verifiedOn:"2026-10-18",brandIds:brands.map(id=>`BRAND-${id}`),leadDays:2,preferredBackground:definition.preferredBackground || "light",sourcingNote:"Portafolio público verificado. Las alternativas de abastecimiento y plazos son configuración DonPepe; no acreditan un contrato comercial con el fabricante.",imageSha256:digest(output),sourceSha256:digest(binary)});
    console.log(`${definition.name}: public logo and ${brands.length} brand relationships verified`);
  }
  await fs.writeFile(path.join(root,"core/supplier-portfolios.json"),JSON.stringify({version:1,verifiedOn:"2026-10-18",basis:"Official brand/manufacturer portfolios; no commercial partnership asserted",suppliers},null,2)+"\n");
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={definitions};
