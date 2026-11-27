"use strict";
// Disposable end-to-end logistics QA. All vehicles, accounts and e-mail are
// fictional. Never connect this verifier to a personal or production database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { once } = require("node:events");
const crypto = require("node:crypto");
const { PNG } = require("pngjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const outputDir = process.env.DONPEPE_MAP_QA_OUTPUT || path.resolve(__dirname,"../../../DonPepe-Mapa-2026-10-17");
const nativeGpu = process.env.DONPEPE_NATIVE_GPU === "1";
const startedAt = new Date().toISOString(), fingerprints=Object.fromEntries(["../public/app.js","../core/engine.js","../core/blueprint.js"].map(file=>[file,crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname,file))).digest("hex")]));
let previousRunSummary=null;
try{const previous=JSON.parse(fs.readFileSync(path.join(outputDir,"verificacion-mapa-flujo.json"),"utf8"));if(previous.ok)previousRunSummary={environment:previous.environment,checks:previous.checks.length,screenshots:previous.screenshots.length,samples:previous.samples.map(({label,warmupMs,performance})=>({label,warmupMs,performance}))};}catch{}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),"donpepe-map-flow-fixture-"));
const actor = { id:"qa-operations", role:"operations" }, store = { id:"qa-store",role:"store",branchId:"TIENDA-1" };
const checks=[],errors=[],screenshots=[],metrics=[],samples=[],phases=[];
let runtime,server,browser,context,page,base,liveTimer,stateResponses=0,gpuInfo;
function record(message) { checks.push(message); process.stdout.write(`${message}\n`); }
function snapshot() { return runtime.simulation.snapshot(actor); }
function command(type,payload={}) { return runtime.simulation.command(type,payload,actor); }
function orderOf(id) { return snapshot().orders.find(o=>o.id===id); }
function seek(predicate,description,max=2400,step=.25) {
  for(let elapsed=0;elapsed<=max;elapsed+=step){const state=snapshot();if(predicate(state))return state;runtime.simulation.advance(step);}
  const state=snapshot();throw Error(`${description}: tiempo agotado. ${JSON.stringify({orders:state.orders,missions:state.missions.filter(m=>!["COMPLETED","CANCELLED"].includes(m.state)),trucks:state.trucks})}`);
}
function vector(value) { return Array.isArray(value)?value.slice(0,3):[value?.x||0,value?.y||0,value?.z||0]; }
function cameraPose(d) { return d?.camera?[...vector(d.camera.position),Number(d.camera.zoom||1),...vector(d.camera.target)]:null; }
function pose(d,id) { const mover=(d.movers||[]).find(m=>m.id===id);return mover?[...vector(mover.position),...(Number.isFinite(mover.liftHeight??mover.forkHeight)?[mover.liftHeight??mover.forkHeight]:[])]:null; }
function carryingLoadError(d,id) { const mover=d?.movers?.find(m=>m.id===id),load=d?.loads?.find(h=>h.id===mover?.carryingHuId&&h.locationId===id);if(!mover||!load)return null;const p=vector(mover.position),actual=vector(load.position),yaw=mover.rotation||0;return Math.hypot(actual[0]-p[0]-Math.sin(yaw)*1.35,actual[1]-p[1]-(mover.liftHeight||0),actual[2]-p[2]-Math.cos(yaw)*1.35); }
function distinct(values) { return new Set(values.filter(Boolean).map(v=>v.map(n=>Number(n).toFixed(3)).join(","))).size; }
function percentile(values,fraction) { const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))].toFixed(2)):null; }
async function diag() { return page.evaluate(()=>document.querySelector("#map-host")?.getSceneDiagnostics?.()); }
async function stateRefresh() { const response=await page.waitForResponse(response=>response.url().endsWith("/api/state")&&response.ok(),{timeout:5000});await response.finished();await page.waitForTimeout(900);await ready(); }
async function ready() { await page.bringToFront();await page.locator('#map-host[data-scene-ready="true"]').waitFor(); }
async function focusEntity(type,id) { await page.locator("#map-find").fill(id);const result=page.locator(`#map-results [data-inspect="${type}"][data-id="${id}"]`);await result.click();await page.waitForTimeout(1100);await ready(); }
async function capture(name) {
  await ready();const filename=path.join(outputDir,`${name}.png`);await page.screenshot({path:filename,fullPage:true,animations:"disabled"});screenshots.push(filename);
  const documentSize=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert(documentSize.document<=documentSize.width+2&&documentSize.body<=documentSize.width+2,`${name}: desbordamiento horizontal ${JSON.stringify(documentSize)}`);
  const box=await page.locator("#map-host canvas").boundingBox(),image=PNG.sync.read(fs.readFileSync(filename)),colors=new Set();let brightness=0,count=0;
  for(let y=Math.floor(box.y+box.height*.35);y<Math.min(image.height,box.y+box.height*.75);y+=4)for(let x=Math.floor(box.x+box.width*.15);x<Math.min(image.width,box.x+box.width*.85);x+=4){const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];colors.add(`${r>>4},${g>>4},${b>>4}`);brightness+=(r*.2126+g*.7152+b*.0722);count++;}
  assert(colors.size>=12,`${name}: el lienzo parece vacío (${colors.size} colores)`);
  const d=await diag(),renderMetrics=await page.locator("#map-host").evaluate(host=>({drawCalls:Number(host.dataset.drawCalls||0),triangles:Number(host.dataset.triangles||0),frameMs:Number(host.dataset.frameMs||0),renderedFrames:Number(host.dataset.renderedFrames||0),gpuMode:host.dataset.gpuMode,effectiveQuality:host.dataset.effectiveQuality}));
  assert(renderMetrics.drawCalls>0&&renderMetrics.triangles>0,"Las métricas proceden de una escena renderizada, no de un lienzo vacío");metrics.push({name,centralColors:colors.size,centralBrightness:Number((brightness/Math.max(1,count)).toFixed(1)),bounds:box,renderer:renderMetrics,diagnostics:d});record(`${name}: escena visible`);
}
async function phaseCapture(orderId,phase,name) {
  const state=seek(s=>s.orders.find(o=>o.id===orderId)?.loading?.phase===phase,`Fase ${phase}`,1200,.5);
  phases.push({phase,elapsed:state.clock.elapsed,order:state.orders.find(o=>o.id===orderId),truck:state.trucks.find(t=>t.orderId===orderId)});await stateRefresh();await focusEntity("truck",state.orders.find(o=>o.id===orderId).truckId);await capture(name);return state;
}
async function sampleRendered(label,durationMs,runClock=true,warmupMs=0) {
  let clockError,last=performance.now(),responsesBefore=stateResponses;const authoritative=[];
  if(runClock)liveTimer=setInterval(()=>{try{const current=performance.now(),seconds=Math.min(.3,(current-last)/1000);last=current;runtime.simulation.advance(seconds);const s=snapshot();authoritative.push({at:current,elapsed:s.clock.elapsed,robots:s.robots.map(r=>({id:r.id,x:r.x,y:r.y,z:r.z,carryingHuId:r.carryingHuId,cargoHeight:r.cargoHeight,state:r.state})),trucks:s.trucks.map(t=>({id:t.id,x:t.x,z:t.z,doorProgress:t.doorProgress,state:t.state}))});}catch(error){clockError=error;clearInterval(liveTimer);}},100);
  if(warmupMs){await page.waitForTimeout(warmupMs);responsesBefore=stateResponses;}let rendered;
  try { rendered=await page.evaluate(async duration=>{const start=performance.now(),rows=[];await new Promise(resolve=>{function frame(){const host=document.querySelector("#map-host");rows.push({at:performance.now(),diagnostics:host?.getSceneDiagnostics?.(),frames:Number(host?.dataset.renderedFrames||0),frameMs:Number(host?.dataset.frameMs||0)});if(performance.now()-start>=duration)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);});return rows;},durationMs); }
  finally { if(liveTimer)clearInterval(liveTimer);liveTimer=null; }
  if(clockError)throw clockError;rendered.stateResponses=stateResponses-responsesBefore;const intervals=rendered.slice(1).map((r,i)=>r.at-rendered[i].at),ids=[...new Set(rendered.flatMap(r=>(r.diagnostics?.movers||[]).map(m=>m.id)))],frameDelta=rendered.at(-1).frames-rendered[0].frames,measuredMs=rendered.at(-1).at-rendered[0].at;samples.push({label,warmupMs,stateResponses:rendered.stateResponses,performance:{rafSamples:rendered.length,renderedFrames:frameDelta,renderedFps:Number((frameDelta/Math.max(.001,measuredMs/1000)).toFixed(2)),medianRafMs:percentile(intervals,.5),p95RafMs:percentile(intervals,.95),medianRendererMs:percentile(rendered.map(r=>r.frameMs),.5),uniquePoses:Object.fromEntries(ids.map(id=>[id,distinct(rendered.map(r=>pose(r.diagnostics,id)))]))},rendered,authoritative});return rendered;
}
async function apiCommand(type,payload) {
  const me=await context.request.get(`${base}/api/me`),csrf=(await me.json()).csrf;
  const response=await context.request.post(`${base}/api/commands`,{headers:{"x-csrf-token":csrf},data:{type,payload:{...payload,commandId:crypto.randomUUID()}}});return{status:response.status(),body:await response.json()};
}
async function dispatchFromUI(orderId) {
  await stateRefresh();await page.locator(`[data-action="open-order"][data-id="${orderId}"]`).first().click();
  const pending=page.waitForResponse(response=>{if(!response.url().endsWith("/api/commands")||response.request().method()!=="POST")return false;return response.request().postDataJSON().type==="order.dispatch";});
  await page.locator(`[data-action="dispatch-order"][data-id="${orderId}"]`).click();const response=await pending,body=await response.json();
  if(response.ok()){await page.locator("#shipment-tracking .shipment-steps li").first().waitFor();assert.equal(await page.locator("#shipment-tracking .shipment-steps li").count(),6);await page.locator("#shipment-tracking .loading-meter progress").waitFor();}
  return{status:response.status(),body};
}
async function cameraChecks() {
  const d=await diag();assert(d?.camera&&Array.isArray(d.movers),"La escena expone diagnóstico de solo lectura para medir poses reales");
  const box=await page.locator("#map-host canvas").boundingBox();await page.mouse.move(box.x+box.width*.72,box.y+box.height*.58);await page.mouse.wheel(0,-320);
  const zoom=await sampleRendered("zoom-smooth",1300,false);const cameraPoses=zoom.map(s=>cameraPose(s.diagnostics));
  assert(distinct(cameraPoses)>=3,"El acercamiento debe producir varias poses intermedias, no un salto");
  assert(cameraPoses.filter(Boolean).every(v=>v.every(Number.isFinite)),"La cámara conserva coordenadas finitas");record("Cámara: zoom con posiciones intermedias medidas y sin valores inválidos");
  for(const view of ["overview","interior","aisle","network"]){const button=page.locator(`[data-camera="${view}"]`);if(!await button.count())continue;await button.click();await page.waitForTimeout(1100);await capture(`mapa-${view}-claro-1440`);}
  await page.locator('[data-camera="overview"]').click();await page.waitForTimeout(1100);await capture("mapa-exterior-claro-1440");
}
async function main() {
  fs.mkdirSync(outputDir,{recursive:true});runtime=createApp({dataDir,startClock:false,mailEnv:{},mailTransport:{async sendMail(){return{accepted:[]};},close(){}}});server=runtime.app.listen(0,"127.0.0.1");await once(server,"listening");base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--enable-webgl",...nativeGpu?[]:["--use-angle=swiftshader","--enable-unsafe-swiftshader"],"--disable-dev-shm-usage"]});context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"no-preference"});page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.on("response",response=>{if(response.url().endsWith("/api/state"))stateResponses++;});
  await page.goto(`${base}/login`);await page.locator('[name="email"]').fill("operaciones@donpepe.local");await page.locator('[name="password"]').fill("DonPepe2026!");await page.locator('#login-form [type="submit"]').click();await page.waitForURL(`${base}/`);await ready();await page.evaluate(()=>window.DonPepeTheme.set("light"));await ready();await capture("mapa-primer-montaje-claro-1440");
  gpuInfo=await page.locator("#map-host").evaluate(host=>host.getSceneDiagnostics().renderer);await cameraChecks();
  assert.equal(await page.locator("#map-inspector").isVisible(),false,"El mapa inicia sin una inspección superpuesta");
  assert.equal(await page.locator("#map-resources").isVisible(),false,"Los recursos no cubren el mapa al entrar");
  await page.locator(".resource-toggle").click();await page.locator("#map-resources").waitFor({state:"visible"});
  for(const resource of ["docks","robots","trucks"]){const tab=page.locator(`[data-resource-tab="${resource}"]`);await tab.click();assert.equal(await tab.getAttribute("aria-selected"),"true");assert((await page.locator("#resource-list").textContent()).trim().length>0);}
  await page.locator(".resource-close").click();await page.locator("#map-resources").waitFor({state:"hidden"});
  const zoomButton=page.locator('[data-action="zoom-map-out"]');await zoomButton.click();const buttonZoom=await sampleRendered("zoom-button-smooth",1000,false);assert(distinct(buttonZoom.map(s=>cameraPose(s.diagnostics)))>=3);record("Consola exterior: recursos de muelles/equipos/camiones y zoom accesible");
  if(process.env.DONPEPE_MAP_QA_ONLY==="exterior"){assert.equal(errors.length,0,JSON.stringify(errors));return;}
  const initialOrder=snapshot().orders.find(o=>o.state==="PENDING"&&o.branchId==="TIENDA-1");let orderId=initialOrder.id;
  // Three physical loads keep the complete loading pipeline active during the
  // separate cold-start and sustained 5x measurements. Use the public command,
  // not a state mutation or invented stock, and cancel only the pending fixture.
  if(nativeGpu){command("order.cancel",{id:initialOrder.id,reason:"Sustituir solicitud inicial en verificación aislada"});orderId=runtime.simulation.command("order.create",{branchId:store.branchId,lines:[...initialOrder.lines.map(({skuId,cases})=>({skuId,cases})),{skuId:"SKU-FIDEOS",cases:3}],notes:"Pedido de verificación temporal con tres cargas físicas"},store).id;}
  command("order.release",{id:orderId});
  const depositingState=seek(s=>s.robots.some(r=>r.type==="AMR"&&r.state==="STAGING_DEPOSIT"&&r.carryingHuId),"AGV deposita en plaza física",2400,.5),agv=depositingState.robots.find(r=>r.type==="AMR"&&r.state==="STAGING_DEPOSIT"&&r.carryingHuId);
  await stateRefresh();await page.locator('[data-camera="interior"]').click();await page.waitForTimeout(1100);await capture("preparacion-agv-deposito");
  const depositing=await sampleRendered("agv-staging-deposit",1250,true),agvSamples=depositing.map(s=>{const mover=s.diagnostics?.movers?.find(m=>m.id===agv.id),load=s.diagnostics?.loads?.find(h=>h.id===mover?.carryingHuId&&h.locationId===agv.id);if(!mover||!load)return null;const p=vector(mover.position),h=vector(load.position);return{height:mover.cargoHeight,error:Math.hypot(h[0]-p[0],h[1]-p[1]-mover.cargoHeight,h[2]-p[2])};}).filter(Boolean);
  assert(agvSamples.length>=3&&agvSamples.every(s=>s.error<.02&&s.height>=.18-.001&&s.height<=.95+.001),"La HU sigue la plataforma real del AGV durante el descenso");assert(new Set(agvSamples.map(s=>s.height.toFixed(3))).size>=3,"El descenso de plataforma contiene posiciones intermedias");record("AGV: plataforma y HU bajan alineadas de forma gradual antes de retirar el vehículo y liberar la plaza");
  seek(s=>s.orders.find(o=>o.id===orderId).state==="READY","Preparación de pedido",2400,1);
  const readyState=snapshot(),order=readyState.orders.find(o=>o.id===orderId),huIds=new Set(order.allocations.map(a=>a.huId)),cases=order.lines.reduce((n,l)=>n+l.cases,0),warehouseTotal=readyState.hus.reduce((n,h)=>n+h.cases,0);
  assert(huIds.size>=2,"El escenario prueba varias cargas y dos conservaciones");
  const dispatched=await dispatchFromUI(orderId);assert.equal(dispatched.status,200,JSON.stringify(dispatched.body));const allocated=orderOf(orderId);assert.equal(allocated.state,"LOADING");assert.equal(allocated.loading.loadedLoads,0);assert.equal(allocated.loading.totalLoads,huIds.size);
  assert(snapshot().hus.filter(h=>huIds.has(h.id)).every(h=>h.state==="RESERVED_LOADING"&&h.locationId!==allocated.truckId),"Las cargas permanecen físicamente en expedición al autorizar");record("Interfaz: autorizar desde el pedido abre el seguimiento de seis etapas y su progreso de carga");
  assert.equal((await apiCommand("order.dispatch",{id:orderId})).status,409,"No se genera una segunda carga por doble clic");
  const cancelled=await apiCommand("order.cancel",{id:orderId});assert([409,422].includes(cancelled.status),"No se cancela una carga física iniciada");record("Autorizar despacho no teletransporta mercancía; doble autorización y cancelación durante carga rechazadas");
  await stateRefresh();await capture("carga-01-asignacion-muelle");
  await focusEntity("truck",allocated.truckId);
  await phaseCapture(orderId,"OPENING","carga-02-apertura-puertas");
  const openSamples=await sampleRendered("doors-opening",2300,true);const doorSamples=openSamples.map(s=>s.diagnostics?.movers?.find(m=>m.id===allocated.truckId)?.doorProgress).filter(Number.isFinite);assert(new Set(doorSamples.map(v=>Number(v).toFixed(3))).size>=3,"Las puertas muestran apertura gradual");await stateRefresh();await capture("carga-02b-apertura-intermedia");
  seek(s=>s.orders.find(o=>o.id===orderId)?.loading?.phase==="LOADING"&&s.robots.some(r=>r.type==="FORKLIFT"&&r.carryingHuId&&huIds.has(r.carryingHuId)),"Montacargas recoge carga",1200,.5);
  const carrying=snapshot().robots.find(r=>r.type==="FORKLIFT"&&huIds.has(r.carryingHuId));assert(carrying);await stateRefresh();await focusEntity("robot",carrying.id);await capture("carga-03-montacargas-con-hu");
  const beforeFault=snapshot(),faultDevice=beforeFault.robots.find(r=>r.id===carrying.id);assert(faultDevice.carryingHuId,"La prueba de avería utiliza un montacargas con carga real");command("simulation.pause",{paused:true});const pausedAt=snapshot().clock.elapsed;runtime.simulation.advance(5);assert.equal(snapshot().clock.elapsed,pausedAt);assert.deepEqual(snapshot().robots.find(r=>r.id===carrying.id),faultDevice);command("simulation.pause",{paused:false});record("Pausar durante la carga congela el reloj y la posición física sin cancelar reservas");
  command("equipment.fault",{id:carrying.id,reason:"Inspección preventiva de la carga en horquillas"});runtime.simulation.advance(2);const faultAfter=snapshot().robots.find(r=>r.id===carrying.id);assert.equal(faultAfter.state,"FAULT");assert.equal(faultAfter.carryingHuId,faultDevice.carryingHuId);assert.deepEqual([faultAfter.x,faultAfter.y,faultAfter.z],[faultDevice.x,faultDevice.y,faultDevice.z]);
  await stateRefresh();await capture("carga-04-incidencia-con-carga");command("equipment.recover",{id:carrying.id});
  if(nativeGpu)command("simulation.speed",{speed:5});
  const forkliftSamples=await sampleRendered(nativeGpu?"forklift-carrying-native-5x":"forklift-carrying",nativeGpu?8000:4200,true);
  assert(distinct(forkliftSamples.map(s=>pose(s.diagnostics,carrying.id)))>=Math.max(5,forkliftSamples.stateResponses+2),"El montacargas debe mostrar más poses renderizadas que instantáneas recibidas del servidor");
  const visualLoadErrors=forkliftSamples.map(s=>carryingLoadError(s.diagnostics,carrying.id)).filter(Number.isFinite);assert(visualLoadErrors.length>=3&&visualLoadErrors.every(error=>error<.02),"La HU renderizada acompaña las horquillas, sin desprenderse ni atravesar el equipo");
  if(nativeGpu){const steady=await sampleRendered("forklift-steady-native-5x",8000,true,1000);assert(distinct(steady.map(s=>pose(s.diagnostics,carrying.id)))>=Math.max(5,steady.stateResponses+2),"La medición sostenida sigue mostrando desplazamientos reales");command("simulation.speed",{speed:1});record("Rendimiento: arranque y ocho segundos sostenidos a 5× registrados por separado, sin imponer una promesa universal de FPS");}
  await stateRefresh();await focusEntity("robot",carrying.id);await capture("carga-03b-montacargas-operando");record("Montacargas: movimiento interpolado medido y HU anclada a horquillas; avería y recuperación conservan la carga");
  await focusEntity("truck",allocated.truckId);
  const verified=await phaseCapture(orderId,"VERIFYING","carga-05-verificacion-total");const verifiedOrder=verified.orders.find(o=>o.id===orderId),truck=verified.trucks.find(t=>t.id===verifiedOrder.truckId);assert.equal(verifiedOrder.loading.loadedLoads,verifiedOrder.loading.totalLoads);assert.equal(truck.doorProgress,1);assert(verified.hus.filter(h=>huIds.has(h.id)).every(h=>h.state==="ON_TRUCK"&&h.locationId===truck.id&&h.truckSlotId));
  const usedSlots=truck.loadPositions.filter(slot=>huIds.has(slot.huId));assert.equal(usedSlots.length,huIds.size);assert.equal(new Set(usedSlots.map(slot=>slot.id)).size,huIds.size);assert.equal(verified.storeStock.reduce((n,r)=>n+r.cases,0),0);record("Verificación: todas las HU ocupan posiciones únicas en el camión; aún no hay existencias en tienda");
  const loadedVisual=await diag(),renderedTruck=loadedVisual.movers.find(m=>m.id===truck.id),truckPosition=vector(renderedTruck.position),yaw=renderedTruck.rotation||0;for(const slot of usedSlots){const load=loadedVisual.loads.find(h=>h.id===slot.huId&&h.locationId===truck.id);assert(load,`${slot.huId}: falta la carga renderizada dentro del remolque`);const p=vector(load.position),expected=[truckPosition[0]+slot.x*Math.cos(yaw)+slot.z*Math.sin(yaw),truckPosition[1]+slot.y,truckPosition[2]+slot.z*Math.cos(yaw)-slot.x*Math.sin(yaw)];assert(Math.hypot(...p.map((v,i)=>v-expected[i]))<.02,`${slot.huId}: posición visual distinta de su plaza de remolque`);}record("Render: cada HU verificada está visualmente en su plaza del remolque, sin apilar varias en un mismo punto");
  await phaseCapture(orderId,"CLOSING","carga-06-cierre-puertas");const closedSamples=await sampleRendered("doors-closing",2300,true);const closing=closedSamples.map(s=>s.diagnostics?.movers?.find(m=>m.id===truck.id)?.doorProgress).filter(Number.isFinite);assert(new Set(closing.map(v=>Number(v).toFixed(3))).size>=3,"Las puertas muestran cierre gradual");await stateRefresh();await capture("carga-06b-cierre-intermedio");
  const undocking=await phaseCapture(orderId,"UNDOCKING","carga-07-salida-del-muelle");assert.equal(undocking.trucks.find(t=>t.id===truck.id).doorProgress,0);assert(undocking.hus.filter(h=>huIds.has(h.id)).every(h=>h.state==="ON_TRUCK"));
  const outbound=seek(s=>s.trucks.find(t=>t.id===truck.id).state==="OUTBOUND","Salida a carretera",1200,.5);assert(outbound.hus.filter(h=>huIds.has(h.id)).every(h=>h.state==="IN_TRANSIT"));assert.equal(outbound.hus.reduce((n,h)=>n+h.cases,0),warehouseTotal);assert.equal(outbound.trucks.find(t=>t.id===truck.id).doorProgress,0);
  await stateRefresh();await capture("carga-08-camion-en-ruta");const road=await sampleRendered("truck-outbound",4200,true);assert(distinct(road.map(s=>pose(s.diagnostics,truck.id)))>=Math.max(5,road.stateResponses+2),"El recorrido del camión tiene más poses renderizadas que instantáneas de servidor");
  if(nativeGpu){const steady=await sampleRendered("truck-steady-native",4200,true,1000);assert(distinct(steady.map(s=>pose(s.diagnostics,truck.id)))>=Math.max(5,steady.stateResponses+2),"El camión sigue desplazándose suavemente tras precargar los estados");record("Camión: mediciones de arranque y recorrido sostenido registradas por separado");}
  record("Secuencia: todas las cargas primero, puertas cerradas después, salida y viaje sólo al completar el muelle");
  seek(s=>s.orders.find(o=>o.id===orderId).state==="ARRIVED","Llegada a tienda",1200,1);assert.equal(snapshot().storeStock.length,0);runtime.simulation.command("order.receive",{id:orderId},store);const received=snapshot();assert.equal(received.storeStock.filter(r=>r.orderId===orderId).reduce((n,r)=>n+r.cases,0),cases);assert.equal(received.hus.reduce((n,h)=>n+h.cases,0)+received.storeStock.reduce((n,r)=>n+r.cases,0),warehouseTotal);record("La tienda incorpora existencias únicamente al confirmar la entrega; balance centro + tránsito + tienda conservado");
  seek(s=>s.trucks.every(t=>t.state==="AVAILABLE")&&s.missions.every(m=>["COMPLETED","CANCELLED"].includes(m.state)),"Fin de movimientos",2400,1);command("simulation.pause",{paused:true});await stateRefresh();await ready();await page.waitForTimeout(1300);const before=Number(await page.locator("#map-host").getAttribute("data-rendered-frames"));await page.waitForTimeout(1700);assert.equal(Number(await page.locator("#map-host").getAttribute("data-rendered-frames")),before,"En reposo no se mantiene un bucle de renderizado");
  await page.locator('[data-camera="overview"]').click();await page.waitForTimeout(1100);
  for(const theme of ["dark","light"]){await page.evaluate(t=>window.DonPepeTheme.set(t),theme);await ready();await capture(`mapa-exterior-ui-${theme}-1440`);}await page.setViewportSize({width:390,height:844});await ready();await capture("mapa-exterior-movil-390");record("Reposo sin frames continuos, cambio de apariencia y mapa móvil comprobados");
  assert.equal(errors.length,0,JSON.stringify(errors));record("Cero errores JavaScript y conservación del balance en todo el flujo");
}
(async()=>{let failure;try{await main();}catch(error){failure=error;process.stderr.write(`${error.stack}\n`);try{await page?.screenshot({path:path.join(outputDir,"mapa-error-qa.png"),fullPage:true,animations:"disabled"});}catch{}}
finally{if(liveTimer)clearInterval(liveTimer);if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));runtime?.close();fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(path.join(outputDir,"verificacion-mapa-flujo.json"),JSON.stringify({ok:!failure,checks,errors,screenshots,metrics,samples,phases,previousRunSummary,environment:{startedAt,fingerprints,scope:process.env.DONPEPE_MAP_QA_ONLY||"full",browser:"Chrome headless",gpuRequested:nativeGpu?"Nativo sin forzar renderer":"SwiftShader de prueba; no representa el rendimiento de la GPU del usuario",gpuActual:gpuInfo,mail:"Simulado; no se enviaron correos",data:"Bases temporales aisladas"},failure:failure?.message||null},null,2));fs.rmSync(dataDir,{recursive:true,force:true});process.stdout.write(`Resultado: ${checks.length} comprobaciones, ${screenshots.length} capturas. ${path.join(outputDir,"verificacion-mapa-flujo.json")}\n`);if(failure)process.exitCode=1;}})();
