"use strict";
// Isolated user journeys: no production data, no outgoing mail and no 3D GPU.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const output = process.env.DONPEPE_JOURNEY_QA_OUTPUT || path.resolve(__dirname,"../../../DonPepe-Ampliacion-2026-10-17/recorridos");
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"donpepe-journeys-"));
const checks=[], screenshots=[], errors=[], layouts=[];
let runtime,server,browser,base,page;
const snapshot=()=>runtime.simulation.snapshot({id:"qa-inspect",role:"admin"});
const record=text=>{checks.push(text);process.stdout.write(text+"\n");};
async function login(role,hash){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  const response=await context.request.post(`${base}/api/login`,{data:{email:`${role}@donpepe.local`,password:"DonPepe2026!"}});assert.equal(response.status(),200);
  const target=await context.newPage();target.on("pageerror",e=>errors.push(e.message));
  await target.goto(`${base}/#${hash}`);await target.locator("#main h1").waitFor();return target;
}
async function navigate(target,hash){await target.evaluate(hash=>location.hash=hash,hash);await target.waitForFunction(hash=>document.body.dataset.view===hash,hash);await target.locator("#main h1").waitFor();}
async function capture(target,name){
  await target.evaluate(async()=>{await document.fonts.ready;const images=[...document.querySelectorAll('#main img,#dialog[open] img,.entity-picker-dialog[open] img')];for(const image of images)image.loading='eager';await Promise.all(images.map(image=>image.decode().catch(()=>{})));for(const animation of document.getAnimations())if(animation.effect?.getComputedTiming().iterations!==Infinity)try{animation.finish();}catch{}await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelectorAll('#toasts .toast button').forEach(button=>button.click());});
  const sizes=await target.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>{const r=d.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:innerHeight};})}));
  layouts.push({name,...sizes});assert(sizes.document<=sizes.viewport+2,`${name}: horizontal overflow`);
  for(const dialog of sizes.dialogs)assert(dialog.x>=-1&&dialog.y>=-1&&dialog.right<=sizes.viewport+1&&dialog.bottom<=dialog.height+1,`${name}: dialog overflow`);
  const file=path.join(output,`${name}.png`);await target.screenshot({path:file,fullPage:!sizes.dialogs.length,animations:"disabled"});screenshots.push(file);
}
async function submit(target,button,type){
  const pending=target.waitForResponse(r=>r.url().endsWith('/api/commands')&&r.request().postDataJSON()?.type===type);
  await target.locator(button).click();const response=await pending;const body=await response.json();assert.equal(response.status(),200,`${type}: ${JSON.stringify(body)}`);return body.result;
}
async function close(target){if(await target.locator('#dialog[open]').count())await target.locator('#dialog-close').click();}
async function pick(target,selector,value,query=''){
  const select=target.locator(selector);
  await target.waitForFunction(selector=>document.querySelector(selector)?.classList.contains('entity-original-select'),selector);
  await select.locator('..').locator('.entity-picker-trigger').click();
  await target.locator('.entity-picker-dialog[open]').waitFor();
  if(query)await target.locator('#entity-picker-query').fill(query);
  await target.locator(`[data-picker-value="${value}"]`).click();
  await target.locator('.entity-picker-dialog[open]').waitFor({state:'hidden'});
  assert.equal(await select.inputValue(),value);
}
async function main(){
  fs.mkdirSync(output,{recursive:true});runtime=createApp({dataDir,startClock:false,mailEnv:{},mailTransport:{async sendMail(){throw Error("QA no mail");},close(){}}});
  server=runtime.app.listen(0,"127.0.0.1");await once(server,"listening");base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--disable-dev-shm-usage"]});
  const store=await login('tienda','overview');page=store;
  assert.equal(await store.locator('.store-product').count(),12);
  const totalCatalog=await store.locator('#store-catalog-count').textContent();
  await store.locator('#store-page-next').click();assert.equal(await store.locator('.store-product').count(),12);
  await store.locator('#store-catalog-search').fill('SKU-NO-EXISTENTE');assert.equal(await store.locator('.store-product').count(),0);
  await store.locator('#store-catalog-search').fill('');
  const selectedCategory=await store.locator('#store-catalog-category').evaluate(select=>({value:select.options[1].value,label:select.options[1].textContent}));
  await pick(store,'#store-catalog-category',selectedCategory.value,selectedCategory.label);
  assert((await store.locator('#store-catalog-count').textContent()).includes('productos'));
  await store.locator('#store-catalog-category').locator('..').locator('.entity-picker-trigger').click();
  assert.equal(await store.locator('[data-picker-value="all"] img').count(),0);
  await store.locator('#entity-picker-query').fill('filtro sin coincidencias');
  await capture(store,'tienda-selector-categorias-todas-sin-imagen');
  await store.locator('[data-picker-value="all"]').click();
  await store.locator('.entity-picker-dialog[open]').waitFor({state:'hidden'});
  assert.equal(await store.locator('#store-catalog-category').inputValue(),'all');
  assert.equal(await store.locator('.store-product').count(),12);
  assert.equal(await store.locator('#store-catalog-count').textContent(),totalCatalog);
  record('Tienda: catálogo ampliado paginado, búsqueda y selección visual de categoría; Todas permanece accesible sin imagen ficticia incluso al buscar');
  await store.locator('[data-action="new-order"]').first().click();
  await store.locator('#document-product-search').fill('Costeño');
  await store.locator('#line-quantity').fill('0');await store.locator('#add-line').click();
  await store.locator('#line-quantity[aria-invalid=true]').waitFor();
  await capture(store,'tienda-cantidad-invalida');
  await store.locator('#line-quantity').fill('2');await store.locator('#add-line').click();
  await store.locator('[name="notes"]').fill('Reposición solicitada para el turno de la mañana.');
  const order=await submit(store,'#document-submit','order.create');
  await store.locator('#dialog[open]').waitFor({state:'hidden'});
  assert.equal(snapshot().orders.find(o=>o.id===order.id).state,'PENDING');
  await store.locator(`[data-action="open-order"][data-id="${order.id}"]`).click();
  await store.locator('[data-action="edit-order"]').click();
  await store.locator('[data-line-count="0"]').fill('3');await store.locator('[data-line-count="0"]').dispatchEvent('change');
  await submit(store,'#document-submit','order.edit');assert.equal(snapshot().orders.find(o=>o.id===order.id).lines[0].cases,3);
  record('Tienda: validación de cantidad visible, solicitud con nota y edición sólo mientras sigue pendiente');
  await store.locator(`[data-action="open-order"][data-id="${order.id}"]`).click();
  await store.locator('[data-action="repeat-order"]').click();assert.equal(await store.locator('[data-line-count="0"]').inputValue(),'3');await close(store);
  record('Tienda: repetir solicitud recupera líneas para revisar sin enviarlas automáticamente');
  await store.locator(`[data-action="open-order"][data-id="${order.id}"]`).click();
  await store.locator('[data-action="cancel-order"]').click();
  await store.locator('#cancel-order-form button:not([type])').click();
  await store.locator('#cancel-order-form [name="reason"][aria-invalid=true]').waitFor();
  await store.locator('#cancel-order-form [name="reason"]').fill('Solicitud duplicada por error del responsable de tienda.');
  await submit(store,'#cancel-order-form button:not([type])','order.cancel');
  assert.equal(snapshot().orders.find(o=>o.id===order.id).state,'CANCELLED');
  assert(snapshot().orders.find(o=>o.id===order.id).cancelReason);
  record('Tienda: cancelación exige motivo visible y conserva responsable e historial');
  const beforeDraft=snapshot().orders.length;
  await store.locator('[data-action="new-order"]').first().click();
  await store.locator('#document-product-search').fill('Costeño');await store.locator('#line-quantity').fill('100');await store.locator('#add-line').click();
  await store.locator('#document-product-search').fill('Primor');await store.locator('#line-quantity').fill('20');await store.locator('#add-line').click();
  await store.locator('[data-line-count="0"]').fill('110');await store.locator('[data-line-count="0"]').dispatchEvent('change');
  await store.locator('#document-submit').click();
  assert.equal(snapshot().orders.length,beforeDraft);
  await store.locator('[data-line-count="0"][aria-invalid=true]').waitFor();
  assert.equal(await store.locator('[data-line-count="0"]').inputValue(),'110');
  await capture(store,'tienda-total-escrito-no-puede-enviar-valores-antiguos');
  await store.locator('[data-line-count="0"]').fill('100');await store.locator('[data-line-count="0"]').dispatchEvent('change');
  await store.locator('[name="notes"]').fill('Nota que debe conservar el borrador al cerrar.');
  const requestedDay=snapshot().clock.now.slice(0,10);await store.locator('[name="requestedByDate"]').fill(requestedDay);await close(store);
  await store.locator('[data-action="new-order"]').first().click();
  assert.equal(await store.locator('[name="notes"]').inputValue(),'Nota que debe conservar el borrador al cerrar.');
  assert.equal(await store.locator('[name="requestedByDate"]').inputValue(),requestedDay);
  await store.locator('#discard-draft').click();await close(store);
  record('Tienda: total semántico revalidado al enviar; no se envían cantidades antiguas y el borrador conserva nota/fecha');

  const unstocked=snapshot().catalog.skus.find(s=>s.importSource==='VERIFIED_PUBLIC_CATALOG');assert(unstocked);
  runtime.simulation.command('order.create',{lines:[{skuId:unstocked.id,cases:2}],notes:'Solicitud para comprobar faltantes.'},{id:'qa-store',role:'store',branchId:'TIENDA-1'});
  const shortage=snapshot().orders.at(-1);
  const ops=await login('operaciones','orders');page=ops;
  await ops.locator(`[data-action="open-order"][data-id="${shortage.id}"]`).click();
  await ops.locator('.fulfillment-preview .shortfall').waitFor();
  await capture(ops,'operaciones-faltantes-lotes');
  await ops.locator('[data-action="purchase-shortage"]').click();
  assert.equal(await ops.locator('[data-line-count="0"]').inputValue(),'2');
  const purchase=await submit(ops,'#document-submit','purchase.create');
  await ops.locator('#dialog[open]').waitFor({state:'hidden'});
  await ops.locator(`[data-action="cancel-purchase"][data-id="${purchase.id}"]`).click();
  await ops.locator('#cancel-purchase-form [name="reason"]').fill('El proveedor informó que la fecha debe reprogramarse.');
  await submit(ops,'#cancel-purchase-form .dialog-actions button:last-child','purchase.cancel');
  assert.equal(snapshot().purchases.find(p=>p.id===purchase.id).state,'CANCELLED');
  record('Operaciones: disponibilidad real, faltantes→compra prellenada y cancelación documentada antes de llegada');
  await navigate(ops,'equipment');
  await ops.locator('.equipment-photo').first().waitFor();
  await ops.locator('[data-action="request-maintenance"]').first().click();
  await ops.locator('#maintenance-request-form [name="reason"]').fill('Se detectó desgaste irregular en el conjunto de ruedas.');
  await submit(ops,'#maintenance-request-form .dialog-actions button:last-child','maintenance.request');
  assert.equal(snapshot().maintenance.at(-1).state,'REQUESTED');
  record('Operaciones: ficha fotográfica y solicitud técnica sin interferir con la autorización administrativa');
  assert.equal(await ops.locator('[href="#assets"]').count(),0);assert.equal(await store.locator('[href="#assets"]').count(),0);
  record('Los roles operativos no muestran CRUD administrativo de activos ni categorías');
  for(const [role,target,views] of [['tienda',store,['overview','orders','inventory','stores']],['operaciones',ops,['orders','purchases','equipment','incidents','inventory','stores']]]){
    page=target;
    for(const width of [1440,390]){await target.setViewportSize({width,height:width===390?844:1000});
      for(const theme of ['dark','light']){await target.evaluate(theme=>window.DonPepeTheme.set(theme),theme);
        for(const view of views){await navigate(target,view);await capture(target,`${role}-${view}-${theme}-${width}`);}
      }
    }
  }
  record('Tienda y Operaciones: 40 vistas en dos temas y dos anchuras sin desbordamiento horizontal');
  assert.equal(errors.length,0,JSON.stringify(errors));record('Sin errores JavaScript en los nuevos recorridos');
}
(async()=>{let failure;try{await main();}catch(error){failure=error;process.stderr.write(error.stack+'\n');try{await page?.screenshot({path:path.join(output,'error.png'),fullPage:true});}catch{}}
finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));runtime?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'verificacion-recorridos.json'),JSON.stringify({ok:!failure,checks,screenshots,layouts,errors,failure:failure?.message||null,data:'SQLite temporal, correo bloqueado, sin mapa'},null,2));fs.rmSync(dataDir,{recursive:true,force:true});if(failure)process.exitCode=1;}})();
