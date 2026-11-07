import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,rm,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';

test('Vite development server denies private database files and backend source',async()=>{
 const name='security-fixture-'+randomUUID()+'.sqlite',path=resolve('data',name);await mkdir(resolve('data'),{recursive:true});await writeFile(path,'SYNTHETIC_PRIVATE_FILE_SENTINEL');
 const server=await createServer({logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
 try {
  const base=server.resolvedUrls!.local[0];
  const fsTarget='@fs'+(path.startsWith('/')?'':'/')+path.replace(/\\/g,'/');
  for(const url of ['data/'+name,fsTarget,'server/app.ts']){
   const response=await fetch(new URL(url,base));assert.equal(response.status,403,'Private development path must be denied: '+url);const body=await response.text();assert.equal(body.includes('SYNTHETIC_PRIVATE_FILE_SENTINEL'),false);
  }
 }finally{await server.close();await rm(path,{force:true});}
});
