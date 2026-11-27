"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createApp}=require('../server'),{createSimulation}=require('../core/engine'),{createStore}=require('../core/store');
const out=path.resolve(__dirname,'../../../ampliacion-y-vencimientos-20261029');
const checks=[],errors=[];let runtime,server,browser,folder;
async function main(){
 fs.mkdirSync(out,{recursive:true});folder=fs.mkdtempSync(path.join(os.tmpdir(),'dp-rear-ui-'));
 const filename=path.join(folder,'scenario.sqlite'),sim=createSimulation({filename});
 const db=createStore(filename),s=db.read();s.hus[0].expiry='2026-10-16';db.write(s);db.close();
 runtime=createApp({identityFile:':memory:',simulation:sim,startClock:false,mailEnv:{},mailTransport:{sendMail:async()=>{throw Error('QA only');},close(){}}});
 server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--disable-dev-shm-usage']});
 const ctx=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
 assert.equal((await ctx.request.post(base+'/api/login',{data:{email:'operaciones@donpepe.local',password:'DonPepe2026!'}})).status(),200);
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/#map');await page.locator('#map-host[data-scene-ready="true"]').waitFor({timeout:60000});
 await page.locator('[data-camera="interior"]').click();await page.waitForTimeout(1400);
 await page.screenshot({path:path.join(out,'01-ampliacion-interior.png')});
 await page.locator('[data-camera="overview"]').click();await page.waitForTimeout(1000);await page.screenshot({path:path.join(out,'02-ampliacion-exterior.png')});
 const layout=sim.snapshot({id:'QA',role:'operations'}).layout;assert.equal(layout.locations.length,448);assert.equal(layout.aisles.filter(a=>a.added).length,16);checks.push('16 pasillos nuevos y 448 posiciones coherentes con la escena');
 await page.locator('#map-find').fill('HU-00001');await page.locator('#map-results [data-inspect="hu"][data-id="HU-00001"]').click();await page.waitForTimeout(500);
 assert.equal(await page.locator('#dialog[open]').count(),0);assert.match(await page.locator('#map-inspector').textContent(),/HU-00001/);
 await page.screenshot({path:path.join(out,'03-inspeccion-frontal.png')});checks.push('Cámara frontal directa de carga, sin selector emergente');
 await page.locator('[data-action="close-inspector"]').click();await page.locator('#map-find').fill('');await page.waitForTimeout(200);
 const point=await page.locator('#map-host').evaluate(host=>host.getSceneProjection('hu','HU-00001'));assert(point?.visible);await page.mouse.click(point.x,point.y);await page.waitForTimeout(400);
 assert.equal(await page.locator('#dialog[open]').count(),0);assert.match(await page.locator('#map-inspector').textContent(),/HU-00001/);checks.push('Clic geométrico real enfoca el objeto directamente');
 await page.goto(base+'/#incidents');sim.advance(200);await page.waitForTimeout(1100);
 await page.locator('.expiry-control').waitFor();await page.screenshot({path:path.join(out,'04-retiro-y-vencimientos.png')});
 const pending=sim.snapshot({id:'QA',role:'operations'}).expiry.records.find(r=>r.state==='AWAITING_DISPOSAL');assert(pending);
 await page.locator(".expiry-control details summary").click();
 await page.locator(`.expiry-control [data-action="resolve-incident"][data-id="EXPIRY:${pending.huId}"]`).click();assert((await page.locator('#incident-form textarea').inputValue()).includes('Baja por vencimiento'));
 await page.locator('#incident-form [type="checkbox"]').check();await page.locator('#incident-form button:not([type="button"])').click();await page.locator('#dialog').waitFor({state:'hidden'});
 assert.equal(sim.snapshot({id:'QA',role:'operations'}).ledger.writtenOffCases,12);checks.push('Baja mediante una confirmación con motivo prellenado, inventario y movimiento registrados');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'05-vencimientos-movil.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 for(const theme of ['dark','light']){await page.evaluate(t=>window.DonPepeTheme.set(t),theme);await page.screenshot({path:path.join(out,`06-control-${theme}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);
}
main().catch(e=>{errors.push(e.stack || e.message);console.error(e);process.exitCode=1;}).finally(async()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));await browser?.close();if(server)await new Promise(r=>server.close(r));runtime?.close();if(folder)fs.rmSync(folder,{recursive:true,force:true});console.log(JSON.stringify({checks,errors}));});
