import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

test('orders do not become stock until received, and purchase prices remain historical',async()=>{
 const {app,request}=await fixture();
 try {
  const s=await request('POST','/api/suppliers',{name:'Fictional Cedar Supply',email:'cedar@example.com'});assert.equal(s.statusCode,201,s.body);
  const supplier=s.json();
  const p=await request('POST','/api/products',{name:'Cedar soda',productType:'Drink',brand:'Cedar',flavour:'Lime',packSize:'250 ml',unit:'bottle',supplierId:supplier.id,unitPrice:'10.125000'});assert.equal(p.statusCode,201,p.body);
  assert.equal(p.json().quantity,'0');
  const order=await request('POST','/api/purchases',{supplierId:supplier.id,orderedDate:'2026-11-01',reference:'ORDER-1',requestKey:'order-1',lines:[{productId:p.json().id,quantity:'3',unitPrice:'10.125000',taxRate:'18'}]});assert.equal(order.statusCode,201,order.body);
  assert.equal(order.json().totalCost,'30.38');assert.equal(order.json().paidTotal,'0.00');assert.equal(order.json().status,'ordered');
  let inventory=(await request('GET','/api/inventory')).json();assert.equal(inventory.products[0].quantity,'0');assert.equal(inventory.products[0].orderedQuantity,'3');
  const receiveInput={requestKey:'receive-1',lines:[{lineId:order.json().lines[0].id,quantity:'2'}]};
  const received=await request('POST','/api/purchases/'+order.json().id+'/receive',receiveInput);assert.equal(received.statusCode,200,received.body);assert.equal(received.json().status,'partial');
  await request('POST','/api/purchases/'+order.json().id+'/receive',receiveInput);
  inventory=(await request('GET','/api/inventory')).json();assert.equal(inventory.products[0].quantity,'2');assert.equal(inventory.products[0].totalCost,'20.25');
  const tooMany=await request('POST','/api/purchases/'+order.json().id+'/receive',{requestKey:'receive-2',lines:[{lineId:order.json().lines[0].id,quantity:'2'}]});assert.equal(tooMany.statusCode,400);
  const second=await request('POST','/api/purchases',{supplierId:supplier.id,orderedDate:'2026-11-02',reference:'ORDER-2',requestKey:'order-2',lines:[{productId:p.json().id,quantity:'1',unitPrice:'20'}]});assert.equal(second.statusCode,201);
  await request('POST','/api/purchases/'+second.json().id+'/receive',{requestKey:'receive-3',lines:[{lineId:second.json().lines[0].id,quantity:'1'}]});
  inventory=(await request('GET','/api/inventory')).json();assert.equal(inventory.products[0].quantity,'3');assert.equal(inventory.products[0].totalCost,'40.25');assert.equal(inventory.purchases.find((v:any)=>v.id===order.json().id).lines[0].unitPrice,'10.125');
  assert.equal((await request('GET','/api/expenses')).json().total,'0.00','Unpaid purchases never enter expense totals');
  const payment=await request('POST','/api/expenses',{paymentDate:'2026-11-02',description:'Payment to Cedar',amount:'30.38',method:'Card',transactionRef:'PAY-CEDAR',additionalInformation:'Particular purchase payment',requestKey:'payment-cedar',purchaseId:order.json().id});assert.equal(payment.statusCode,201,payment.body);
  inventory=(await request('GET','/api/inventory')).json();assert.equal(inventory.purchases.find((v:any)=>v.id===order.json().id).paidTotal,'30.38');
  const dup=await request('POST','/api/purchases',{supplierId:supplier.id,orderedDate:'2026-11-01',reference:'order-1',requestKey:'duplicate-order',lines:[{productId:p.json().id,quantity:'3',unitPrice:'10'}]});assert.equal(dup.statusCode,409);
 }finally{await app.close();}
});
