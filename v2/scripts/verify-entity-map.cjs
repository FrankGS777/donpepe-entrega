"use strict";
// Acceptance checks use a disposable application and never touch live data.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{once}=require("node:events");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const {createApp}=require("../server"),{createSimulation}=require("../core/engine");
const output=process.env.DONPEPE_ENTITY_QA_OUTPUT||path.resolve(__dirname,"../../../DonPepe-Refinamiento-2026-10-18");
const OPS={id:"QA-OPS",role:"operations"},checks=[],images=[],cards=[],screenshots=[],errors=[];
let runtime,server,browser,page,context,base,failure;
const record=message=>{checks.push(message);process.stdout.write(message+"\n");};
async function login(role,width=1600){
  await context?.close();context=await browser.newContext({viewport:{width,height:1000},reducedMotion:"reduce"});
  const email={admin:"admin",operations:"operaciones",store:"tienda"}[role]+"@donpepe.local";
  const reply=await context.request.post(base+"/api/login",{data:{email,password:"DonPepe2026!"}});assert.equal(reply.status(),200);
  page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));await page.goto(base+"/");
  await page.waitForFunction(()=>document.body.dataset.role&&document.querySelector("#main h1"));
}
async function navigate(view,selector){await page.goto(base+"/#"+view);await page.locator(selector).first().waitFor();}
async function capture(name){
  // Full-page evidence must include below-the-fold cards too. The application
  // keeps normal lazy loading; only this capture explicitly decodes its page.
  await page.locator("#main img").evaluateAll(async elements=>{
    for(const image of elements)image.loading="eager";
    await Promise.all(elements.map(image=>image.decode().catch(()=>{})));
  });
  const file=path.join(output,name+".png");await page.screenshot({path:file,fullPage:true,animations:"disabled"});screenshots.push(file);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),name+": sin desbordamiento");
}
async function imageReady(locator){
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(image=>image.decode());
  const result=await locator.evaluate(image=>({src:image.getAttribute("src"),width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,
    naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,fit:getComputedStyle(image).objectFit,failed:!!image.dataset.mapReferenceFailed}));
  assert.ok(result.naturalWidth>0&&result.naturalHeight>0);assert.equal(result.failed,false);return result;
}
async function hero(selector,name,card=true){
  const photo=page.locator(selector).first();await photo.waitFor();
  const direct=photo.locator(":scope > img");
  const img=await photo.evaluate(element=>element.tagName==="IMG")?photo:await direct.count()?direct.first():photo.locator("img:visible").first();
  const data=await imageReady(img);
  const box=await photo.boundingBox();assert.ok(box.width>200&&box.height>130,name+": imagen protagonista");
  if(card&&await page.evaluate(()=>innerWidth>=1440))assert.ok(box.width>=300,name+": tarjetas grandes como referencia, no cuatro columnas compactas");
  if(card)assert.ok(box.width/box.height>1.35&&box.width/box.height<1.7,name+": encuadre 3:2");
  cards.push({name,...data,container:box});
}
async function focus(type,id,name){
  await page.locator("#map-find").fill(id);
  const target=page.locator(`#map-results [data-inspect="${type}"][data-id="${id}"]`);await target.waitFor();await target.click();
  const inspector=page.locator("#map-inspector");await inspector.waitFor({state:"visible"});
  const img=inspector.locator("img[data-map-reference]");await img.waitFor();
  const data=await imageReady(img);assert.equal(await img.getAttribute("data-map-reference-type"),type);
  assert.ok(data.width>180&&data.height>90);images.push({type,id,...data});
  if(name)await capture(name);
  await page.locator("#map-find").fill("");return data;
}
async function actualPick(type,id,offset={}){
  await focus(type,id);
  await page.locator('[data-action="close-inspector"]').click();await page.waitForTimeout(120);
  const point=await page.locator("#map-host").evaluate((host,{type,id,offset})=>host.getSceneProjection(type,id,offset),{type,id,offset});
  assert.ok(point?.visible,type+": objetivo proyectado visible");await page.mouse.click(point.x,point.y);
  await page.locator(`#map-inspector img[data-map-reference-type="${type}"]`).waitFor({state:"visible"});
  await imageReady(page.locator("#map-inspector img[data-map-reference]"));
  record(`Selección geométrica real de ${type}, con fotografía y sin caja envolvente de aire`);
}
async function main(){
  fs.mkdirSync(output,{recursive:true});
  runtime=createApp({identityFile:":memory:",simulation:createSimulation(),startClock:false,mailEnv:{},mailTransport:{sendMail:async()=>{throw Error("No outbound mail");},close(){}}});
  server=runtime.app.listen(0,"127.0.0.1");await once(server,"listening");base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true,args:["--enable-webgl","--disable-dev-shm-usage"]});
  await login("admin");
  await navigate("catalog","#catalog-results .master-record");
  const product=await page.locator("#catalog-results .master-record-media").first().boundingBox();cards.push({name:"producto-sin-cambio",container:product});
  await page.locator('[data-govern="catalog-tab"][data-id="supplier"]').click();await hero("#catalog-results .master-record-media","proveedores");await capture("01-proveedores-grandes");
  await page.locator('[data-govern="catalog-tab"][data-id="branch"]').click();await hero("#catalog-results .master-record-media","sucursales-admin");await capture("02-tiendas-admin");
  for(const [view,name]of [["categories","categorias"],["brands","marcas"],["assets","equipos-admin"]]){
    await navigate(view,".admin-registry-grid .admin-entity-photo");await hero(".admin-registry-grid .admin-entity-photo",name);await capture("03-"+name);
  }
  record("Tarjetas grandes coherentes en proveedores, tiendas, categorías, marcas y activos; producto conserva su encuadre");
  await login("operations");
  const snapshot=runtime.simulation.snapshot(OPS),rice=snapshot.catalog.skus.find(item=>item.id==="SKU-ARROZ");
  runtime.simulation.command("purchase.create",{supplierId:rice.supplierId,lines:[{skuId:rice.id,cases:12}]},OPS);
  await navigate("purchases",".entity-card-media.is-logo");await hero(".entity-card-media.is-logo","recepcion-proveedor");await capture("04-recepcion-grande");
  await navigate("equipment",".equipment-card>.equipment-photo");await hero(".equipment-card>.equipment-photo","equipos-ops");await capture("05-equipos-grandes");
  await navigate("stores",".branch-art>.branch-photo");await hero(".branch-art>.branch-photo","tiendas-ops");await capture("06-tiendas-grandes");
  await navigate("autonomy",".autonomy-infrastructure .autonomy-equipment-photo");await hero(".autonomy-infrastructure .autonomy-equipment-photo","autonomia");
  record("Tarjetas grandes en recepción, equipos, tiendas y automatización de Operaciones");
  await navigate("map",'#map-host[data-scene-ready="true"]');await page.waitForTimeout(1000);
  for(const [type,id,name]of [
    ["warehouse","CD1","07-centro-imagen"],["zone",snapshot.layout.zones[0].id],["rack",snapshot.layout.racks[0].id],
    ["loc",snapshot.layout.locations[0].id],["station","RECEIVE"],["station","PACK"],["station","DOCK-1"],["station","CHARGE-1"],
    ["hu",snapshot.hus[0].id,"08-producto-inspector"],["robot","AMR-1"],["robot","STACKER-1"],["robot","FORKLIFT-1"],
    ["truck","TRUCK-1","09-camion-inspector"],["branch",snapshot.catalog.branches[0].id],
    ...snapshot.autonomyConfiguration.assets.map(asset=>["asset",asset.id]),
  ])await focus(type,id,name);
  assert.equal(images.find(row=>row.type==="hu").src,snapshot.catalog.skus.find(sku=>sku.id===snapshot.hus[0].skuId).imageUrl);
  record("Todos los tipos de entidad del mapa muestran una referencia cargada; la carga usa la foto de su producto exacto");
  await actualPick("hu",snapshot.hus[0].id,{y:.08});await actualPick("truck","TRUCK-1");await actualPick("robot","AMR-1",{y:-.5});
  await page.locator('[data-action="close-inspector"]').click();await page.setViewportSize({width:390,height:844});
  await focus("hu",snapshot.hus[0].id,"10-inspector-movil");
  await login("admin",390);await navigate("categories",".admin-registry-grid .admin-entity-photo");await hero(".admin-registry-grid .admin-entity-photo","categorias-movil");await capture("11-categorias-movil");
  await login("store");await navigate("overview",".store-welcome>.store-cover");await hero(".store-welcome>.store-cover","portal-tienda",false);await capture("12-portal-tienda");
  assert.deepEqual(errors,[]);record("Tres perfiles y móvil sin errores JavaScript ni imágenes rotas en la cobertura comprobada");
}
(async()=>{try{await main();}catch(error){failure=error;process.stderr.write(error.stack+"\n");try{await page?.screenshot({path:path.join(output,"failure.png"),fullPage:true});}catch{}}
  finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));runtime?.close();
    fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,"verificacion-entidades.json"),JSON.stringify({ok:!failure,checks,cards,images,screenshots,errors,
      bundle:crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname,"../public/app.js"))).digest("hex"),failure:failure?.message||null},null,2));if(failure)process.exitCode=1;}
})();
