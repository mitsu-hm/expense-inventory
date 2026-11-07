import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture } from './helpers.js';
test('uploads remain private drafts; setup is honest; reviewed documents link to one paid transaction',async()=>{
 const {app,request}=await fixture();try{
  const image=await sharp({create:{width:32,height:32,channels:3,background:'#fff'}}).png().toBuffer();
  const upload=await request('POST','/api/documents',{name:'fictional-bill.png',mimeType:'image/png',kind:'bill',base64:image.toString('base64')});assert.equal(upload.statusCode,201,upload.body);
  const doc=upload.json();assert.equal(doc.status,'draft');assert.equal(doc.draft.method,null);
  assert.equal((await request('GET','/api/reports?period=monthly&date=2026-11-01')).json().total,'0.00');
  assert.equal((await app.inject({method:'GET',url:doc.imageUrl})).statusCode,401);
  const scan=await request('POST','/api/documents/'+doc.id+'/scan',{version:doc.version});assert.equal(scan.statusCode,503);assert.equal(scan.json().code,'AI_SETUP_REQUIRED');
  const repeated=await request('POST','/api/documents',{name:'same-image.png',mimeType:'image/png',kind:'bill',base64:image.toString('base64')});assert.equal(repeated.json().id,doc.id);assert.equal(repeated.json().duplicate,true);
  const draft={...doc.draft,paymentDate:'2026-11-01',description:'Fictional receipt vendor',amount:'123.45',method:null,transactionRef:'ONE-TRANSACTION'};
  const draftSaved=await request('PATCH','/api/documents/'+doc.id,{version:doc.version,draft});assert.equal(draftSaved.statusCode,200,draftSaved.body);assert.ok(draftSaved.json().warnings.some((v:string)=>v.toLowerCase().includes('payment method')));
  const noMethod=await request('POST','/api/documents/'+doc.id+'/confirm',{version:draftSaved.json().version,reviewed:true,acknowledgeWarnings:true,target:'expense',requestKey:'doc-save'});assert.equal(noMethod.statusCode,400);
  const ready=await request('PATCH','/api/documents/'+doc.id,{version:draftSaved.json().version,draft:{...draft,method:'UPI'}});assert.equal(ready.statusCode,200);
  const confirmed=await request('POST','/api/documents/'+doc.id+'/confirm',{version:ready.json().version,reviewed:true,acknowledgeWarnings:true,target:'expense',requestKey:'doc-save'});assert.equal(confirmed.statusCode,200,confirmed.body);
  assert.equal(confirmed.json().document.status,'confirmed');assert.equal((await request('GET','/api/expenses')).json().total,'123.45');
  const retry=await request('POST','/api/documents/'+doc.id+'/confirm',{version:ready.json().version,reviewed:true,acknowledgeWarnings:true,target:'expense',requestKey:'doc-save'});assert.equal(retry.statusCode,200);assert.equal((await request('GET','/api/expenses')).json().count,1);
  const secondImage=await sharp({create:{width:33,height:32,channels:3,background:'#eee'}}).png().toBuffer();
  const receipt=(await request('POST','/api/documents',{name:'payment-receipt.png',mimeType:'image/png',kind:'payment_receipt',base64:secondImage.toString('base64')})).json();
  const possibleReceipt=await request('PATCH','/api/documents/'+receipt.id,{version:receipt.version,draft:{...receipt.draft,paymentDate:'2026-11-01',description:'Different payment receipt description',amount:'123.45',method:'UPI',transactionRef:'DIFFERENT-UTR'}});assert.equal(possibleReceipt.json().duplicateCandidates.length,1);
  receipt.version=possibleReceipt.json().version;
  const linked=await request('POST','/api/documents/'+receipt.id+'/confirm',{version:receipt.version,reviewed:true,acknowledgeWarnings:true,target:'existingExpense',existingExpenseId:confirmed.json().expense.id,requestKey:'link-receipt'});assert.equal(linked.statusCode,200,linked.body);
  const expenses=(await request('GET','/api/expenses')).json();assert.equal(expenses.count,1);assert.equal(expenses.records[0].documentsCount,2);
  const orderImage=await sharp({create:{width:34,height:32,channels:3,background:'#ddd'}}).png().toBuffer();
  const order=(await request('POST','/api/documents',{name:'order.png',mimeType:'image/png',kind:'order',base64:orderImage.toString('base64')})).json();
  assert.equal((await request('POST','/api/documents/'+order.id+'/confirm',{version:order.version,reviewed:true,acknowledgeWarnings:true,target:'expense',requestKey:'bad-order'})).statusCode,400);
  assert.equal((await request('GET','/api/inventory')).json().products.length,0);
  assert.equal((await request('POST','/api/documents',{name:'bad.png',mimeType:'image/png',kind:'bill',base64:Buffer.from('<script>not an image</script>').toString('base64')})).statusCode,400);
 }finally{await app.close();}
});
