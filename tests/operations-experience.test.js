process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-with-more-than-32-characters";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { matchesTaskLoad } = require("../utils/rfIdentity");
const { assignTaskRecord } = require("../services/wmsService");
const Network = require("../models/LogisticsNetwork");
const load = {control_lote:1,sku:"SKU-YOG",codigo_barras:"7750000000010",numero_lote:"FAB-A",codigo_lote_wms:"L-000012",codigo_hu:"HU-98"};

test("un producto trazable confirma lote/HU, no solamente su EAN", () => {
  for (const value of ["FAB-A", " l-000012 ", "hu-98"]) assert(matchesTaskLoad(load,value));
  for (const value of [load.sku,load.codigo_barras,"FAB-B","",null]) assert.equal(matchesTaskLoad(load,value),false);
  assert(matchesTaskLoad({...load,control_lote:0},load.codigo_barras));
});

function assignmentConnection({ assignAllowed=true, pickAllowed=true, pending=true }={}) {
  const writes=[];
  return {writes,execute:async(sql,params)=>{
    if(sql.includes("SELECT u.id,u.nombre")) return [[{id:9,nombre:"Operadora de prueba"}]];
    if(sql.includes("FROM usuarios")) return [[params[0]===1
      ? {id:1,activo:1,perfil:"jefe_operaciones",permisos:assignAllowed?["wms.tasks.assign"]:[]}
      : {id:9,activo:1,perfil:"operador_rf",permisos:["wms.tasks.execute",...(pickAllowed?["rf.pick"]:[])]}]];
    if(sql.includes("FROM tareas_almacen")) return [[{id:11,tipo:"PICKING",estado:pending?"PENDIENTE":"COMPLETADA"}]];
    assert(sql.startsWith("UPDATE tareas_almacen SET asignado_a"));
    writes.push(params);return [{affectedRows:1}];
  }};
}
test("asignar dentro de una operación mantiene autorización y capacidad RF", async()=>{
  const conn=assignmentConnection();
  const operator=await assignTaskRecord(conn,{taskId:11,operatorId:9,userId:1});
  assert.equal(operator.id,9);assert.deepEqual(conn.writes,[[9,11]]);
  for(const settings of [{assignAllowed:false},{pickAllowed:false},{pending:false}]) {
    const denied=assignmentConnection(settings);
    await assert.rejects(assignTaskRecord(denied,{taskId:11,operatorId:9,userId:1}));
    assert.equal(denied.writes.length,0);
  }
});

test("la red consulta documentos existentes y declara que no tiene telemetría",async()=>{
  const previousQuery=Network.query, previousOne=Network.one;
  const queries=[];
  try {
    Network.query=async sql=>{queries.push(sql);return []};
    Network.one=async sql=>{queries.push(sql);return {units:"12",pendingTasks:"2",readyOrders:null}};
    const result=await Network.snapshot();
    assert.deepEqual(result.simulation,{schematic:true,telemetry:false});
    assert.equal(result.stats.units,12);assert.equal(result.stats.readyOrders,0);
    assert.equal(result.orders.length,0);assert.equal(result.branches.length,0);
    assert(queries.every(sql=>sql.trim().startsWith("SELECT")));
    assert(!JSON.stringify(result).includes("entregado_en"));
  }finally{Network.query=previousQuery;Network.one=previousOne}
});

test("crear y asignar comparten la transacción; planificar no inventa ejecución",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../services/wmsService.js"),"utf8");
  const method=source.match(/async function createWarehouseTask[\s\S]*?async function suggestPutawayDestination/)[0];
  assert.match(method,/return transaction/);assert.match(method,/await createTaskRecord/);assert.match(method,/await assignTaskRecord/);
  assert.doesNotMatch(method,/COMPLETADA|completeWarehouseTask/);
});
