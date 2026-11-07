import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture } from './helpers.js';

test('per-user inactivity threshold, tab lease, dismiss and qualifying entries use the configured interval',async()=>{
 let clock=Date.parse('2026-11-01T09:00:00Z');
 const {app,request}=await fixture({dbPath:':memory:',now:()=>clock});try{
  const state=await request('GET','/api/reminders');assert.equal(state.statusCode,200,state.body);assert.equal(state.json().dueAt,clock+120*60*1000);
  assert.equal((await request('POST','/api/reminders/claim',{tabId:'first-tab'})).json().due,false);
  clock+=120*60*1000;
  assert.equal((await request('POST','/api/reminders/claim',{tabId:'first-tab'})).json().due,true);
  assert.equal((await request('POST','/api/reminders/claim',{tabId:'second-tab'})).json().due,false);
  const dismissed=await request('POST','/api/reminders/dismiss',{tabId:'first-tab'});assert.equal(dismissed.json().dueAt,clock+120*60*1000);
  clock+=120*60*1000-1;assert.equal((await request('POST','/api/reminders/claim',{tabId:'second-tab'})).json().due,false);
  clock++;assert.equal((await request('POST','/api/reminders/claim',{tabId:'second-tab'})).json().due,true);
  const image=await sharp({create:{width:32,height:33,channels:3,background:'#fff'}}).png().toBuffer();
  assert.equal((await request('POST','/api/documents',{name:'activity.png',mimeType:'image/png',kind:'bill',base64:image.toString('base64')})).statusCode,201);
  assert.equal((await request('POST','/api/reminders/claim',{tabId:'first-tab'})).json().due,false);
  clock+=120*60*1000;
  await request('POST','/api/expenses',{paymentDate:'2026-11-01',description:'Qualifying saved manual entry',amount:'1.00',method:'Cash',requestKey:'reminder-entry'});
  assert.equal((await request('GET','/api/reminders')).json().dueAt,clock+120*60*1000);
  const settings=await request('PATCH','/api/settings',{reminderMinutes:5,timezone:'Asia/Kolkata',weekStartsOn:1});assert.equal(settings.statusCode,200);
  assert.equal((await request('GET','/api/reminders')).json().dueAt,clock+5*60*1000);
  assert.equal((await request('PATCH','/api/settings',{reminderMinutes:0})).statusCode,400);
  assert.equal((await request('PATCH','/api/settings',{timezone:'Not/AZone'})).statusCode,400);
 }finally{await app.close();}
});
