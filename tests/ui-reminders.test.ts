import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'vite';
import { chromium,expect } from '@playwright/test';
import { buildApp } from '../server/app.js';
import { REMINDER_MESSAGE } from '../shared/config.js';

test('reminder dialog keeps an unsaved form, is leased to one tab, and dismissal postpones it', {timeout:90000},async()=>{
 await build({logLevel:'error'});const directory=await mkdtemp(join(tmpdir(),'ledger-reminders-ui-')),dbPath=join(directory,'test.sqlite');const app=await buildApp({dbPath});await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`,old=process.env.LOCAL_ORIGINS;process.env.LOCAL_ORIGINS=base;const browser=await chromium.launch({args:['--no-sandbox']});const context=await browser.newContext();const page=await context.newPage();const db=new DatabaseSync(dbPath);
 try {
  await context.request.post(base+'/api/register',{headers:{'x-ledger-request':'1'},data:{name:'Reminder Owner',email:'reminder@example.com',password:'KeepMyDraft42!'}});await page.goto(base);await page.getByRole('button',{name:'Add expense',exact:true}).first().click();await page.getByRole('button',{name:'Manual entry',exact:true}).click();await page.getByLabel('Description',{exact:true}).fill('Unsaved description must survive');await page.getByLabel('Amount',{exact:true}).fill('88.50');
  db.prepare('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE email=?').run(Date.now()-1,'reminder@example.com');
  const reminder=page.getByRole('dialog',{name:'Time to update your ledger',exact:true});await expect(reminder).toBeVisible({timeout:15000});await expect(reminder.getByText(REMINDER_MESSAGE,{exact:true})).toBeVisible();
  const other=await context.newPage();await other.goto(base);await expect(other.getByRole('heading',{name:'Expenses',exact:true})).toBeVisible();
  await page.waitForTimeout(5500);
  const dialogs=await Promise.all([page,other].map(p=>p.getByRole('dialog',{name:'Time to update your ledger',exact:true}).isVisible()));assert.equal(dialogs.filter(Boolean).length,1,'Only one tab presents a reminder');
  const owner=dialogs[0]?page:other;await owner.getByRole('dialog',{name:'Time to update your ledger',exact:true}).getByRole('button',{name:'Dismiss',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Time to update your ledger',exact:true})).not.toBeVisible();await expect(other.getByRole('dialog',{name:'Time to update your ledger',exact:true})).not.toBeVisible();
  await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Unsaved description must survive');await expect(page.getByLabel('Amount',{exact:true})).toHaveValue('88.50');
  const state=await(await context.request.get(base+'/api/reminders')).json();assert.ok(state.dueAt>state.now+119*60*1000);assert.equal((await(await context.request.get(base+'/api/expenses')).json()).count,0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Reminders',exact:true}).click();await expect(page.getByRole('heading',{name:'Reminders',exact:true})).toBeVisible();await page.getByLabel('Reminder interval (minutes)',{exact:true}).fill('90');await page.getByRole('button',{name:'Save preferences',exact:true}).click();await expect(page.getByText('Preferences saved.',{exact:true})).toBeVisible();assert.equal((await(await context.request.get(base+'/api/settings')).json()).reminderMinutes,90);
 }finally{db.close();await browser.close();await app.close();await rm(directory,{recursive:true,force:true});if(old===undefined)delete process.env.LOCAL_ORIGINS;else process.env.LOCAL_ORIGINS=old;}
});
