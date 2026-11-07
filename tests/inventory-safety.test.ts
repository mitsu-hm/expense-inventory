import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
test('demo stock is fictional, repeat-safe and separated from real inventory',async()=>{
 const {app,request}=await fixture();try{
  const demo=(await request('GET','/api/inventory?space=demo')).json();
  assert.ok(demo.products.length>=3);assert.ok(demo.purchases.some((p:any)=>p.status==='partial'));
  assert.ok(demo.products.some((p:any)=>p.quantity==='0'&&p.orderedQuantity!=='0'));
  assert.equal((await request('GET','/api/inventory?space=demo')).json().products.length,demo.products.length);
  assert.equal((await request('GET','/api/inventory')).json().products.length,0);
  assert.equal((await request('GET','/api/suppliers?space=demo')).json().records.every((s:any)=>s.email.endsWith('@example.com')),true);
 }finally{await app.close();}
});
test('inventory relationships and stock receipts cannot cross signed-in users',async()=>{
 const {app,request}=await fixture();try{
  const supplier=(await request('POST','/api/suppliers',{name:'Owner supplier'})).json();
  const product=(await request('POST','/api/products',{name:'Owner product',productType:'Food',brand:'Demo',flavour:'',packSize:'1 kg',unit:'kg',supplierId:supplier.id,unitPrice:'100'})).json();
  const purchase=(await request('POST','/api/purchases',{supplierId:supplier.id,orderedDate:'2026-11-01',requestKey:'own-order',lines:[{productId:product.id,quantity:'2',unitPrice:'100'}]})).json();
  const signup=await app.inject({method:'POST',url:'/api/register',headers:{'x-ledger-request':'1'},payload:{name:'Other owner',email:'other@example.com',password:'AnotherPassword42!'}});
  const cookie=signup.headers['set-cookie'];const headers={'x-ledger-request':'1',cookie:(Array.isArray(cookie)?cookie[0]:cookie!).split(';')[0]};
  const foreign=await app.inject({method:'POST',url:'/api/purchases/'+purchase.id+'/receive',headers,payload:{requestKey:'foreign-receive',lines:[{lineId:purchase.lines[0].id,quantity:'1'}]}});assert.equal(foreign.statusCode,404);
  const foreignProduct=await app.inject({method:'POST',url:'/api/products',headers,payload:{name:'Not owned',productType:'Food',brand:'X',packSize:'1 kg',unit:'kg',supplierId:supplier.id,unitPrice:'1'}});assert.equal(foreignProduct.statusCode,404);
  const foreignPayment=await app.inject({method:'POST',url:'/api/expenses',headers,payload:{paymentDate:'2026-11-01',description:'Foreign link',amount:'1.00',method:'UPI',purchaseId:purchase.id,requestKey:'foreign-link'}});assert.equal(foreignPayment.statusCode,404);
  const inv=(await request('GET','/api/inventory')).json();assert.equal(inv.products[0].quantity,'0');
 }finally{await app.close();}
});
