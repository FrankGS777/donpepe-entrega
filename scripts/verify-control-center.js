// Isolated UI fixtures. Never imports app.js, connects to MySQL, or changes real records.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const express=require('express');
const ejs=require('ejs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {can}=require('../config/permissions');
const {AREAS,allBins}=require('../config/warehouseBlueprint');
const {plannedLayout}=require('../models/warehouseLayout');
const root=path.resolve(__dirname,'..');
const output=process.env.VERIFY_OUTPUT||'/tmp/donpepe-control-center';
const branches=[{id:1,codigo:'DP-CENTRO',nombre:'DonPepe Centro',direccion:'Destino de prueba visual',activo:1,pedidos:2},{id:2,codigo:'DP-NORTE',nombre:'DonPepe Norte',direccion:'Destino de prueba visual',activo:1,pedidos:1},{id:3,codigo:'DP-SUR',nombre:'DonPepe Sur',direccion:'Destino de prueba visual',activo:1,pedidos:0}];
const product={id:1,sku:'SKU-LAC-0012',nombre:'Leche UHT Gloria entera 1 L',producto:'Leche UHT Gloria entera 1 L',unidad_medida:'UND',categoria:'Lácteos',marca:'Gloria',proveedor:'Proveedor de prueba',proveedor_id:1,precio_compra:4.5,imagen_url:'/images/resource-fallback.svg',disponible_picking:48,clase_abc:'A',control_lote:1,control_vencimiento:1,vida_util_dias:180};
const orders=[{id:1,codigo:'PS-00001',estado:'DESPACHADO',sucursal_id:1,sucursal:branches[0].nombre,lineas:2,unidades:48,tareas_abiertas:0,creado_en:'2026-10-17T12:00:00Z',despachado_en:'2026-10-17T14:00:00Z',placa_vehiculo:'FIX-001',referencia_guia:'PRUEBA'},{id:2,codigo:'PS-00002',estado:'LISTO',sucursal_id:2,sucursal:branches[1].nombre,lineas:1,unidades:24,tareas_abiertas:0,creado_en:'2026-10-17T12:00:00Z'},{id:3,codigo:'PS-00003',estado:'PENDIENTE',sucursal_id:1,sucursal:branches[0].nombre,lineas:1,unidades:12,tareas_abiertas:0,creado_en:'2026-10-17T12:00:00Z'}];
const task={id:1,codigo_tarea:'T-000001',tipo:'REABASTECIMIENTO',estado:'PENDIENTE',prioridad:'ALTA',producto:product.nombre,sku:product.sku,cantidad:24,asignado:null,origen:'Reserva seca A',destino:'Preparación de pedidos',zona_origen:'Reserva seca A',zona_destino:'Preparación de pedidos',loc_origen:'CD1-SEC-A-A01-R01-N02-C01-D01',loc_destino:'CD1-VEN-A01-R01-N01-C01-D01',numero_lote:'FAB-171026',creador:'Fixture',asignado_a:null};
const network={generatedAt:new Date().toISOString(),warehouse:{id:'CD1',name:'Centro de distribución DonPepe'},branches,suppliers:[{id:1,razon_social:'Proveedor de prueba'}],orders,purchases:[{id:1,codigo_orden:'OC-00001',estado:'PENDIENTE',proveedor:'Proveedor de prueba',unidades_pendientes:120}],tasks:[task],stats:{units:2840,pendingTasks:1,inProgressTasks:0,readyOrders:1,dispatchedOrders:1,pendingPurchases:1},capabilities:{plan:true,dispatch:true,purchasesView:false},simulation:{schematic:true,telemetry:false}};
const zones=AREAS.map((area,index)=>({id:index+1,codigo_zona:area.code,nombre:area.code,proposito:area.profile,condicion_almacenamiento:area.code.includes('FRI')?'REFRIGERADO':'AMBIENTE',secuencia_operativa:index}));
const bins=allBins().map(bin=>({ubicacion_id:1,zona_id:zones.find(z=>z.codigo_zona===bin.zone).id,codigo_loc:bin.code,modelo_plano:'CD1',pasillo:bin.aisle,estante:bin.rack,nivel:bin.level,posicion:bin.cell,profundidad:bin.depth,tipo:bin.type||'RESERVA',activo:1,capacidad_hu:1,ocupacion_hu:0,unidades_ocupadas:0,porcentaje_ocupacion:0})).map((bin,index)=>({...bin,ubicacion_id:index+1}));
const layout=plannedLayout(zones,bins); layout.locations.forEach(loc=>{loc.stock=[];loc.lastConfirmedTransfer=null});
const position={id:10,producto_id:1,sku:product.sku,producto:product.nombre,imagen_url:product.imagen_url,numero_lote:'FAB-171026',disponible_planificable:40,estado_inventario:'DISPONIBLE',tipo:'RESERVA',ubicacion_id:1,codigo_loc:task.loc_origen,zona:'Reserva seca A',ubicacion_picking_id:20,deficit_pick:24,stock_pick:0,stock_objetivo_pick:24,clase_abc:'A',condicion_requerida:'AMBIENTE'};
const destination={id:20,codigo_loc:task.loc_destino,zona:'Preparación de pedidos',tipo:'PICKING',capacidad_libre:1,capacidad_hu:1,permite_picking:1,picking_owner_id:1,condicion_almacenamiento:'AMBIENTE',secuencia_putaway:1};
const operators=[{id:9,nombre:'Ana · operadora de prueba'}];
const screens={dashboard:['dashboard/warehouse','/dashboard','jefe_operaciones'],map:['wms/map','/wms/mapa','jefe_operaciones'],task:['wms/task-form','/wms/tareas/nueva','jefe_operaciones'],board:['wms/tasks','/wms/tareas','jefe_operaciones'],branch:['distribution/form','/wms/sucursales/nuevo','jefe_operaciones'],order:['distribution/show','/wms/sucursales/3','jefe_operaciones'],branches:['distribution/index','/wms/sucursales','jefe_operaciones'],purchase:['compras/form','/compras/nueva','administrador_wms']};
async function main(){
  const app=express();app.use(express.urlencoded({extended:false}));app.use(express.static(path.join(root,'public')));
  app.get('/wms/red/datos',(_req,res)=>res.json(network));
  app.get('/wms/mapa/datos',(_req,res)=>res.json({generatedAt:new Date().toISOString(),layout,tasks:[]}));
  app.post(['/compras','/wms/sucursales'],(req,res)=>res.json({fixture:true,received:req.body}));
  app.get('/preview/:screen',async(req,res,next)=>{try{
    const [view,currentPath,role]=screens[req.params.screen];
    const locals={title:'Vista previa DonPepe · datos de prueba',storeName:'Don Pepe WMS',timeZone:'America/Lima',currentPath,currentUser:{id:0,nombre:'Vista previa',correo:'fixture@example.test',rol:role,perfil:role,rol_etiqueta:role.replaceAll('_',' ')},homePath:'/dashboard',csrfToken:'fixture-only',can:p=>can(role,p),date:v=>v?'17 oct. 2026':'',money:v=>'S/ '+Number(v).toFixed(2),flash:null,error:null,errors:[],form:{},pendingRequests:[],pendingRequestCount:0,shellContext:{section:'Vista previa',page:'Operación'},network,branches,products:[product],providers:[{id:1,activo:1,razon_social:'Proveedor de prueba',ruc:'00000000001'}],positions:[position],destinations:[destination],operators,tasks:[task],filters:{},orders,order:{...orders[2],codigo_sucursal:'DP-CENTRO',direccion:'Destino de prueba visual',creador:'Jefe de operaciones',lines:[{...product,cantidad_solicitada:12,preparada:0,en_tarea:0}],tasks:[],returns:[]},data:{stats:{putaway_pendientes:1,criticos:1,por_vencer:1,unidades:2840},floorQueue:[],movements:[],critical:[{nombre:product.nombre,stock_total:4,stock_minimo:12}],expiring:[{producto:'Producto de prueba',numero_lote:'FAB-B',cantidad_actual:12,dias:8}]},wms:{tasks:{pendientes:1,en_proceso:0,completadas_hoy:0},zones:[{codigo_zona:'SEC-A',zona:'Reserva seca A',ocupadas:1,capacidad:320,ocupacion:0.3}],replenishment:[]},summary:{tasks:{pendientes:1,en_proceso:0,completadas_hoy:0,total:1}}};
    locals.zones=layout.zones;locals.locations=layout.locations.filter(loc=>loc.occupied>0).slice(0,60);
    locals.summary.zones=locals.wms.zones;locals.summary.replenishment=[];
    locals.body=await ejs.renderFile(path.join(root,'views',view+'.ejs'),locals);
    res.send(await ejs.renderFile(path.join(root,'views/layouts/main.ejs'),locals));
  }catch(error){next(error)}});
  const server=await new Promise((resolve,reject)=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));listener.on('error',reject)});
  const base=`http://127.0.0.1:${server.address().port}`;let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--enable-webgl','--ignore-gpu-blocklist']});
    const page=await browser.newPage({reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
    fs.mkdirSync(output,{recursive:true});
    for(const width of [1440,1024,390]){
      await page.setViewportSize({width,height:1000});
      for(const screen of Object.keys(screens)){
        assert.equal((await page.goto(`${base}/preview/${screen}`)).status(),200,screen);
        await page.evaluate(()=>document.fonts.ready);
        if(screen==='dashboard'||screen==='map') await page.waitForFunction(()=>Number(document.querySelector('[data-logistics-scene]')?.dataset.renderedFrames)>0);
        await page.waitForTimeout(350);
        await page.screenshot({path:path.join(output,`${screen}-${width}.png`),fullPage:true});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${screen}/${width}: horizontal overflow`);
      }
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(`${base}/preview/branch`);
    await page.locator('[data-branch-choice="1"]').click();
    await page.locator('.commerce-navigation button').last().click();
    await page.selectOption('#branchProduct','1');
    await page.locator('#branchQty').fill('12');await page.locator('#branchAdd').click();
    await page.locator('.commerce-navigation button').last().click();
    assert.equal(await page.locator('#branchSubmit').isVisible(),true);
    assert.equal(await page.locator('#branchSummaryUnits').textContent(),'12');
    await page.screenshot({path:path.join(output,'branch-confirm-1440.png'),fullPage:true});
    await page.locator('#branchSubmit').click();await page.waitForURL('**/wms/sucursales');
    const posted=JSON.parse(await page.locator('body').innerText());
    assert.equal(posted.received.sucursal_id,'1');assert.equal(JSON.parse(posted.received.items)[0].cantidad,12);
    await page.goto(`${base}/preview/purchase`);
    await page.selectOption('#purchaseProvider','1');await page.locator('.commerce-navigation button').last().click();
    await page.selectOption('#purchaseProduct','1');await page.locator('#purchaseQty').fill('24');await page.locator('#addPurchase').click();await page.locator('.commerce-navigation button').last().click();
    assert.equal(await page.locator('#submitPurchase').isDisabled(),false);
    await page.screenshot({path:path.join(output,'purchase-confirm-1440.png'),fullPage:true});
    await page.locator('#submitPurchase').click();await page.waitForURL('**/compras');
    const purchase=JSON.parse(await page.locator('body').innerText());assert.equal(JSON.parse(purchase.received.items)[0].cantidad,24);
    assert.deepEqual(errors,[]);
    console.log(`Control center: 24 responsive states, 2 complete fixture POST flows, no JS errors/overflow. ${output}`);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error(error);process.exitCode=1});
