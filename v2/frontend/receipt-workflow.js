import { addLimaDays } from "./time.js";

export function createReceiptWorkflow(ctx) {
  const {getState,showDialog,command,render,esc,photo,formIssue,sku,supplier,num,dialog}=ctx;
  const $=selector=>dialog.querySelector(selector);
  function open(id) {
    const state=getState(),purchase=state.purchases.find(p=>p.id===id);
    if(!purchase)return;
    const read=state.purchaseReadModels?.find(p=>p.purchaseId===id);
    const pending=purchase.lines.filter(l=>l.cases>(l.receivedCases||0));
    const revision=purchase.revision || read?.revision || 1;
    const previous=state.inspections?.find(inspection=>inspection.id===purchase.inspectionId&&inspection.purchaseId===id&&inspection.state==='RECORDED'&&inspection.purchaseRevision===revision);
    const vendor=supplier(purchase.supplierId);
    showDialog("Inspeccionar recepción",`<form id="receipt-form"><div class="receipt-stepper"><span class="active">1 · Identificar y revisar</span><span>2 · Confirmar entrada</span><span>3 · Almacenamiento automático</span></div><div class="document-context-entity">${photo(vendor,"",true)}<div><strong>${esc(vendor.name)}</strong><small>${esc(purchase.code || id)} · ${pending.length} productos pendientes</small></div></div><div class="notice">La orden precarga lo esperado, no lo recibido. Verifica la etiqueta, el lote, la cantidad y las condiciones. Registrar la inspección todavía no crea existencias.</div><div class="form-grid"><label>Documento de entrega<input name="documentNumber" required minlength="3" maxlength="80" placeholder="Guía / remisión del proveedor"></label><label>Origen de la comprobación<select name="mode"><option value="MANUAL">Revisión registrada por responsable</option><option value="SIMULATED">Inspección de simulación</option></select></label></div><button type="button" class="btn secondary small" id="receipt-simulate">Preparar ejemplo de inspección simulada</button><div class="receipt-lines">${pending.map((l,i)=>{
      const s=sku(l.skuId),left=l.cases-(l.receivedCases||0),cold=['COLD','FROZEN'].includes(s.zoneId),range=read?.pendingLines?.find(x=>x.lineId===l.id);
      return `<section class="receipt-inspection-line" data-receipt-line="${i}"><div class="receipt-product-heading">${photo(s)}<div><h3>${esc(s.name)}</h3><small>${esc(s.presentation || '')} · ${num(s.unitsPerCase)} unidades / caja</small><small><b>${num(left)} cajas pendientes</b> · ${cold ? s.zoneId==='FROZEN'?'Congelado':'Refrigerado':'Ambiente'}</small></div></div><div class="form-grid"><label>Código leído de la mercancía<input name="barcode-${i}" inputmode="${s.barcode?'numeric':'text'}" required maxlength="40" placeholder="GTIN / código de la etiqueta" autocomplete="off"></label><label>Lote del fabricante / proveedor<input name="lot-${i}" required minlength="1" maxlength="80" placeholder="Exactamente como figura en la etiqueta"></label><label>Vencimiento<input name="expiry-${i}" type="date" ${s.expiryControlled?'required':''}></label><label>${cold ? `Temperatura medida (${range?.temperatureMin ?? (s.zoneId==='COLD'?2:-35)} a ${range?.temperatureMax ?? (s.zoneId==='COLD'?6:-18)} °C)` : 'Temperatura medida (opcional)'}<input name="temperatureC-${i}" type="number" step="0.1" min="-50" max="80" ${cold?'required':''}></label><label>Cajas aceptadas<input name="accepted-${i}" type="number" min="0" max="${left}" step="1" value="${left}" required></label><label>Cajas a cuarentena<input name="quarantine-${i}" type="number" min="0" max="${left}" step="1" value="0" required></label><label>Estado del embalaje<select name="packaging-${i}" required><option value="">Seleccionar comprobación</option><option value="OK">Íntegro / conforme</option><option value="DAMAGED">Dañado / observado</option></select></label><label>Identificación y etiqueta<select name="label-${i}" required><option value="">Seleccionar comprobación</option><option value="OK">Identificación completa</option><option value="MISSING">Etiqueta incompleta / faltante</option></select></label></div><label>Motivo de retención / observaciones<textarea name="reason-${i}" maxlength="500" rows="2" placeholder="Obligatorio si retienes mercancía"></textarea></label><button type="button" class="btn secondary small" data-hold-receipt="${i}">Enviar esta cantidad a cuarentena</button><div class="receipt-line-result" id="receipt-line-result-${i}" aria-live="polite"></div></section>`;
    }).join('')}</div><label>Observaciones de la inspección<textarea name="notes" maxlength="1000" rows="2" placeholder="Información útil para la trazabilidad"></textarea></label><label class="form-check"><input name="confirmed" type="checkbox" required>Confirmo las cantidades y el origen de los datos registrados.</label><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Volver</button><button class="btn primary">Registrar y revisar inspección →</button></div></form>`,"RECEPCIÓN · IDENTIFICACIÓN Y CALIDAD");
    const form=$("#receipt-form");
    if(previous){
      form.elements.documentNumber.value=previous.documentNumber || '';
      form.elements.mode.value=previous.mode || 'MANUAL';
      form.elements.notes.value=previous.notes || '';
      pending.forEach((line,i)=>{
        const saved=previous.lines.find(item=>item.lineId===line.id);
        const values={barcode:saved?.barcode,lot:saved?.supplierLot || saved?.lot,expiry:saved?.expiry,temperatureC:saved?.temperatureC,accepted:saved?.acceptedCases ?? 0,quarantine:saved?.quarantineCases ?? 0,packaging:saved?.packaging,label:saved?.label,reason:saved?.reason};
        for(const [field,value]of Object.entries(values))form.elements[`${field}-${i}`].value=value??'';
      });
      // Reviewing a saved inspection never silently reconfirms its declaration.
      form.elements.confirmed.checked=false;
    }
    function updateLine(i) {
      const a=Number(form.elements[`accepted-${i}`].value),q=Number(form.elements[`quarantine-${i}`].value),left=pending[i].cases-(pending[i].receivedCases||0);
      const receiving=a+q>0;
      for(const field of ['barcode','lot','packaging','label'])form.elements[`${field}-${i}`].required=receiving;
      form.elements[`expiry-${i}`].required=receiving&&!!sku(pending[i].skuId).expiryControlled;
      form.elements[`temperatureC-${i}`].required=receiving&&['COLD','FROZEN'].includes(sku(pending[i].skuId).zoneId);
      form.elements[`reason-${i}`].required=q>0;form.elements[`reason-${i}`].minLength=q>0?10:0;
      $(`#receipt-line-result-${i}`).textContent=`${num(a)} aceptadas · ${num(q)} en cuarentena · ${num(Math.max(0,left-a-q))} pendientes para otra entrega`;
    }
    pending.forEach((_,i)=>updateLine(i));
    form.addEventListener('input',()=>pending.forEach((_,i)=>updateLine(i)));
    form.addEventListener('click',event=>{const button=event.target.closest('[data-hold-receipt]');if(!button)return;const i=Number(button.dataset.holdReceipt),total=Number(form.elements[`accepted-${i}`].value)+Number(form.elements[`quarantine-${i}`].value);form.elements[`accepted-${i}`].value='0';form.elements[`quarantine-${i}`].value=String(total);updateLine(i);form.elements[`reason-${i}`].focus();});
    $("#receipt-simulate").onclick=()=>{
      form.elements.mode.value='SIMULATED';form.elements.documentNumber.value=`SIM-${purchase.code || id}`;
      pending.forEach((l,i)=>{const s=sku(l.skuId),range=read?.pendingLines?.find(x=>x.lineId===l.id);form.elements[`barcode-${i}`].value=s.barcode || s.code || '';form.elements[`lot-${i}`].value=`SIM-${purchase.code || id}-${i+1}`;if(s.expiryControlled)form.elements[`expiry-${i}`].value=addLimaDays(state.clock.now,s.zoneId==='COLD'?21:180);if(['COLD','FROZEN'].includes(s.zoneId))form.elements[`temperatureC-${i}`].value=String(((range?.temperatureMin ?? (s.zoneId==='COLD'?2:-35))+(range?.temperatureMax ?? (s.zoneId==='COLD'?6:-18)))/2);form.elements[`packaging-${i}`].value='OK';form.elements[`label-${i}`].value='OK';updateLine(i);});
      form.elements.notes.value='Ejemplo generado por el simulador; no equivale a una medición física ni a una inspección sanitaria real.';
      form.dispatchEvent(new Event('input',{bubbles:true}));
    };
    form.onsubmit=async event=>{
      event.preventDefault();const problems={};
      const lines=pending.map((l,i)=>{const a=Number(form.elements[`accepted-${i}`].value),q=Number(form.elements[`quarantine-${i}`].value),temp=form.elements[`temperatureC-${i}`].value; if(a+q>l.cases-(l.receivedCases||0)){problems[`accepted-${i}`]='Aceptadas y retenidas superan las cajas pendientes.';problems[`quarantine-${i}`]='Corrige el total de esta entrega.';}return {lineId:l.id,barcode:form.elements[`barcode-${i}`].value.trim(),lot:form.elements[`lot-${i}`].value.trim(),expiry:form.elements[`expiry-${i}`].value||null,acceptedCases:a,quarantineCases:q,...(temp!==''?{temperatureC:Number(temp)}:{}),packaging:form.elements[`packaging-${i}`].value,label:form.elements[`label-${i}`].value,qualityDecision:a&&q?'PARTIAL_HOLD':q?'HOLD':'ACCEPT',reason:form.elements[`reason-${i}`].value.trim()};}).filter(l=>l.acceptedCases+l.quarantineCases>0);
      if(!lines.length){formIssue(form,'Indica al menos una caja recibida.');return;}
      if(Object.keys(problems).length){formIssue(form,'Revisa las cantidades antes de registrar la inspección.',problems);return;}
      const submittedIndexes=pending.map((l,i)=>Number(form.elements[`accepted-${i}`].value)+Number(form.elements[`quarantine-${i}`].value)>0?i:-1).filter(i=>i>=0);
      try{const result=await command('purchase.inspect',{id,expectedPurchaseRevision:revision,documentNumber:form.elements.documentNumber.value,mode:form.elements.mode.value,notes:form.elements.notes.value,lines},'Inspección registrada. Aún no se ha añadido inventario.');review(id,result.inspectionId);}catch(error){const fields={};for(const [key,message]of Object.entries(error.fieldErrors||{})){const match=/^lines\.(\d+)\.(.+)$/.exec(key);const field=match?`${({acceptedCases:'accepted',quarantineCases:'quarantine'}[match[2]]||match[2])}-${submittedIndexes[Number(match[1])]??match[1]}`:key;fields[field]=message;}formIssue(form,error.message,fields);}
    };
  }
  function review(id,inspectionId) {
    const state=getState(),purchase=state.purchases.find(x=>x.id===id),inspection=state.inspections?.find(x=>x.id===inspectionId);
    if(!purchase||!inspection){formIssue($("#receipt-form"),'No se pudo recuperar la inspección. Reabre la recepción antes de confirmar.');return;}
    showDialog("Confirmar entrada inspeccionada",`<div class="receipt-stepper"><span>1 · Inspección registrada ✓</span><span class="active">2 · Confirmar entrada</span><span>3 · Almacenamiento automático</span></div><div class="notice ${inspection.simulated?'warning':''}"><strong>${inspection.simulated?'Inspección de simulación':'Revisión registrada por responsable'}</strong><p>${esc(inspection.documentNumber)} · ${esc(inspection.id)}</p></div><div class="receipt-review-lines">${inspection.lines.map(l=>`<article class="receipt-review-line">${photo(sku(l.skuId))}<div><h3>${esc(sku(l.skuId).name)}</h3><p>Lote del proveedor: <strong>${esc(l.supplierLot || l.lot)}</strong></p><small>Vencimiento: ${esc(l.expiry || 'No aplica')}${l.temperatureC!=null?` · ${num(l.temperatureC)} °C`:''}</small><div class="receipt-review-totals"><span><b>${num(l.acceptedCases)}</b> cajas aceptadas</span><span><b>${num(l.quarantineCases)}</b> en cuarentena</span></div>${l.reason?`<p>${esc(l.reason)}</p>`:''}</div></article>`).join('')}</div><div class="notice">El lote del proveedor no se reemplaza. Al confirmar se crean identificaciones internas de carga y movimientos de almacenamiento sólo para lo aceptado. Lo retenido permanece en cuarentena.</div><div class="dialog-actions"><button type="button" class="btn secondary" id="receipt-back">Modificar inspección</button><button type="button" class="btn primary" id="receipt-commit">Confirmar entrada y planificar movimientos</button></div>`,"RECEPCIÓN · CONFIRMACIÓN TRAZABLE");
    $("#receipt-back").onclick=()=>open(id);
    $("#receipt-commit").onclick=async()=>{try{await command('purchase.receive',{id,inspectionId,expectedPurchaseRevision:purchase.revision},'Entrada confirmada. Las cargas y sus movimientos conservan el lote original.');dialog.close();render();}catch(error){const box=document.createElement('div');box.className='form-error';box.setAttribute('role','alert');box.textContent=error.message;$("#receipt-commit").closest('.dialog-actions').before(box);}};
  }
  return {open};
}
