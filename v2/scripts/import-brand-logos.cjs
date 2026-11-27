"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSimulation } = require("../core/engine");
const sharp = require(process.env.DONPEPE_SHARP_MODULE || "sharp");
const root = path.resolve(__dirname, "..");
const verifiedOn = "2026-10-18";
const sources = [
  ["SAN-MATEO", "https://www.gloria.com.pe/SM_LogoRGB.svg", "https://www.gloria.com.pe/", "Gloria Perú — San Mateo"],
  ["ACT-II", "https://www.actii.com.mx/sites/default/files/2026-06/LOGO-ACT-II-2017-_1_-2048x1239.webp", "https://www.actii.com.mx/", "ACT II — Conagra Brands"],
  ["CARTAVIO", "https://www.coazucar.com/esp/images/logohome-cartavio.jpg", "https://www.coazucar.com/esp/cartavio_nosotros.html", "Cartavio — Coazúcar"],
  ["PACASMAYO", "https://www.molinosaman.com.pe/app/assets/images/img/02072024014106000000.jpg", "https://www.molinosaman.com.pe/", "Molinos Samán — Arroz Pacasmayo"],
  ["CHEETOS", "https://digitalassets.pepsico.com/transform/ec574b24-5500-4942-a13a-fa45ba8e43ce/cheetos-full-offwhite?q=75&w=1000", "https://www.pepsico.com/brands", "PepsiCo — Cheetos"],
  ["DORITOS", "https://digitalassets.pepsico.com/transform/d38d63a9-f2cb-4626-880f-25e822c776a3/doritos-full-offwhite?q=75&w=1000", "https://www.pepsico.com/brands", "PepsiCo — Doritos"],
  ["NESTLE", "https://cdn.shopify.com/s/files/1/0460/5558/8007/files/23_1.png?v=1671731184", "https://tiendanestle.pe/collections/nestle-chocolateria", "Tienda oficial Nestlé Perú"],
  ["ROMEX", "https://romex.pe/wp-content/uploads/2022/05/logoreposteria_romex.png", "https://romex.pe/es/product/chocolate-y-derivados-del-cacao/", "Romex — Repostería"],
  ["SIBARITA", "https://sibarita.pe/wp-content/themes/sibarita/img/logo-sibarita.png", "https://sibarita.pe/", "Sibarita Perú"],
  ["UNIVERSAL", "https://universalperu.com/wp-content/uploads/2024/01/cropped-Logo-peque-1.png", "https://universalperu.com/", "Universal Perú"],
  ["QUAKER", "https://www.quakeroats.com/sites/quakeroats.com/themes/quakeroats/img/Quaker_Logo_Header.png", "https://www.quakeroats.com/", "Quaker Oats — PepsiCo"],
  ["RITZ", "https://images.ctfassets.net/npgfyzd0fxha/5DF9qjQCIFsF0WNC7o0UTQ/7d3bfd9d57d19d030fd6afdb6a56a885/RITZ_Logo_US_2023-09_100.png", "https://www.snackworks.com/brands/ritz/", "Ritz — Mondelēz / SnackWorks"],
  ["NESCAFE", "https://cdn.shopify.com/s/files/1/0460/5558/8007/files/logo_nescafe_ok.png?v=1744310380", "https://tiendanestle.pe/", "Tienda oficial Nestlé Perú"],
  ["D-ONOFRIO", "https://cdn.shopify.com/s/files/1/0460/5558/8007/files/1_1.png?v=1671730523", "https://tiendanestle.pe/collections/donofrio-productos", "Tienda oficial Nestlé Perú"],
  ["FINI", "https://www.finiworld.com/wp-content/uploads/thegem/logos/logo_4e9fb37cf87f31971696a408a513ac0e_3x.png", "https://www.finiworld.com/es-es/", "Fini — The Fini Company"],
  ["P-A-N", "https://pe.allofpan.com/wp-content/uploads/logo.png", "https://pe.allofpan.com/", "P.A.N. — Alimentos Polar"],
  ["TRIDENT", "https://www.tridentgum.com/", "https://www.tridentgum.com/", "Trident — Mondelēz", "styles_logo__i2qid"],
  ["FLORIDA", "https://florida.com.pe/img/iconos/logo-florida-blanco-fecha.svg", "https://florida.com.pe/", "Florida Perú"],
  ["B-D", "https://byd.com.pe/wp-content/uploads/2025/09/logo-byd-white.png", "https://byd.com.pe/", "B&D Perú"],
  ["FLORALP", "https://www.floralpperu.com/images/logo_floralp.png", "https://www.floralpperu.com/", "Floralp Perú"],
  ["SAN-FERNANDO", "https://corporativo.sanfernando.pe/wp-content/uploads/2024/01/unnamed-e1750197336259.webp", "https://corporativo.sanfernando.pe/", "San Fernando"],
  ["LA-BOLIVIANA", "https://www.labolivianastevia.com/wp-content/themes/la_boliviana/images/logo.png", "https://www.labolivianastevia.com/", "Nutra Stevia — La Boliviana"],
  ["QFOODS", "https://qfoods.pe/wp-content/uploads/2026/09/qf_fi_retina.svg", "https://qfoods.pe/", "Qfoods"],
  ["INKA-CHIPS", "https://inkachips.com/wp-content/themes/inkachips/img/logo.png", "https://inkachips.com/peru/", "Inka Crops — Inka Chips"],
  ["DEL-VALLE", "https://delvallehuyro.com/wp-content/uploads/2020/08/LGO-DELVALLE.png", "https://delvallehuyro.com/", "Agrofil Huyro — Infusiones Del Valle"],
  ["WINTER-S", "https://chocolates.com.pe/wp-content/uploads/2019/02/winters-logo-producto.png", "https://chocolates.com.pe/en/brands/winters/", "Compañía Nacional de Chocolates del Perú"],
  ["CIELO", "https://www.ajegroup.com/aje-assets/wp-content/uploads/2020/05/Web-AJE-CIELO-800-X-800-PX.jpg", "https://www.ajegroup.com/nuestras-marcas/", "Grupo AJE"],
  ["VOLT", "https://www.ajegroup.com/aje-assets/wp-content/uploads/2020/05/VOLT-800-X-800-PX.jpg", "https://www.ajegroup.com/nuestras-marcas/", "Grupo AJE"],
  ["ORO", "https://www.ajegroup.com/aje-assets/wp-content/uploads/2020/05/11_Logo-oro.png", "https://www.ajegroup.com/nuestras-marcas/", "Grupo AJE"],
  ["GLORIA", "https://www.gloria.com.pe/logogloria3.svg", "https://www.gloria.com.pe/", "Gloria Perú"],
  ["BONLE", "https://www.gloria.com.pe/images/bonle-logo.svg", "https://www.gloria.com.pe/marca/bonle", "Gloria Perú — Bonlé"],
  ["FANTA", "https://www.coca-cola.com/content/dam/onexp/br/pt/offerings/fanta-ccxp/logofantanuevo.svg", "https://www.coca-cola.com/pe/es/brands", "Coca-Cola Perú"],
  ["SPRITE", "https://www.coca-cola.com/content/dam/onexp/pe/es/brands/sprite/logo_sprite_pe.png", "https://www.coca-cola.com/pe/es/brands", "Coca-Cola Perú"],
  ["COCA-COLA", "https://www.coca-cola.com/content/dam/onexp/pe/es/home-images/brands/es_coca_cola_logo_500x180%20(1).png", "https://www.coca-cola.com/pe/es/brands", "Coca-Cola Perú"],
  ["SAN-LUIS", "https://www.coca-cola.com/content/dam/onexp/pe/es/home-images/brands/es_peru_san_luis_logo_180x180%202.png", "https://www.coca-cola.com/pe/es/brands", "Coca-Cola Perú"],
  ["FRUGOS", "https://www.coca-cola.com/content/dam/onexp/pe/es/home-images/brands/logo-del-valle.jpg", "https://www.coca-cola.com/pe/es/brands", "Coca-Cola Perú — Frugos del Valle"],
  ["PRINGLES", "https://www.promopringles.com/content/dam/latinamerica/promo-pringles/assets/logoPringles.png", "https://www.promopringles.com/es_PE/home.html", "Pringles Perú — Kellanova"],
  ["VEGA", "https://vegaperu.vtexassets.com/arquivos/logoveganuestrasmarcas.png", "https://www.vega.pe/nuestras-marcas", "Corporación Vega"],
  ["KARINO", "https://www.karino.com.pe/images/img_prin.jpg", "https://www.karino.com.pe/", "Condimentos Kariño"],
  ["GRAN-CHALAN", "https://induamerica.com.pe/wp-content/uploads/2025/05/Logo-11.png", "https://induamerica.com.pe/gran-chalan/", "Induamerica — Gran Chalán"],
  ["PRIMOR", "https://www.alicorp.com.pe/images/marcas/marcas_primor.webp", "https://www.alicorp.com.pe/pe/es/productos/consumo-masivo", "Alicorp"],
  ["DON-VITTORIO", "https://www.alicorp.com.pe/images/marcas/marcas_donvittorio.webp", "https://www.alicorp.com.pe/pe/es/productos/consumo-masivo", "Alicorp"],
  ["COCINERO", "https://www.alicorp.com.pe/images/marcas/marcas_cocinero.webp", "https://www.alicorp.com.pe/pe/es/productos/consumo-masivo", "Alicorp"],
  ["ALACENA", "https://www.alicorp.com.pe/images/marcas/marcas_alacena.webp", "https://www.alicorp.com.pe/pe/es/productos/consumo-masivo", "Alicorp"],
  ["NICOLINI", "https://www.alicorp.com.pe/images/marcas/marcas_nicolini.webp", "https://www.alicorp.com.pe/pe/es/productos/consumo-masivo", "Alicorp"],
  ["BLANCA-FLOR", "https://www.alicorp.com.pe/images/marcas/marcas_blancaflor.webp", "https://www.alicorp.com.pe/pe/es/productos/consumo-masivo", "Alicorp"],
  ["SAPOLIO", "https://www.alicorp.com.pe/images/marcas/marcas_sapolio.webp", "https://www.alicorp.com.pe/pe/es/productos/consumo-masivo", "Alicorp"],
  ["MOLITALIA", "https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-409-1.svg", "https://www.molitalia.com.pe/", "Molitalia"],
  ["FANNY", "https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-411-1.svg", "https://www.molitalia.com.pe/", "Molitalia"],
  ["COSTA", "https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-405-1.svg", "https://www.molitalia.com.pe/", "Molitalia"],
  ["AMBROSOLI", "https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-406-1.svg", "https://www.molitalia.com.pe/", "Molitalia"],
  ["COSTENO", "https://www.costenoalimentos.com.pe/media/1672/yTuwlYVO2U3c1Cm2mSEUlQkxgA3lO20zC6mRlWNc.png", "https://www.costenoalimentos.com.pe/", "Costeño Alimentos"],
  ["PAISANA", "https://www.costenoalimentos.com.pe/media/627/l5h8QLGJZilNtWzmEygm0RPRPjkOHgYUjrxDN8Tk.png", "https://www.costenoalimentos.com.pe/", "Costeño Alimentos"],
  ["DULFINA", "https://www.agroparamonga.com/wp-content/uploads/2023/05/Logo_Dulfina_sobre_gris.ai_page-0001-removebg-preview.png", "https://www.agroparamonga.com/lineas-negocio/azucar/", "Agro Industrial Paramonga"],
  ["OLIVOS-DEL-SUR", "https://olivosdelsur.com/wp-content/uploads/2024/03/logo-olivos-del.png", "https://olivosdelsur.com/", "Olivos del Sur Perú"],
  ["BENOTI", "https://benoti.pe/wp-content/uploads/2025/07/cropped-Sin-titulo-1-scaled-1-1.png", "https://benoti.pe/", "Benoti"],
  ["GRANO-DE-ORO", "https://www.granodeoro.com.pe/img/logo.png", "https://www.granodeoro.com.pe/", "Grano de Oro"],
  ["CAMPOMAR", "https://www.campomar.com.pe/img/svg/brand-campomar-blue.svg", "https://www.campomar.com.pe/", "Campomar — Hayduk"],
  ["SANTORINI", "https://ave-store.pe/wp-content/uploads/2025/03/logo1.svg", "https://ave-store.pe/", "Ave Latam — Santorini"],
  ["LOPESA", "https://www.lopesa.com/images/logo.png", "https://www.lopesa.com/", "Lopesa"],
  ["PIKI", "https://alimentospiki.com/wp-content/uploads/2025/03/logo_piki.png", "https://alimentospiki.com/", "Alimentos Piki"],
  ["SAN-JORGE", "https://sanjorge.com.pe/wp-content/uploads/2022/09/LogotipoSVG2rev300.svg", "https://sanjorge.com.pe/", "Panadería San Jorge"],
  ["EMSAL", "https://salmarinaemsal.com/wp-content/themes/mimanzana/assets/img/logo_header.png", "https://salmarinaemsal.com/", "Sal Marina Emsal — Quimpac"],
];
async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "Mozilla/5.0 DonPepe asset verification" } });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  const sim = createSimulation(); let current;
  try { current = sim.snapshot({ id: "asset-audit", role: "admin" }).catalog.brands; } finally { sim.close(); }
  const directory = path.join(root, "public/images/brands"); await fs.mkdir(directory, { recursive: true });
  const destination = path.join(root, "core/brand-logo-assets.json");
  let prior = { brands: [] }; try { prior = JSON.parse(await fs.readFile(destination, "utf8")); } catch {}
  const records = new Map(prior.brands.map(record => [record.id, record]));
  const failures = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (cursor < sources.length) {
      const [suffix, imageSourceUrl, referenceUrl, sourceOrganization, inlineSvgClass] = sources[cursor++];
      const id = `BRAND-${suffix}`, brand = current.find(record => record.id === id);
      if (!brand) throw Error(`Unknown brand ${id}`);
      const filename = `${suffix.toLowerCase()}.webp`, imageUrl = `/images/brands/${filename}`;
      try {
        const previous = records.get(id);
        if (previous?.imageSourceUrl === imageSourceUrl && !process.env.DONPEPE_REFRESH_LOGOS) {
          try { await fs.access(path.join(directory, filename)); console.log(`${brand.name}: existing verified logo retained`); continue; } catch {}
        }
        const responseBody = await request(imageSourceUrl);
        const svg = inlineSvgClass && [...responseBody.toString("utf8").matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].find(match => match[0].includes(`class="${inlineSvgClass}"`))?.[0];
        if (inlineSvgClass && !svg) throw Error("Official inline logo was not found");
        const binary = inlineSvgClass ? Buffer.from(svg) : responseBody;
        if (/<script|<foreignObject|\b(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/)|@import|url\s*\(\s*["']?(?:https?:|\/\/)/i.test(binary.toString("utf8"))) throw Error("External or executable SVG content rejected");
        const metadata = await sharp(binary).metadata();
        if ((metadata.width || 0) < 30 || (metadata.height || 0) < 15) throw Error("Logo source is too small");
        const output = await sharp(binary, { density: 180 }).rotate().resize(640, 360, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).webp({ quality: 95, effort: 5 }).toBuffer();
        await fs.writeFile(path.join(directory, filename), output);
        records.set(id, { id, name: brand.name, imageUrl, imageKind: "OFFICIAL_BRAND_LOGO", imageSourceUrl, referenceUrl, sourceOrganization, sourceType: "OFFICIAL_BRAND_OR_MANUFACTURER", verifiedOn, ...(inlineSvgClass ? { extractionSelector: `svg.${inlineSvgClass}`, extractionMethod: "Complete official header SVG, without cropping or redrawing" } : {}),
          imageSha256: crypto.createHash("sha256").update(output).digest("hex"), sourceSha256: crypto.createHash("sha256").update(binary).digest("hex"), imageBytes: output.length,
          normalization: "Full logo, contain resize with transparent padding; no cropping, product packaging or AI recreation." });
        console.log(`${brand.name}: official logo downloaded`);
      } catch (error) { failures.push({ id, name: brand.name, imageSourceUrl, referenceUrl, error: error.message }); console.warn(`${brand.name}: ${error.message}`); }
    }
  }));
  const whiteLogos = new Set(["BRAND-SAN-FERNANDO", "BRAND-FLORIDA", "BRAND-B-D", "BRAND-INKA-CHIPS"]);
  const brands = current.map(brand => records.get(brand.id)).filter(Boolean).map(brand => ({ ...brand, preferredBackground: whiteLogos.has(brand.id) ? "dark" : "light" }));
  const missing = current.filter(brand => !records.has(brand.id)).map(brand => ({ id: brand.id, name: brand.name, state: "OFFICIAL_ASSET_NOT_OBTAINED", failedCandidates: failures.filter(f => f.id === brand.id), searchTerms: `${brand.name} Perú marca sitio oficial logotipo`, existingProductReferenceNotAccepted: true }));
  const manifest = { version: 1, verifiedOn, brands, missing, audit: { expectedBrands: current.length, obtainedOfficialLogos: brands.filter(b => b.imageKind === "OFFICIAL_BRAND_LOGO").length, generatedRepresentations: brands.filter(b => b.imageKind === "GENERATED_BRAND_REPRESENTATION").length, missingOfficialAssets: missing.length, productPackshotsUsedAsLogos: false, fullLogoContainWithoutCrop: true } };
  await fs.writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest.audit, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { sources };
