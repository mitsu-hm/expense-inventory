import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture } from './helpers.js';

test('confirming an ordered-product screenshot creates an unpaid order, not available stock or expense',async()=>{
 const {app,request}=await fixture();try{
  const supplier=(await request('POST','/api/suppliers',{name:'Order Screenshot Supplier'})).json();
  const product=(await request('POST','/api/products',{name:'Verified pack',productType:'Drink',brand:'Willow',flavour:'Lime',packSize:'6 bottles',unit:'pack',supplierId:supplier.id,unitPrice:'75.123456'})).json();
  const image=await sharp({create:{width:44,height:44,channels:3,background:'#eee'}}).png().toBuffer();
  const document=(await request('POST','/api/documents',{name:'fictional-order.png',kind:'order',mimeType:'image/png',base64:image.toString('base64')})).json();
  const line={description:'Verified pack',productId:product.id,productType:'Drink',brand:'Willow',flavour:'Lime',packSize:'6 bottles',unit:'pack',quantity:null,unitPrice:null,taxRate:'18',evidence:'Manual test fixture, not AI extraction'};
  let saved=(await request('PATCH','/api/documents/'+document.id,{version:document.version,draft:{...document.draft,orderedDate:'2026-11-01',supplierId:supplier.id,lines:[line]}})).json();
  const invalid=await request('POST','/api/documents/'+document.id+'/confirm',{version:saved.version,reviewed:true,acknowledgeWarnings:true,target:'purchase',requestKey:'screenshot-order'});assert.equal(invalid.statusCode,400);assert.equal((await request('GET','/api/purchases')).json().records.length,0);
  saved=(await request('PATCH','/api/documents/'+document.id,{version:saved.version,draft:{...saved.draft,lines:[{...line,quantity:'2',unitPrice:'75.123456'}]}})).json();
  const confirmed=await request('POST','/api/documents/'+document.id+'/confirm',{version:saved.version,reviewed:true,acknowledgeWarnings:true,target:'purchase',requestKey:'screenshot-order'});assert.equal(confirmed.statusCode,200,confirmed.body);assert.equal(confirmed.json().purchase.status,'ordered');assert.equal(confirmed.json().purchase.lines[0].quantity,'2');assert.equal(confirmed.json().purchase.lines[0].packSize,'6 bottles');
  const inventory=(await request('GET','/api/inventory')).json();assert.equal(inventory.products[0].quantity,'0');assert.equal(inventory.products[0].orderedQuantity,'2');assert.equal((await request('GET','/api/expenses')).json().total,'0.00');
 }finally{await app.close();}
});
