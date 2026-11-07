import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { chromium,expect } from '@playwright/test';
import { build } from 'vite';
import sharp from 'sharp';
import { buildApp } from '../server/app.js';
const require=createRequire(import.meta.url);

test('final QA: all six screens on desktop/mobile, no root overflow, accessibility or browser errors', {timeout:150000},async()=>{
 await build({logLevel:'error'});const directory=await mkdtemp(join(tmpdir(),'ledger-qa-'));const app=await buildApp({dbPath:join(directory,'qa.sqlite')});await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`,oldOrigin=process.env.LOCAL_ORIGINS;process.env.LOCAL_ORIGINS=base;const browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[],failedResponses:string[]=[],issues:any[]=[],checks:any[]=[],screenshots:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)failedResponses.push(r.status()+' '+new URL(r.url()).pathname);});
 const output=resolve('artifacts/screenshots');await mkdir(output,{recursive:true});
 try {
  const signup=await page.request.post(base+'/api/register',{headers:{'x-ledger-request':'1'},data:{name:'Fictional Demo Owner',email:'qa-demo@example.com',password:'FictionalDemo42!'}});assert.equal(signup.status(),201);
  const image=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="460"><rect width="640" height="460" fill="white"/><rect width="640" height="90" fill="#214e3b"/><text x="40" y="42" font-family="sans-serif" font-size="24" fill="white">LedgerSprout · FICTIONAL SAMPLE</text><text x="40" y="73" font-family="sans-serif" font-size="16" fill="#dce8d1">Manual review example — not a real transaction</text><text x="40" y="150" font-family="sans-serif" font-size="22">Willow Wholesale</text><text x="40" y="195" font-family="sans-serif" font-size="18">Reference: DEMO-DOC-100</text><text x="40" y="240" font-family="sans-serif" font-size="18">Amount: INR 345.67</text><text x="40" y="285" font-family="sans-serif" font-size="18">Payment method: not recorded</text><text x="40" y="370" font-family="sans-serif" font-size="18" fill="#557745">DEMO ONLY · No AI extraction performed</text></svg>')).png().toBuffer();
  const doc=(await(await page.request.post(base+'/api/documents?space=demo',{headers:{'x-ledger-request':'1'},data:{name:'demo-review.png',kind:'payment_receipt',mimeType:'image/png',base64:image.toString('base64')}})).json());assert.ok(doc.id);
  await page.request.patch(base+'/api/documents/'+doc.id+'?space=demo',{headers:{'x-ledger-request':'1'},data:{version:doc.version,draft:{...doc.draft,description:'Fictional Willow Wholesale',amount:'345.67',additionalInformation:'Manually transcribed QA demo. Not a real payment; draft only.'}}});
  await page.goto(base);await page.getByLabel('Workspace space').selectOption('demo');
  const navigate=async(name:string)=>{const button=page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true});if(!await button.isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await button.click();await expect(page.getByRole('heading',{name:name==='Reports'?'Expense reports':name,exact:true,level:1})).toBeVisible();};
  for(const viewport of [{width:1440,height:1000,name:'desktop'},{width:390,height:844,name:'mobile'}]){
   await page.setViewportSize(viewport);
   if(viewport.name==='mobile')await page.emulateMedia({reducedMotion:'reduce'});
   for(const view of ['Expenses','Inventory','Suppliers','Reports','Documents','Reminders']){
    await navigate(view);
    if(view==='Inventory')await expect(page.getByText('Wildleaf Lime Fizz',{exact:true}).first()).toBeVisible();
    if(view==='Suppliers')await expect(page.locator('.suppliers-workspace').getByText('Maple Beverage Supply',{exact:true}).first()).toBeVisible();
    if(view==='Reports')await expect(page.getByTestId('report-total')).toBeVisible();
    if(view==='Documents'){await page.getByRole('button',{name:/demo-review.png/}).click();await expect(page.getByAltText('Source document')).toBeVisible();}
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const violations=await page.evaluate(async()=>{const result=await(window as any).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map((v:any)=>({id:v.id,nodes:v.nodes.map((n:any)=>({target:n.target,failureSummary:n.failureSummary}))}));});
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1);}).slice(0,8).map(el=>({tag:el.tagName,className:el.getAttribute('class'),right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width}))}));
    if(violations.length||geometry.scroll>geometry.width)issues.push({view,viewport:viewport.name,violations,geometry});
    checks.push({view,viewport:viewport.name,width:viewport.width,accessibilityViolations:violations.length,rootOverflow:geometry.scroll>geometry.width});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));const path=join(output,view.toLowerCase()+'-'+viewport.name+'.png');await page.screenshot({path,fullPage:true,animations:'disabled',scale:'css'});screenshots.push(path);
   }
  }
  const summary={browser:browser.version(),checks,screenshots,issues,errors,failedResponses};await writeFile(resolve('artifacts/qa-summary.json'),JSON.stringify(summary,null,2));console.log('QA summary: '+JSON.stringify(summary));
  assert.deepEqual(issues,[]);assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[]);
 }finally{await browser.close();await app.close();await rm(directory,{recursive:true,force:true});if(oldOrigin===undefined)delete process.env.LOCAL_ORIGINS;else process.env.LOCAL_ORIGINS=oldOrigin;}
});
