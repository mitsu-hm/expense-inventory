import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Decimal } from 'decimal.js';
import { fixture } from '../tests/helpers.js';

// Opt-in local inference benchmark: synthetic image and isolated database only.
assert.equal(process.env.AI_PROVIDER,'ollama');assert.equal(process.env.AI_LOCAL_ONLY,'1');
const rows=[{name:'Audit Vanilla Drink',hsn:'04029920',quantity:'48',price:'137.50',tax:'5'},{name:'Audit Chocolate Drink',hsn:'22029920',quantity:'24',price:'300.00',tax:'5'}];
const gross=(r:typeof rows[number])=>new Decimal(r.quantity).times(r.price).times(new Decimal(r.tax).div(100).plus(1)).toFixed(2);
const total=rows.reduce((n,r)=>n.plus(gross(r)),new Decimal(0)).toFixed(2);
const lines=['SYNTHETIC TEST INVOICE - NOT A REAL TRANSACTION','Supplier: Audit Wholesale','Invoice No: AUDIT-INV-2026-001','Invoice date: 2026-11-07','Payment status: UNPAID','Description                 HSN        Qty    Unit price   GST    Line total',...rows.map(r=>`${r.name.padEnd(28)}${r.hsn.padEnd(11)}${r.quantity.padEnd(7)}${r.price.padEnd(13)}${(r.tax+'%').padEnd(7)}${gross(r)}`),`Total pieces: ${rows.reduce((n,r)=>n.plus(r.quantity),new Decimal(0))}`,`Grand total: INR ${total}`,'Accepted methods: UPI, Visa, cash. No payment has been recorded.'];
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="760"><rect width="1500" height="760" fill="white"/>${lines.map((line,i)=>`<text xml:space="preserve" x="32" y="${55+i*58}" font-family="monospace" font-size="25" fill="black">${line}</text>`).join('')}</svg>`;
await mkdir('artifacts/fixes',{recursive:true});const image=await sharp(Buffer.from(svg)).png().toBuffer();await writeFile('artifacts/fixes/synthetic-item-invoice.png',image);
const {app,request}=await fixture();const evidence:Record<string,unknown>={model:process.env.AI_MODEL,expected:{amount:total,rows},passed:false};
try{
 const uploaded=await request('POST','/api/documents',{name:'synthetic-item-invoice.png',mimeType:'image/png',base64:image.toString('base64'),kind:'bill'});assert.equal(uploaded.statusCode,201,uploaded.body);const doc=uploaded.json();
 const start=performance.now(),response=await request('POST',`/api/documents/${doc.id}/scan`,{version:doc.version});evidence.elapsedMs=Math.round(performance.now()-start);assert.equal(response.statusCode,200,response.body);const record=response.json();evidence.actual=record.draft;evidence.warnings=record.warnings;
 assert.equal(record.draft.amount,total);assert.equal(record.draft.paymentDate,null);assert.equal(record.draft.method,null);assert.equal(record.draft.transactionRef,'AUDIT-INV-2026-001');assert.equal(record.draft.lines.length,rows.length);
 rows.forEach((row,i)=>{assert.equal(new Decimal(record.draft.lines[i].quantity).toString(),row.quantity);assert.ok(new Decimal(record.draft.lines[i].unitPrice).eq(row.price));assert.ok(new Decimal(record.draft.lines[i].taxRate).eq(row.tax));});
 assert.equal((await request('GET',`/api/documents/${doc.id}`)).json().draft.amount,total);assert.equal((await request('GET','/api/expenses')).json().count,0);assert.equal((await request('GET','/api/inventory')).json().purchases.length,0);evidence.passed=true;
}catch(error){evidence.error=error instanceof Error?error.message:String(error);process.exitCode=1;}finally{await app.close();await writeFile('artifacts/fixes/item-invoice-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
