import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
test('duplicate payment references cannot double-count and safe retries are idempotent',async()=>{
 const {app,request}=await fixture();
 try {
  const input={paymentDate:'2026-11-01',description:'Fictional paper supplier',amount:'0.10',method:'Cash',additionalInformation:'',transactionRef:'BILL-ONE',requestKey:'save-one',taxRate:'18'};
  const first=await request('POST','/api/expenses',input);assert.equal(first.statusCode,201,first.body);
  const retry=await request('POST','/api/expenses',input);assert.equal(retry.json().id,first.json().id);
  const dup=await request('POST','/api/expenses',{...input,requestKey:'receipt-two',allowDuplicate:true,transactionRef:'bill-one'});
  assert.equal(dup.statusCode,409);assert.equal(dup.json().code,'DUPLICATE');assert.equal(dup.json().candidates[0].id,first.json().id);
  const possible=await request('POST','/api/expenses',{...input,transactionRef:'',requestKey:'repeat'});assert.equal(possible.statusCode,409);
  const legitimate=await request('POST','/api/expenses',{...input,transactionRef:'',requestKey:'repeat',allowDuplicate:true});assert.equal(legitimate.statusCode,201);
  assert.equal((await request('GET','/api/expenses')).json().total,'0.20');
  assert.equal(first.json().taxRate,'18');
 }finally{await app.close();}
});
test('correcting another field never erases an existing tax rate',async()=>{
 const {app,request}=await fixture();
 try {
  const data={paymentDate:'2026-11-01',description:'Tax preservation',amount:'118.00',method:'Card',transactionRef:'TAX-1',requestKey:'tax-1',taxRate:'18'};
  const saved=(await request('POST','/api/expenses',data)).json();
  const {taxRate,...withoutTax}=data;
  const edited=await request('PUT','/api/expenses/'+saved.id,{...withoutTax,description:'Corrected description',version:saved.version});
  assert.equal(edited.statusCode,200);assert.equal(edited.json().taxRate,'18');
 }finally{await app.close();}
});
test('fictional demo transactions are seeded separately and never enter real totals',async()=>{
 const {app,request}=await fixture();
 try {
  const real=await request('GET','/api/expenses');assert.equal(real.json().count,0);
  const demo=await request('GET','/api/expenses?space=demo');assert.ok(demo.json().count>=6,'Fictional demo data should be available');
  const twice=await request('GET','/api/expenses?space=demo');assert.equal(twice.json().count,demo.json().count);
  assert.equal((await request('GET','/api/expenses')).json().total,'0.00');
 }finally{await app.close();}
});
