import test from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../shared/config.js';
import { build } from 'vite';
import { chromium,expect,type Page } from '@playwright/test';
import { buildApp } from '../server/app.js';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

async function withApp(run:(page:Page,base:string)=>Promise<void>){
 await build({logLevel:'error'});
 const app=await buildApp({dbPath:':memory:'});
 await app.listen({host:'127.0.0.1',port:0});
 const address=app.server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}`,oldOrigin=process.env.LOCAL_ORIGINS;
 process.env.LOCAL_ORIGINS=base;
 const browser=await chromium.launch({args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const signup=await page.request.post(base+'/api/register',{headers:{'x-ledger-request':'1'},data:{name:'Theme Owner',email:'theme@example.com',password:'ThemeRegression42!'}});
  assert.equal(signup.status(),201);
  await run(page,base);
 }finally{await browser.close();await app.close();if(oldOrigin===undefined)delete process.env.LOCAL_ORIGINS;else process.env.LOCAL_ORIGINS=oldOrigin;}
}

test('reminder formatter preserves the default and accurately labels configured minutes and hours',()=>{
 const format=(config as Record<string,unknown>).formatReminderMessage;
 assert.equal(typeof format,'function','Export a reminder formatter instead of always using the two-hour message');
 const message=format as (minutes:number)=>string;
 assert.equal(message(120),config.REMINDER_MESSAGE);
 for(const [minutes,label] of [[1,'1 minute'],[30,'30 minutes'],[60,'1 hour'],[90,'90 minutes'],[180,'3 hours'],[1440,'24 hours']] as const){
  assert.equal(message(minutes),`There were no entries found for the last ${label} so kindly upload the screenshot or manually update the paid bills`);
 }
});

test('reminder settings preview uses the saved session and popup uses the claimed interval',{timeout:60000},async()=>{
 await withApp(async(page,base)=>{
  // Only claim timing is isolated; settings/session use the real in-memory API.
  let due=false;
  await page.route('**/api/reminders/claim',route=>route.fulfill({json:{due,dueAt:0,now:Date.now(),intervalMinutes:60}}));
  await page.goto(base);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Reminders',exact:true}).click();
  const preview=page.locator('.settings-card blockquote');
  await expect(preview).toHaveText(config.REMINDER_MESSAGE);
  await page.getByLabel('Reminder interval (minutes)',{exact:true}).fill('90');
  await expect(preview).toHaveText(config.REMINDER_MESSAGE);
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect(page.getByText('Preferences saved.',{exact:true})).toBeVisible();
  const savedPreview=await preview.textContent();
  due=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  const popup=page.getByRole('dialog',{name:'Time to update your ledger',exact:true});
  await expect(popup).toBeVisible();
  const popupMessage=await popup.locator('.reminder-message p').textContent();
  assert.deepEqual({savedPreview,popupMessage},{savedPreview:config.formatReminderMessage(90),popupMessage:config.formatReminderMessage(60)});
 });
});

test('dark primary and navigation controls pass contrast on all screens; mobile inventory actions and notices stay readable',{timeout:120000},async()=>{
 await withApp(async(page,base)=>{
  await page.addInitScript(()=>localStorage.setItem('ledger_theme','dark'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(base);await page.getByLabel('Workspace space').selectOption('demo');
  const issues:unknown[]=[];
  const scan=async(label:string)=>{
   const violations=await page.evaluate(async()=>{
    const result=await(window as any).axe.run({include:[['.button-primary'],['.nav-item']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
    return result.violations.map((v:any)=>({id:v.id,nodes:v.nodes.map((n:any)=>({target:n.target,failureSummary:n.failureSummary}))}));
   });
   if(violations.length)issues.push({label,violations});
  };
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   for(const view of ['Expenses','Inventory','Suppliers','Reports','Documents','Reminders']){
    const nav=page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:view,exact:true});
    if(!await nav.isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await nav.click();
    await expect(page.getByRole('heading',{name:view==='Reports'?'Expense reports':view,exact:true,level:1})).toBeVisible();
    if(view==='Inventory')await expect(page.getByText('Wildleaf Lime Fizz',{exact:true}).first()).toBeVisible();
    if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await scan(`${width}/${view}`);
    if(width===1440&&view==='Expenses'){
     await page.locator('.nav-item-active').hover();await scan('desktop active navigation hover');
     await page.locator('.button-primary').first().hover();await scan('desktop primary button hover');
    }
    if(width===390)await page.getByRole('complementary',{name:'Workspace sidebar'}).getByRole('button',{name:'Close navigation',exact:true}).click();
    if(width===390&&view==='Inventory'){
     const sizes=await page.locator('.inventory-heading .button,.purchase-footer .button,.inventory-messages .notice').evaluateAll(elements=>elements.map(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize),minimum:el.classList.contains('notice')?12:14})));
     assert.ok(sizes.length>0);
     for(const item of sizes)if(item.size<item.minimum)issues.push({label:'mobile inventory readability',...item});
    }
    if(width===390&&view==='Reminders'){
     const size=await page.locator('.reminder-settings>.notice').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
     if(size<12)issues.push({label:'mobile notice readability',size,minimum:12});
    }
   }
  }
  assert.deepEqual(issues,[]);
 });
});
