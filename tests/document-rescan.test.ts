import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture } from './helpers.js';

const empty={paymentDate:null,orderedDate:null,description:null,amount:null,method:null,additionalInformation:'',transactionRef:null,supplierName:null,lines:[],warnings:[]};
const line={description:'Audit drink',productType:'Drink',brand:'Audit brand',flavour:'Vanilla',packSize:'1 L',unit:'bottle',quantity:'2',unitPrice:'59.00',taxRate:null,evidence:'Audit drink Vanilla 1 L 2 59.00'};
async function controlled(run:(f:Awaited<ReturnType<typeof fixture>>,reply:(data:object)=>void)=>Promise<void>){
 const saved=Object.fromEntries(['AI_PROVIDER','AI_MODEL','AI_LOCAL_ONLY'].map(k=>[k,process.env[k]])),original=globalThis.fetch;
 process.env.AI_PROVIDER='ollama';process.env.AI_MODEL='controlled-test';process.env.AI_LOCAL_ONLY='1';
 let result:object=empty;
 globalThis.fetch=async()=>new Response(JSON.stringify({message:{content:JSON.stringify(result)}}),{status:200});
 const f=await fixture();
 try{await run(f,value=>{result=value;});}finally{await f.app.close();globalThis.fetch=original;for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
async function upload(request:Awaited<ReturnType<typeof fixture>>['request']){
 const image=await sharp({create:{width:46,height:47,channels:3,background:'#fafafa'}}).png().toBuffer();
 const response=await request('POST','/api/documents',{name:'synthetic-invoice.png',mimeType:'image/png',base64:image.toString('base64'),kind:'bill'});
 assert.equal(response.statusCode,201,response.body);return response.json();
}

test('rescans replace prior machine fields but preserve deliberate edits including empty values',async()=>controlled(async({request},reply)=>{
 let doc=await upload(request);
 const scan=async(extra:object={})=>{const response=await request('POST',`/api/documents/${doc.id}/scan`,{version:doc.version,...extra});assert.equal(response.statusCode,200,response.body);doc=response.json();};
 reply({...empty,amount:'82.00',lines:[{...line,quantity:'4029920'}]});await scan();
 reply({...empty,amount:'118.00',description:'Corrected by scan',lines:[line]});await scan();
 assert.equal(doc.draft.amount,'118.00','a corrected scan must replace an earlier machine value');
 assert.equal(doc.draft.lines[0].quantity,'2');
 const saved=await request('PATCH',`/api/documents/${doc.id}`,{version:doc.version,draft:{...doc.draft,amount:null,description:'Reviewed by human',lines:[{...doc.draft.lines[0],quantity:'3'}]}});
 assert.equal(saved.statusCode,200,saved.body);doc=saved.json();
 reply({...empty,amount:'236.00',description:'Machine description',lines:[{...line,quantity:'4'}]});await scan();
 assert.equal(doc.draft.amount,null,'an intentionally cleared field is also a human correction');assert.equal(doc.draft.description,'Reviewed by human');assert.equal(doc.draft.lines[0].quantity,'3');
 await scan({replaceExisting:true});assert.equal(doc.draft.amount,'236.00');assert.equal(doc.draft.description,'Machine description');assert.equal(doc.draft.lines[0].quantity,'4');
 assert.equal((await request('GET','/api/expenses')).json().count,0,'scanning never posts money');
}));

test('matching uses exact variant attributes and leaves ambiguous or contradictory products unselected',async()=>controlled(async({request},reply)=>{
 const supplier=(await request('POST','/api/suppliers',{name:'Audit supplier'})).json();
 const create=async(flavour:string,packSize:string)=>{const response=await request('POST','/api/products',{name:line.description,productType:line.productType,brand:line.brand,flavour,packSize,unit:line.unit,supplierId:supplier.id,unitPrice:'59'});assert.equal(response.statusCode,201,response.body);return response.json();};
 const wrong=await create('Chocolate','500 ml'),right=await create('Vanilla','1 L');assert.notEqual(wrong.id,right.id);
 let doc=await upload(request);
 const scan=async(item:object)=>{reply({...empty,lines:[item]});const response=await request('POST',`/api/documents/${doc.id}/scan`,{version:doc.version});assert.equal(response.statusCode,200,response.body);doc=response.json();};
 await scan(line);assert.equal(doc.draft.lines[0].productId,right.id,'a same-name first row is not an exact variant match');
 await scan({...line,flavour:null,packSize:null});assert.equal(doc.draft.lines[0].productId,null,'multiple possible variants need human selection');
 await scan({...line,flavour:'Strawberry'});assert.equal(doc.draft.lines[0].productId,null,'conflicting attributes must never auto-select');
}));

test('scan surfaces a quantity that looks like an HSN code and a contradictory item total',async()=>controlled(async({request},reply)=>{
 const doc=await upload(request);reply({...empty,amount:'82.00',lines:[{...line,quantity:'04029920',unitPrice:'5',evidence:'HSN 04029920 Qty 48 Rate 137.50 GST 5%'}]});
 const response=await request('POST',`/api/documents/${doc.id}/scan`,{version:doc.version});assert.equal(response.statusCode,200,response.body);
 assert.ok(response.json().warnings.some((warning:string)=>/HSN/.test(warning)),'machine-readable numbers are not necessarily quantities');assert.ok(response.json().warnings.some((warning:string)=>/Item costs total/.test(warning)));
}));
