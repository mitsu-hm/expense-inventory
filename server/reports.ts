import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ExpenseList, ExpenseReport, Settings } from '../shared/types.js';
import { BRAND } from '../shared/config.js';
import { dateSchema, HttpError, sumAmounts, today } from './domain.js';
import type { Row } from './store.js';
import type { InventoryService } from './inventory.js';
export function periodBounds(period:'daily'|'weekly'|'monthly',date:string,weekStart=1) {
 dateSchema.parse(date);const start=new Date(date+'T00:00:00Z'),end=new Date(start);
 if(period==='weekly'){start.setUTCDate(start.getUTCDate()-(start.getUTCDay()-weekStart+7)%7);end.setTime(start.getTime());end.setUTCDate(end.getUTCDate()+6);}
 if(period==='monthly'){start.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+1,0);}
 return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
}
interface Context { actor:(r:any)=>Row;space:(r:any)=>string;settings:(u:Row)=>Settings;now:()=>number;inventory:InventoryService;listExpenses:(u:Row,s:string,q:any)=>ExpenseList }
export function registerReports(app:FastifyInstance,ctx:Context) {
 const select=(request:any):ExpenseReport=>{
  const user=ctx.actor(request),settings=ctx.settings(user),query=request.query;
  const period=z.enum(['daily','weekly','monthly']).parse(query.period??'monthly');
  const date=dateSchema.parse(query.date??today(settings.timezone,ctx.now()));
  const bounds=periodBounds(period,date,settings.weekStartsOn);
  const requestedFrom=query.from?dateSchema.parse(query.from):bounds.from;
  const requestedTo=query.to?dateSchema.parse(query.to):bounds.to;
  const from=requestedFrom>bounds.from?requestedFrom:bounds.from,to=requestedTo<bounds.to?requestedTo:bounds.to;
  if(requestedFrom>requestedTo||from>to)throw new HttpError(400,'The date filters must overlap the selected reporting period, with start on or before end.');
  const method=query.method?z.enum(['Cash','UPI','Card']).parse(query.method):'';
  const q=z.string().max(200).parse(query.q??'');
  const data=ctx.listExpenses(user,ctx.space(request),{from,to,method,q});
  const byDay=[];const day=new Date(from+'T00:00:00Z');
  while(day.toISOString().slice(0,10)<=to){const date=day.toISOString().slice(0,10),records=data.records.filter(r=>r.paymentDate===date);byDay.push({date,total:sumAmounts(records),count:records.length});day.setUTCDate(day.getUTCDate()+1);}
  return {...data,period,date,from,to,periodFrom:bounds.from,periodTo:bounds.to,method,q,currency:settings.currency,timezone:settings.timezone,byDay};
 };
 app.get('/api/reports',async request=>select(request));
 app.get('/api/reports/export',async(request,reply)=>{
  // Read all selected values synchronously before generating the workbook.
  // XLSX and the page share this exact selector; neither uses table pagination.
  const report=select(request),user=ctx.actor(request),space=ctx.space(request);
  if(space==='demo')ctx.inventory.seedDemo(user,ctx.settings(user));
  const products=ctx.inventory.products(user,space),purchases=ctx.inventory.purchases(user,space),suppliers=ctx.inventory.suppliers(user,space);
  const workbook=new ExcelJS.Workbook();workbook.creator=BRAND.name;workbook.created=new Date(ctx.now());
  const summary=workbook.addWorksheet('Summary');
  summary.addRows([
   [BRAND.name+' Expense Report',BRAND.tagline],['Report type',report.period],['Start date',report.from],['End date',report.to],['Payment method',report.method||'All'],['Currency',report.currency],['Timezone',report.timezone],['Total recorded expenses',Number(report.total)],['Matching records',report.count],['Space',space==='demo'?'Fictional demo':'Real records'],['Search filter',report.q||'None'],['Date basis','Payment date'],['Inventory scope','All inventory/suppliers in this space; not filtered by expense payment dates'],['Price and tax policy','Historical unit prices; reference tax rates are preserved, not added again']
  ]);summary.columns=[{width:32},{width:90}];summary.getCell('B8').numFmt='#,##0.00';
  const expenses=workbook.addWorksheet('Expenses');
  expenses.addRow(['Payment date','Description / payee','Amount','Payment method','Additional information','Transaction reference','Tax rate (%)','Linked purchase']);
  report.records.forEach(r=>expenses.addRow([r.paymentDate,r.description,Number(r.amount),r.method,r.additionalInformation,r.transactionRef,r.taxRate===null?null:Number(r.taxRate),r.purchaseId]));
  const totalRow=expenses.addRow(['','Total recorded expenses',report.records.length?{formula:`SUM(C2:C${report.records.length+1})`,result:Number(report.total)}:0]);totalRow.font={bold:true};
  expenses.columns=[{width:16},{width:38},{width:18},{width:20},{width:55},{width:30},{width:18},{width:40}];expenses.getColumn(3).numFmt='#,##0.00';expenses.getColumn(7).numFmt='0.######';
  const inventory=workbook.addWorksheet('Inventory');
  inventory.addRow(['Product ID','Product name','Type','Brand','Flavour','Pack size','Unit','Supplier ID','Supplier','Purchase reference','Ordered quantity','Received quantity','Historical unit price (exact)','Received cost','Ordered line cost','Tax rate (%)']);
  const supplierSheet=workbook.addWorksheet('Suppliers');
  supplierSheet.addRow(['Supplier ID','Supplier name','Contact name','Email','Address','Payment terms','Product ID','Product name','Historical unit price (exact)','Ordered quantity','Received quantity','Received cost']);
  const productMap=new Map(products.map(p=>[p.id,p])),supplierMap=new Map(suppliers.map(s=>[s.id,s]));const listed=new Set<string>();
  purchases.forEach(p=>p.lines.forEach(line=>{
   const product=productMap.get(line.productId)!,supplier=supplierMap.get(p.supplierId)!;listed.add(product.id);
   inventory.addRow([product.id,product.name,product.productType,product.brand,product.flavour,line.packSize,line.unit,supplier.id,supplier.name,p.reference,line.quantity,line.receivedQuantity,line.unitPrice,Number(line.receivedCost),Number(line.lineCost),line.taxRate===null?null:Number(line.taxRate)]);
   supplierSheet.addRow([supplier.id,supplier.name,supplier.contactName,supplier.email,supplier.address,supplier.paymentTerms,product.id,product.name,line.unitPrice,line.quantity,line.receivedQuantity,Number(line.receivedCost)]);
  }));
  for(const p of products.filter(p=>!listed.has(p.id))){
   const s=supplierMap.get(p.supplierId)!;
   inventory.addRow([p.id,p.name,p.productType,p.brand,p.flavour,p.packSize,p.unit,s.id,s.name,'No purchase yet','0','0',p.unitPrice,0,0,null]);
   supplierSheet.addRow([s.id,s.name,s.contactName,s.email,s.address,s.paymentTerms,p.id,p.name,p.unitPrice,'0','0',0]);
  }
  for(const s of suppliers.filter(s=>!s.productCount))supplierSheet.addRow([s.id,s.name,s.contactName,s.email,s.address,s.paymentTerms,'No linked product']);
  inventory.columns=Array.from({length:16},(_,i)=>({width:[1,3,4,6].includes(i)?20:26}));inventory.getColumn(14).numFmt='#,##0.00';inventory.getColumn(15).numFmt='#,##0.00';
  supplierSheet.columns=Array.from({length:12},(_,i)=>({width:[3,4,5].includes(i)?36:26}));supplierSheet.getColumn(12).numFmt='#,##0.00';
  for(const sheet of workbook.worksheets){
   sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF245C48'}};sheet.getRow(1).height=28;
   if(sheet.name!=='Summary')sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount-(sheet.name==='Expenses'?1:0)),column:sheet.columnCount}};
   sheet.eachRow(row=>{row.alignment={vertical:'middle',wrapText:true};});
  }
  reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  reply.header('Content-Disposition',`attachment; filename="ledgersprout-${report.period}-${report.from}-${report.to}.xlsx"`);
  return reply.send(Buffer.from(await workbook.xlsx.writeBuffer()));
 });
}
