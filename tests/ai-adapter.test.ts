import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { fixture } from './helpers.js';

test('Ollama protocol fixture preserves drafts on failure and never guesses an unknown method',async()=>{
 const names=['AI_PROVIDER','AI_MODEL','AI_BASE_URL','AI_API_KEY'];const original=Object.fromEntries(names.map(k=>[k,process.env[k]]));let fail=true;let calls=0;
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);assert.equal(body.model,'test-vision-protocol-fixture');assert.ok(body.messages[1].images[0]);assert.equal(req.headers.authorization,'Bearer test-only-adapter-secret');calls++;if(fail){res.writeHead(503);res.end('fixture failure');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{content:JSON.stringify({paymentDate:null,orderedDate:null,description:null,amount:null,method:null,additionalInformation:'',transactionRef:null,supplierName:null,lines:[],warnings:['Protocol test fixture only; not a real AI extraction.']})}}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();assert.ok(addr&&typeof addr!=='string');process.env.AI_PROVIDER='ollama';process.env.AI_MODEL='test-vision-protocol-fixture';process.env.AI_BASE_URL=`http://127.0.0.1:${addr.port}`;process.env.AI_API_KEY='test-only-adapter-secret';
 const {app,request}=await fixture();try{
  const session=(await request('GET','/api/session')).json();assert.equal(session.ai.configured,true);assert.equal(JSON.stringify(session).includes('test-only-adapter-secret'),false);
  const image=await sharp({create:{width:35,height:35,channels:3,background:'#fff'}}).png().toBuffer();
  const doc=(await request('POST','/api/documents',{name:'protocol-fixture.png',kind:'payment_receipt',mimeType:'image/png',base64:image.toString('base64')})).json();
  let saved=(await request('PATCH','/api/documents/'+doc.id,{version:doc.version,draft:{...doc.draft,description:'Human-entered description'}})).json();
  const failed=await request('POST','/api/documents/'+doc.id+'/scan',{version:saved.version});assert.equal(failed.statusCode,502);
  saved=(await request('GET','/api/documents/'+doc.id)).json();assert.equal(saved.processing,'failed');assert.equal(saved.draft.description,'Human-entered description');assert.equal(saved.status,'draft');
  fail=false;const scanned=await request('POST','/api/documents/'+doc.id+'/scan',{version:saved.version});assert.equal(scanned.statusCode,200,scanned.body);assert.equal(scanned.json().draft.method,null);assert.equal(scanned.json().draft.description,'Human-entered description');assert.equal(scanned.json().status,'draft');assert.equal(calls,2);assert.equal((await request('GET','/api/expenses')).json().total,'0.00');
 }finally{await app.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));for(const name of names){if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];}}
});
