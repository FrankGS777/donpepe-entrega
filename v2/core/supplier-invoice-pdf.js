"use strict";
const PDFDocument=require('pdfkit');
const path=require('node:path'),fs=require('node:fs');
const ROOT=path.resolve(__dirname,'../..');
const GOLD='#B48A3C',INK='#20242A',MUTED='#67707A',LINE='#E1E4E7';
const cash=c=>`S/ ${(c/100).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const date=v=>new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Lima'}).format(new Date(`${v}T12:00:00-05:00`));
function supplierInvoicePDF(bill){return new Promise((resolve,reject)=>{
 const d=new PDFDocument({size:'A4',margin:36,bufferPages:true,info:{Title:`Factura ${bill.reference} - ${bill.issuer.name}`,Author:bill.issuer.legalName,Subject:`Pedido de compra ${bill.purchaseId}`}}),chunks=[];
 d.on('data',chunk=>chunks.push(chunk));d.on('error',reject);d.on('end',()=>resolve(Buffer.concat(chunks)));
 const regular=path.join(ROOT,'public/fonts/geist-regular.ttf'),bold=path.join(ROOT,'public/fonts/geist-semibold.ttf');
 d.registerFont('Body',regular).registerFont('Bold',bold).font('Body');
 const text=(value,x,y,w=520,size=9,color=INK,bold=false,align='left')=>d.font(bold?'Bold':'Body').fontSize(size).fillColor(color).text(String(value??''),x,y,{width:w,align,lineGap:2});
 const rule=y=>d.moveTo(36,y).lineTo(559,y).strokeColor(LINE).lineWidth(.6).stroke();
 function brand(){d.rect(0,0,595,8).fill(GOLD);d.roundedRect(36,27,523,65,8).fill('#14191E');const logo=path.join(ROOT,'public/images/donpepe-logo-final-gold.png');if(fs.existsSync(logo))d.image(logo,51,36,{fit:[145,47],align:'left',valign:'center'});else text('DONPEPE',51,43,170,24,'#E6BE70',true);text('ABASTECIMIENTO DEL CENTRO',322,42,220,9,'#E6BE70',true,'right');text(`Pedido ${bill.purchaseId}`,322,60,220,10,'#FFFFFF',false,'right');}
 brand();
 text(bill.issuer.legalName,36,116,310,17,INK,true);let y=116+d.heightOfString(bill.issuer.legalName,{width:310})+8;
 // The supplier is the issuer. DonPepe branding identifies the purchasing portal.
 text(`Emisor · ${bill.issuer.taxId?`RUC ${bill.issuer.taxId}`:`Código comercial ${bill.issuer.code}`}`,36,y,310,9,MUTED);y+=18;
 text(bill.issuer.address,36,y,310,9,MUTED);y+=d.heightOfString(bill.issuer.address,{width:310})+5;
 const contact=[bill.issuer.email,bill.issuer.phone].filter(Boolean).join(' · ');if(contact){text(contact,36,y,310,8,MUTED);y+=25;}
 d.roundedRect(371,112,188,86,6).lineWidth(1).strokeColor(GOLD).stroke();text('FACTURA DE PROVEEDOR',381,126,168,10,INK,true,'center');text(bill.reference,381,149,168,16,GOLD,true,'center');text(bill.cancelledAt?'ANULADA':'Moneda: soles (PEN)',381,176,168,9,MUTED,false,'center');
 y=Math.max(y+12,216);
 d.roundedRect(36,y,523,98,6).fill('#F5F5F2');
 text('CLIENTE / ADQUIRENTE',49,y+12,300,8,GOLD,true);text(bill.buyer.legalName,49,y+29,308,12,INK,true);text(bill.buyer.address,49,y+48,300,9,MUTED);text(bill.buyer.taxId?`RUC ${bill.buyer.taxId}`:`Identificación ${bill.buyer.id}`,49,y+76,300,8,MUTED);
 text('EMISIÓN',375,y+12,170,8,MUTED,true);text(date(bill.date),375,y+25,170,10,INK,true);text('VENCIMIENTO',375,y+46,170,8,MUTED,true);text(date(bill.dueDate),375,y+60,170,10,INK,true);
 y+=116;text(`Condición: ${bill.paymentTermDays===0?'contado':`crédito a ${bill.paymentTermDays} días`}    ·    Orden de compra: ${bill.purchaseId}`,36,y,523,9,MUTED);y+=25;
 const header=()=>{d.roundedRect(36,y,523,29,4).fill('#20272D');text('PRODUCTO / PRESENTACIÓN',45,y+9,237,8,'#FFFFFF',true);text('CAJAS',290,y+9,44,8,'#FFFFFF',true,'right');text('V. CAJA',346,y+9,85,8,'#FFFFFF',true,'right');text('IMPORTE',450,y+9,98,8,'#FFFFFF',true,'right');y+=39;};
 header();
 for(const line of bill.lines){
  d.font('Bold').fontSize(9);const h=Math.max(52,d.heightOfString(line.name,{width:237})+34);
  if(y+h>710){d.addPage();brand();y=118;text(`${bill.issuer.name} · ${bill.reference} · Continuación`,36,y,523,10,INK,true);y+=25;header();}
  text(line.name,45,y,237,9,INK,true);const nameHeight=d.heightOfString(line.name,{width:237});text(`${line.code} · ${line.unitsPerCase} unidades por caja`,45,y+nameHeight+5,237,8,MUTED);
  text(line.cases,290,y+1,44,10,INK,true,'right');text(cash(line.caseUnitNetCents),346,y+1,85,9,INK,false,'right');text(cash(line.netCents),450,y+1,98,9,INK,true,'right');y+=h;rule(y-10);
 }
 if(y+180>745){d.addPage();brand();y=122;}
 const summaryY=y+8;const labelX=345,valueX=460;
 text('Operación gravada / base',labelX,summaryY,112,9,MUTED);text(cash(bill.subtotalCents),valueX,summaryY,90,10,INK,false,'right');
 text('IGV',labelX,summaryY+23,112,9,MUTED);text(cash(bill.taxCents),valueX,summaryY+23,90,10,INK,false,'right');
 d.roundedRect(331,summaryY+45,228,40,5).fill('#20272D');text('TOTAL',345,summaryY+58,105,10,'#E6BE70',true);text(cash(bill.totalCents),450,summaryY+56,98,14,'#FFFFFF',true,'right');
 text('DETALLE COMERCIAL',36,summaryY+7,270,8,GOLD,true);text(`${bill.lines.reduce((n,l)=>n+l.cases,0)} cajas · ${bill.lines.reduce((n,l)=>n+l.cases*l.unitsPerCase,0)} unidades\nValores de caja sin IGV. Impuesto calculado por línea.\nEntrega en el centro de distribución DonPepe.`,36,summaryY+25,275,9,MUTED);
 y=summaryY+108;rule(y);text('DOCUMENTO RECIBIDO DEL PROVEEDOR',36,y+12,523,8,INK,true);text('Generado por el proveedor simulado con las tarifas del catálogo. Sin validez tributaria ni envío a SUNAT.',36,y+29,523,7.5,MUTED);
 text(`Integridad documental: ${bill.documentHash.slice(0,32)}`,36,y+45,523,7,MUTED);
 const range=d.bufferedPageRange();for(let i=0;i<range.count;i++){d.switchToPage(i);text(`${bill.reference} · ${bill.purchaseId}`,36,790,350,7,MUTED);text(`${i+1} / ${range.count}`,483,790,76,7,MUTED,false,'right');}
 d.end();
 });}
module.exports={supplierInvoicePDF};
