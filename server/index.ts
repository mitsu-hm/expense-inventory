import { existsSync } from 'node:fs';
if(existsSync('.env')) process.loadEnvFile('.env');
import { buildApp } from './app.js';
import { BRAND } from '../shared/config.js';
const app=await buildApp();
try { await app.listen({port:Number(process.env.PORT??3001),host:process.env.HOST??'127.0.0.1'});console.log(`${BRAND.name} API ready on http://127.0.0.1:${process.env.PORT??3001}`); }
catch(error){console.error(error);await app.close();process.exit(1);}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
