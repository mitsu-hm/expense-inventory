import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium,expect,type Page } from '@playwright/test';
import sharp from 'sharp';
import { fixture } from './helpers.js';

async function withDocumentPage(run:(page:Page,request:Awaited<ReturnType<typeof fixture>>['request'])=>Promise<void>){
 const original=globalThis.fetch,saved=Object.fromEntries(['AI_PROVIDER','AI_MODEL','AI_LOCAL_ONLY','LOCAL_ORIGINS'].map(k=>[k,process.env[k]]));
 process.env.AI_PROVIDER='ollama';process.env.AI_MODEL='controlled-unavailable';process.env.AI_LOCAL_ONLY='1';
 globalThis.fetch=async()=>{throw new Error('controlled offline model');};
 const f=await fixture();await f.app.listen({host:'127.0.0.1',port:0});const address=f.app.server.address();assert.ok(address&&typeof address!=='string');
 const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${address.port}`,changeOrigin:true}}}});let browser;
 try{
  await server.listen();const base=server.resolvedUrls!.local[0];process.env.LOCAL_ORIGINS=base.replace(/\/$/,'');
  browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const [name,...value]=f.headers.cookie.split('=');await page.context().addCookies([{name,value:value.join('='),url:base}]);
  await page.goto(base+'documents');await expect(page.getByRole('heading',{name:'Documents',exact:true})).toBeVisible();
  await run(page,f.request);
 }finally{await browser?.close();await server.close();await f.app.close();globalThis.fetch=original;for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
async function upload(page:Page){
 const image=await sharp({create:{width:90,height:90,channels:3,background:'#fff'}}).png().toBuffer();
 await page.getByLabel('Screenshot file',{exact:true}).setInputFiles({name:'synthetic-bill.png',mimeType:'image/png',buffer:image});await page.getByRole('button',{name:'Upload screenshot',exact:true}).click();
 await expect(page.getByAltText('Source document')).toBeVisible();await expect(page.getByRole('button',{name:'Upload screenshot',exact:true})).toBeDisabled();
}

test('failed automatic scan shows an error, keeps uploaded draft and never posts money', {timeout:60000},async()=>withDocumentPage(async(page,request)=>{
 await upload(page);
 await expect(page.getByRole('alert').filter({hasText:/upload.*saved|draft.*preserved/i}).first()).toBeVisible();
 assert.equal(await page.locator('.notice-success').filter({hasText:/could not|failed|unavailable/i}).count(),0);
 const docs=(await request('GET','/api/documents')).json().records;assert.equal(docs.length,1);assert.equal(docs[0].processing,'failed');assert.equal((await request('GET','/api/expenses')).json().count,0);
 await mkdir('artifacts/fixes',{recursive:true});await page.screenshot({path:'artifacts/fixes/document-scan-failure.png'});
}));

test('review asks for payment intent and creates missing supplier/product inline before an unpaid purchase', {timeout:60000},async()=>withDocumentPage(async(page,request)=>{
 await upload(page);
 await expect(page.getByLabel('Save document as',{exact:true})).toHaveValue('');
 await page.getByLabel('Review document type',{exact:true}).selectOption('order');await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByText('Draft saved. No payment or stock has been posted.',{exact:true})).toBeVisible();
 assert.equal((await request('GET','/api/documents')).json().records[0].kind,'order');
 await page.getByLabel('Save document as',{exact:true}).selectOption('purchase');
 await page.getByText('Create supplier from document',{exact:true}).click();await page.getByLabel('New supplier name',{exact:true}).fill('Inline supplier');await page.getByRole('button',{name:'Create supplier',exact:true}).click();
 await expect(page.getByLabel('Document supplier',{exact:true})).not.toHaveValue('');
 await page.getByRole('button',{name:'Add item line',exact:true}).click();
 for(const [field,value]of Object.entries({description:'Inline drink',productType:'Drink',brand:'Inline brand',flavour:'Vanilla',packSize:'1 L',unit:'bottle',quantity:'2',unitPrice:'59.00'}))await page.getByLabel(`${field} for document line 1`,{exact:true}).fill(value);
 await page.getByRole('button',{name:'Create product from item 1',exact:true}).click();await expect(page.getByLabel('Verified product match 1',{exact:true})).not.toHaveValue('');
 await page.getByLabel('Document ordered date',{exact:true}).fill('2026-11-05');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByText('Draft saved. No payment or stock has been posted.',{exact:true})).toBeVisible();
 await page.getByLabel('I have reviewed the source image and these fields',{exact:true}).check();const ack=page.getByLabel('I have checked the warnings and any differences',{exact:true});if(await ack.isVisible())await ack.check();
 await page.getByRole('button',{name:'Confirm reviewed record',exact:true}).click();await expect(page.getByText('Document confirmed. The linked record is saved.',{exact:true})).toBeVisible();
 assert.equal((await request('GET','/api/suppliers')).json().records[0].name,'Inline supplier');assert.equal((await request('GET','/api/products')).json().records[0].quantity,'0');assert.equal((await request('GET','/api/purchases')).json().records.length,1);assert.equal((await request('GET','/api/expenses')).json().count,0);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'artifacts/fixes/document-inline-purchase-mobile.png',fullPage:true});
}));

test('normal rescan preserves reviewed fields and explicit replacement requires consent', {timeout:60000},async()=>withDocumentPage(async(page,request)=>{
 await upload(page);await page.getByLabel('Document description / payee',{exact:true}).fill('Human correction');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByText('Draft saved. No payment or stock has been posted.',{exact:true})).toBeVisible();
 globalThis.fetch=async()=>Response.json({message:{content:JSON.stringify({paymentDate:null,orderedDate:'2026-11-05',description:'New machine extraction',amount:'118.00',method:null,additionalInformation:'',transactionRef:null,supplierName:null,lines:[],warnings:[]})}});
 await page.getByRole('button',{name:'Scan document',exact:true}).click();await expect(page.getByLabel('Document paid amount',{exact:true})).toHaveValue('118.00');await expect(page.getByLabel('Document description / payee',{exact:true})).toHaveValue('Human correction');
 await expect(page.getByText(/Saved human corrections preserved: description/)).toBeVisible();
 await page.getByLabel('Replace saved corrections on next scan',{exact:true}).check();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Scan document',exact:true}).click();await expect(page.getByLabel('Document description / payee',{exact:true})).toHaveValue('Human correction');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Scan document',exact:true}).click();await expect(page.getByLabel('Document description / payee',{exact:true})).toHaveValue('New machine extraction');
 assert.equal((await request('GET','/api/documents')).json().records[0].draft.description,'New machine extraction');assert.equal((await request('GET','/api/expenses')).json().count,0);
}));

test('workspace refresh fetches reports and refreshes document metadata without discarding dirty fields', {timeout:60000},async()=>withDocumentPage(async(page,request)=>{
 await upload(page);await page.getByLabel('Document description / payee',{exact:true}).fill('Keep this unsaved edit');
 const refreshed=page.waitForResponse(r=>r.url().includes('/api/documents?')&&r.request().method()==='GET');await page.evaluate(()=>window.dispatchEvent(new Event('ledger-refresh')));await refreshed;
 await expect(page.getByLabel('Document description / payee',{exact:true})).toHaveValue('Keep this unsaved edit');
 page.on('dialog',dialog=>dialog.accept());await page.goto(new URL('/reports',page.url()).toString());await expect(page.getByTestId('report-total')).toBeVisible();
 const report=page.waitForResponse(r=>r.url().includes('/api/reports?'));await page.evaluate(()=>window.dispatchEvent(new Event('ledger-refresh')));await report;
 assert.equal((await request('GET','/api/expenses')).json().count,0);
}));
