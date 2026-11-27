"use strict";
const { problem }=require('./validation');
const { limaDate }=require('./time');
const clean=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';
function money(v,label){if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>10000000||Math.abs(v*100-Math.round(v*100))>1e-6)problem(`${label}: utiliza un importe positivo con hasta dos decimales.`,422);return Math.round(v*100);}
function financeCommand(s,type,p,actor,{id,event}){
  s.finance ||= {bills:[],payments:[]};
  if(type==='finance.bill.create' && s.commercialInvoiceVersion>=2) problem('Las facturas se reciben automáticamente al comprar al proveedor.',409);
  if(type==='finance.bill.create'){
    const purchase=s.purchases.find(r=>r.id===p.purchaseId);
    if(!purchase||!['RECEIVED','PARTIAL'].includes(purchase.state))problem('La factura requiere una recepción registrada.',409);
    const reference=clean(p.reference,40),date=clean(p.date,10),dueDate=clean(p.dueDate,10);
    if(!/^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/.test(reference))problem('Indica la serie y número del comprobante del proveedor.',422);
    const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
    if(!validDate(date)||!validDate(dueDate)||date>limaDate(s.clock.now)||dueDate<date)problem('Revisa fecha de emisión y vencimiento.',422);
    if(s.finance.bills.some(r=>r.supplierId===purchase.supplierId&&r.reference.toUpperCase()===reference.toUpperCase()))problem('Ese comprobante ya está registrado para el proveedor.',409);
    if(s.finance.bills.some(r=>r.purchaseId===purchase.id))problem('Esta compra ya tiene un comprobante vinculado.',409);
    const subtotal=money(p.subtotal,'Subtotal'),tax=Number(p.tax||0);
    if(!Number.isFinite(tax)||tax<0||tax>p.subtotal||Math.abs(tax*100-Math.round(tax*100))>1e-6)problem('El impuesto debe ser un importe válido y no superar el subtotal.',422);
    const bill={id:id(s,'DOC'),purchaseId:purchase.id,supplierId:purchase.supplierId,reference,date,dueDate,subtotalCents:subtotal,taxCents:Math.round(tax*100),totalCents:subtotal+Math.round(tax*100),currency:'PEN',createdAt:s.clock.now,createdBy:actor.id,receivedCases:purchase.lines.reduce((n,l)=>n+l.receivedCases,0)};
    s.finance.bills.push(bill);event(s,'SUPPLIER_BILL_REGISTERED',`${reference}: comprobante de proveedor vinculado a ${purchase.id}.`,{documentId:bill.id,actorId:actor.id});return {id:bill.id};
  }
  if(type==='finance.payment.create'){
    const bill=s.finance.bills.find(r=>r.id===p.billId);if(!bill)problem('Comprobante inexistente.',404);if(bill.cancelledAt)problem('Una factura anulada no admite pagos.',409);
    const amountCents=money(p.amount,'Pago'),reference=clean(p.reference),method=clean(p.method);
    if(!['TRANSFER','CARD','CASH'].includes(method)||reference.length<5)problem('Selecciona un medio e identifica la operación de pago.',422);
    if(s.finance.payments.some(r=>r.reference.toUpperCase()===reference.toUpperCase()))problem('El número de operación ya fue registrado.',409);
    const paid=s.finance.payments.filter(r=>r.billId===bill.id).reduce((n,r)=>n+r.amountCents,0);
    const credited=(s.finance.creditNotes||[]).filter(c=>c.billId===bill.id).reduce((n,c)=>n+c.amountCents,0);
    if(amountCents>bill.totalCents-paid-credited)problem('El pago supera el saldo pendiente.',409);
    const payment={id:id(s,'PAG'),billId:bill.id,amountCents,reference,method,at:s.clock.now,actorId:actor.id};s.finance.payments.push(payment);
    event(s,'SUPPLIER_PAYMENT_RECORDED',`${bill.reference}: pago registrado por S/ ${(amountCents/100).toFixed(2)}.`,{documentId:bill.id,paymentId:payment.id,actorId:actor.id});return {id:payment.id};
  }
  problem('Acción financiera desconocida.',404);
}
function financeReadModel(s,actor){
 const finance=s.finance||{bills:[],payments:[]};
 const bills=actor.role==='store'?[]:finance.bills.map(b=>{const payments=finance.payments.filter(p=>p.billId===b.id),paidCents=payments.reduce((n,p)=>n+p.amountCents,0);const creditNotes=(finance.creditNotes||[]).filter(c=>c.billId===b.id),creditedCents=creditNotes.reduce((n,c)=>n+c.amountCents,0);return {...b,creditNotes,creditedCents,supplierReceivableCents:Math.max(0,paidCents+creditedCents-b.totalCents),lines:b.lines || (s.purchases.find(p=>p.id===b.purchaseId)?.lines||[]).map(l=>({skuId:l.skuId,cases:l.cases,receivedCases:l.receivedCases})),payments,paidCents,balanceCents:b.cancelledAt?0:Math.max(0,b.totalCents-paidCents-creditedCents),pdfUrl:b.automatic?`/api/finance/bills/${encodeURIComponent(b.id)}.pdf`:null,status:b.cancelledAt?'CANCELLED':paidCents+creditedCents>=b.totalCents?'PAID':paidCents?'PARTIAL':b.dueDate<limaDate(s.clock.now)?'OVERDUE':'PENDING'};});
 const transfers=s.orders.filter(o=>actor.role!=='store'||o.branchId===actor.branchId).map(o=>({id:`TR-${o.id}`,orderId:o.id,branchId:o.branchId,at:o.createdAt,status:o.state,lines:o.lines.map(l=>({skuId:l.skuId,cases:l.cases,receivedCases:l.receivedCases||0})),kind:'INTERNAL_TRANSFER',paymentRequired:false}));
 return {currency:'PEN',bills,transfers,canManage:actor.role==='admin'};
}
module.exports={financeCommand,financeReadModel};
