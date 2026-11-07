import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
test('sessions and route protection keep private data out of public/noncanonical paths',async()=>{
 const {app,request}=await fixture();try{
  await request('POST','/api/expenses',{paymentDate:'2026-11-01',description:'PRIVATE_TRANSACTION_SENTINEL',amount:'1.00',method:'Cash',requestKey:'private-sentinel'});
  for(const url of ['/api/expenses','/api/%65xpenses','/api%2fexpenses','/%61pi/expenses','/data/ledger.sqlite','/../data/ledger.sqlite','/%2e%2e/data/ledger.sqlite','/.env','/server/app.ts']){
   const response=await app.inject({method:'GET',url});assert.equal(response.body.includes('PRIVATE_TRANSACTION_SENTINEL'),false,url);assert.equal(response.body.includes('SQLite format 3'),false,url);assert.equal(response.body.includes('password_hash'),false,url);
  }
  const protectedWrite=await app.inject({method:'POST',url:'/api/login',payload:{email:'fixture@example.com',password:'CorrectHorse42!'}});assert.equal(protectedWrite.statusCode,403);
  const health=await request('GET','/api/health');assert.equal(health.headers['x-frame-options'],'DENY');assert.equal(health.headers['x-content-type-options'],'nosniff');
  const login=await app.inject({method:'POST',url:'/api/login',headers:{'x-ledger-request':'1'},payload:{email:'fixture@example.com',password:'CorrectHorse42!'}});const cookies=String(login.headers['set-cookie']);assert.ok(cookies.includes('HttpOnly'));assert.ok(cookies.includes('SameSite=Strict'));
  assert.equal((await request('GET','/api/expenses?q='+encodeURIComponent("' OR 1=1 --"))).json().count,0);
 }finally{await app.close();}
});
