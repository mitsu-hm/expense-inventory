import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceText, extractImage } from '../server/ai.js';
import { Store } from '../server/store.js';

test('OCR prefers grand total with thousands separators and does not turn accepted methods or bill dates into payment',()=>{
 const extracted=parseInvoiceText('AUDIT WHOLESALE\nInvoice No: INV-2026-8849\nDate: 2026-11-02\nSUBTOTAL: 1,000.00\nTAX: 180.00\nGRAND TOTAL: INR 1,180.00\nAccepted methods: UPI, Visa and cash','bill');
 assert.equal(extracted.amount,'1180.00');assert.equal(extracted.paymentDate,null);assert.equal(extracted.orderedDate,'2026-11-02');assert.equal(extracted.method,null);assert.equal(extracted.transactionRef,'INV-2026-8849');
 const uncertain=parseInvoiceText('AUDIT SHOP\nItem price 1000.00\nContact phone 9999999999','bill');assert.equal(uncertain.amount,null,'unlabelled largest number is not a document total');
 const hsn=parseInvoiceText('AUDIT SHOP\nDescription  HSN  Qty  Price  Tax\nVanilla drink  04029920  48  137.50  5','bill');assert.equal(hsn.lines.length,0,'heuristics must not guess complex table column positions');
});

test('external OCR outage and unreadable images are errors, not successful empty extractions',async()=>{
 const original=globalThis.fetch,old=process.env.AI_LOCAL_ONLY,store=new Store(':memory:');delete process.env.AI_LOCAL_ONLY;
 try{
  for(const response of [()=>{throw new Error('offline');},()=>new Response('{}',{status:503}),()=>new Response(JSON.stringify({ParsedResults:[{ParsedText:''}]})),()=>new Response(JSON.stringify({IsErroredOnProcessing:true,ParsedResults:[{ParsedText:'partial'}]}))]){
   globalThis.fetch=async()=>response();
   await assert.rejects(()=>extractImage(Buffer.from('fixture'),'bill','image/png',store,'audit','real','free'),/OCR|unreadable|failed|unavailable/i);
  }
 }finally{globalThis.fetch=original;if(old===undefined)delete process.env.AI_LOCAL_ONLY;else process.env.AI_LOCAL_ONLY=old;store.close();}
});

test('unambiguous HSN row evidence recovers omitted numeric fields only when its printed arithmetic agrees',async()=>{
 const original=globalThis.fetch,keys=['AI_PROVIDER','AI_MODEL','AI_LOCAL_ONLY'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]])),store=new Store(':memory:');process.env.AI_PROVIDER='ollama';process.env.AI_MODEL='controlled';process.env.AI_LOCAL_ONLY='1';
 const item={description:'Audit drink',productType:null,brand:null,flavour:null,packSize:null,unit:null,quantity:null,unitPrice:null,taxRate:null,evidence:'Audit drink 04029920 48 137.50 5% 6930.00'};
 let lines:object[]=[item];globalThis.fetch=async()=>Response.json({message:{content:JSON.stringify({paymentDate:null,orderedDate:null,description:null,amount:'14490.00',method:null,additionalInformation:'',transactionRef:null,supplierName:null,lines,warnings:[]})}});
 try{
  const result=await extractImage(Buffer.from('fixture'),'bill','image/png',store,'audit','real');assert.equal(result.lines[0].quantity,'48');assert.equal(result.lines[0].unitPrice,'137.50');assert.equal(result.lines[0].taxRate,'5');assert.ok(result.warnings.some(w=>/line evidence/i.test(w)));assert.equal(result.lines[0].packSize,null);
  lines=[{...item,evidence:'Audit drink 04029920 48 137.50 5% 999.00'}];assert.equal((await extractImage(Buffer.from('fixture'),'bill','image/png',store,'audit','real')).lines[0].quantity,null,'do not manufacture values from inconsistent evidence');
  lines=[{...item,quantity:'04029920'}];assert.equal((await extractImage(Buffer.from('fixture'),'bill','image/png',store,'audit','real')).lines[0].unitPrice,null,'do not silently mix contradictory machine fields with recovered values');
 }finally{globalThis.fetch=original;store.close();for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
