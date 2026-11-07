import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { build } from 'vite';
import { chromium,expect } from '@playwright/test';
import { buildApp } from '../server/app.js';

test('document UI: honest setup-required, original preview, manual draft exclusion and receipt linking', {timeout:90000},async()=>{
 await build({logLevel:'error'});const directory=await mkdtemp(join(tmpdir(),'ledger-doc-ui-'));const app=await buildApp({dbPath:join(directory,'test.sqlite')});await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;const old=process.env.LOCAL_ORIGINS;process.env.LOCAL_ORIGINS=base;const browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage();
 try {
  await page.request.post(base+'/api/register',{headers:{'x-ledger-request':'1'},data:{name:'Document Reviewer',email:'documents@example.com',password:'DocumentReview42!'}});await page.goto(base);
  await page.getByRole('button',{name:'Add expense',exact:true}).first().click();await page.getByRole('button',{name:'Upload bill / payment receipt',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Documents',exact:true})).toBeVisible();await expect(page.getByText('Free Invoice AI Active',{exact:true})).toBeVisible();
  const image=await sharp({create:{width:64,height:64,channels:3,background:'#fff'}}).png().toBuffer();
  await page.getByLabel('Screenshot file',{exact:true}).setInputFiles({name:'fictional-bill.png',mimeType:'image/png',buffer:image});await page.getByRole('button',{name:'Upload screenshot',exact:true}).click();await expect(page.getByAltText('Source document')).toBeVisible();
  await expect(page.getByLabel('Document payment method',{exact:true})).toHaveValue('');await page.getByLabel('Document payment date',{exact:true}).fill('2026-11-05');await page.getByLabel('Document description / payee',{exact:true}).fill('Fictional reviewed payment');await page.getByLabel('Document paid amount',{exact:true}).fill('345.67');await page.getByLabel('Document payment method',{exact:true}).selectOption('Card');await page.getByLabel('Document reference',{exact:true}).fill('DOC-ONE');await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByText('Draft saved. No payment or stock has been posted.',{exact:true})).toBeVisible();assert.equal((await(await page.request.get(base+'/api/expenses')).json()).count,0);
  await page.getByLabel('I have reviewed the source image and these fields',{exact:true}).check();await page.getByLabel('I have checked the warnings and any differences',{exact:true}).check();await page.getByRole('button',{name:'Confirm reviewed record',exact:true}).click();await expect(page.getByText('Document confirmed. The linked record is saved.',{exact:true})).toBeVisible();const expense=(await(await page.request.get(base+'/api/expenses')).json()).records[0];assert.equal(expense.amount,'345.67');
  const receipt=await sharp({create:{width:65,height:64,channels:3,background:'#eee'}}).png().toBuffer();await page.getByLabel('Document type',{exact:true}).selectOption('payment_receipt');await page.getByLabel('Screenshot file',{exact:true}).setInputFiles({name:'fictional-payment.png',mimeType:'image/png',buffer:receipt});await page.getByRole('button',{name:'Upload screenshot',exact:true}).click();
  await page.getByLabel('Save document as',{exact:true}).selectOption('existingExpense');await page.getByLabel('Existing payment',{exact:true}).selectOption(expense.id);await page.getByLabel('I have reviewed the source image and these fields',{exact:true}).check();await page.getByLabel('I have checked the warnings and any differences',{exact:true}).check();await page.getByRole('button',{name:'Confirm reviewed record',exact:true}).click();
  await expect(page.getByText('Document confirmed. The linked record is saved.',{exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Documents',exact:true}).click();const list=(await(await page.request.get(base+'/api/expenses')).json());assert.equal(list.count,1);assert.equal(list.records[0].documentsCount,2);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await browser.close();await app.close();await rm(directory,{recursive:true,force:true});if(old===undefined)delete process.env.LOCAL_ORIGINS;else process.env.LOCAL_ORIGINS=old;}
});
