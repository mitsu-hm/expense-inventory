import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Decimal } from 'decimal.js';
import { fixture } from './helpers.js';

test('daily weekly monthly reports and XLSX use identical full filtered paid records',async()=>{
 const {app,request}=await fixture();try{
  let expected=new Decimal(0);
  for(let i=0;i<26;i++){
   const method=i===25?'Cash':'UPI',value=i===25?'0.20':'0.10';
   const saved=await request('POST','/api/expenses',{paymentDate:'2026-11-05',description:i===0?'=NOT_A_FORMULA()':'Report fixture '+i,amount:value,method,requestKey:'report-'+i,transactionRef:'REF-'+i,taxRate:'18'});assert.equal(saved.statusCode,201,saved.body);
   if(method==='UPI')expected=expected.plus(value);
  }
  await request('POST','/api/expenses',{paymentDate:'2026-10-31',description:'Historical October record',amount:'999.00',method:'UPI',requestKey:'october'});
  const query='space=real&period=monthly&date=2026-11-05&method=UPI';
  const response=await request('GET','/api/reports?'+query);assert.equal(response.statusCode,200,response.body);
  const report=response.json();assert.equal(report.from,'2026-11-01');assert.equal(report.to,'2026-11-30');assert.equal(report.count,25);assert.equal(report.total,expected.toFixed(2));
  for(const key of ['previousTotal','difference','percentageChange','direction','comparisonFrom','comparisonTo'])assert.equal(key in report,false);
  const daily=(await request('GET','/api/reports?period=daily&date=2026-11-05&method=UPI')).json();assert.equal(daily.total,report.total);assert.equal(daily.from,daily.to);
  const weekly=(await request('GET','/api/reports?period=weekly&date=2026-11-05&method=UPI')).json();assert.equal(weekly.from,'2026-11-02');assert.equal(weekly.to,'2026-11-08');assert.equal(weekly.total,report.total);
  const narrowed=(await request('GET','/api/reports?period=monthly&date=2026-11-05&from=2026-11-06&method=UPI')).json();assert.equal(narrowed.count,0);assert.equal(narrowed.total,'0.00');
  const exported=await request('GET','/api/reports/export?'+query);assert.equal(exported.statusCode,200,exported.body.slice(0,100));
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(exported.rawPayload as any);
  assert.deepEqual(workbook.worksheets.map(w=>w.name),['Summary','Expenses','Inventory','Suppliers']);
  const sheet=workbook.getWorksheet('Expenses')!;assert.equal(sheet.rowCount,27);assert.equal(sheet.getRow(2).getCell(2).type,ExcelJS.ValueType.String);
  const total=sheet.getRow(sheet.rowCount).getCell(3);assert.equal(new Decimal(total.result as number).toFixed(2),report.total);
  const summary=workbook.getWorksheet('Summary')!;let summaryTotal:any;
  summary.eachRow(row=>{if(row.getCell(1).value==='Total recorded expenses')summaryTotal=row.getCell(2).value;});
  assert.equal(new Decimal(summaryTotal).toFixed(2),report.total);
  assert.equal(sheet.getRow(2).getCell(7).value,18);
  assert.equal((await request('GET','/api/expenses?from=2026-10-31&to=2026-10-31')).json().count,1);
  assert.equal((await request('GET','/api/reports?period=monthly&date=2026-11-05&from=2026-11-20&to=2026-11-01')).statusCode,400);
 }finally{await app.close();}
});
