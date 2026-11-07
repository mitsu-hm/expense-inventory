import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { buildApp } from '../server/app.js';

test('real browser: supplier, order, partial receipt, explicit payment, filtered report and full Excel export', {timeout:120000}, async()=>{
 await build({logLevel:'error'});
 const directory=await mkdtemp(join(tmpdir(),'ledger-flows-'));
 const app=await buildApp({dbPath:join(directory,'test.sqlite')});await app.listen({host:'127.0.0.1',port:0});
 const addr=app.server.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
 const oldOrigin=process.env.LOCAL_ORIGINS;process.env.LOCAL_ORIGINS=base;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try {
  await page.goto(base);await page.getByRole('button',{name:'Create an account',exact:true}).click();
  await page.getByLabel('Your name').fill('Flows Owner');await page.getByLabel('Email address').fill('flows@example.com');await page.getByLabel('Password',{exact:true}).fill('WorkingLocal42!');await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Expenses',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Suppliers',exact:true}).click();await page.getByRole('button',{name:'Add supplier',exact:true}).first().click();
  await page.getByLabel('Supplier name',{exact:true}).fill('Willow Wholesale');await page.getByLabel('Email',{exact:true}).fill('willow@example.com');await page.getByRole('button',{name:'Save supplier',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  const supplier=(await (await page.request.get(base+'/api/suppliers')).json()).records[0];
  await page.getByRole('button',{name:'Inventory',exact:true}).click();await page.getByRole('button',{name:'Add product',exact:true}).first().click();
  for(const [label,value] of [['Product name','Willow lime soda'],['Product type','Drink'],['Brand','Willow'],['Flavour','Lime'],['Pack size','250 ml'],['Unit','bottle'],['Initial unit price','12.345678']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('Product supplier',{exact:true}).selectOption(supplier.id);await page.getByRole('button',{name:'Save product',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  const product=(await (await page.request.get(base+'/api/products')).json()).records[0];assert.equal(product.quantity,'0');
  await page.getByRole('button',{name:'New purchase order',exact:true}).click();await page.getByLabel('Order supplier',{exact:true}).selectOption(supplier.id);await page.getByLabel('Ordered date',{exact:true}).fill('2026-11-05');await page.getByLabel('Order reference',{exact:true}).fill('WILLOW-001');await page.getByLabel('Product for line 1',{exact:true}).selectOption(product.id);await page.getByLabel('Quantity for line 1',{exact:true}).fill('3');await page.getByLabel('Unit price for line 1',{exact:true}).fill('12.345678');await page.getByLabel('Tax rate for line 1',{exact:true}).fill('5');await page.getByRole('button',{name:'Create order',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  assert.equal((await (await page.request.get(base+'/api/products')).json()).records[0].quantity,'0');assert.equal((await (await page.request.get(base+'/api/expenses')).json()).total,'0.00');
  await page.getByRole('button',{name:'Receive stock',exact:true}).click();await page.getByLabel('Receive now for Willow lime soda',{exact:true}).fill('2');await page.getByRole('button',{name:'Confirm receipt',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  assert.equal((await (await page.request.get(base+'/api/products')).json()).records[0].quantity,'2');
  await page.getByRole('button',{name:'Record payment',exact:true}).click();await expect(page.getByLabel('Payment method',{exact:true})).toHaveValue('');await expect(page.getByLabel('Amount',{exact:true})).toHaveValue('');await page.getByLabel('Payment date').fill('2026-11-05');await page.getByLabel('Amount',{exact:true}).fill('20.11');await page.getByLabel('Payment method',{exact:true}).selectOption('UPI');await page.getByLabel('Transaction reference',{exact:true}).fill('PAID-WILLOW');await page.getByRole('button',{name:'Save expense',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  const expenses=(await (await page.request.get(base+'/api/expenses')).json()).records;assert.ok(expenses[0].purchaseId);
  for(let i=0;i<24;i++) { const result=await page.request.post(base+'/api/expenses',{headers:{'x-ledger-request':'1'},data:{paymentDate:'2026-11-05',description:'Export row '+i,amount:'0.10',method:'UPI',requestKey:'export-row-'+i}});assert.equal(result.status(),201); }
  await page.getByRole('button',{name:'Reports',exact:true}).click();await expect(page.getByRole('heading',{name:'Expense reports',exact:true})).toBeVisible();
  await page.getByLabel('Report period',{exact:true}).selectOption('monthly');await page.getByLabel('Report date',{exact:true}).fill('2026-11-05');await page.getByLabel('Report payment method',{exact:true}).selectOption('UPI');
  const canonical=(await (await page.request.get(base+'/api/reports?period=monthly&date=2026-11-05&method=UPI')).json());
  await expect(page.getByTestId('report-total')).toHaveText('₹'+canonical.total);await expect(page.getByText('25 matching payments',{exact:true})).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();const download=await downloadPromise;const stream=await download.createReadStream();assert.ok(stream);const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(chunk);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.concat(chunks) as any);const sheet=workbook.getWorksheet('Expenses')!;assert.equal(sheet.rowCount,27);assert.equal(sheet.getRow(sheet.rowCount).getCell(3).result,Number(canonical.total));
  await page.getByRole('button',{name:'Expenses',exact:true}).click();await page.reload();await expect(page.getByRole('heading',{name:'Expenses',exact:true})).toBeVisible();assert.equal((await (await page.request.get(base+'/api/products')).json()).records[0].quantity,'2');
  assert.deepEqual(errors,[]);
 } finally {await browser.close();await app.close();await rm(directory,{recursive:true,force:true});if(oldOrigin===undefined)delete process.env.LOCAL_ORIGINS;else process.env.LOCAL_ORIGINS=oldOrigin;}
});
