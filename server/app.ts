import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { BRAND, DEFAULTS } from '../shared/config.js';
import type { Settings } from '../shared/types.js';
import { Store, type Row } from './store.js';
import { seedExpenses } from './demo.js';
import { InventoryService, registerInventory } from './inventory.js';
import { registerReports } from './reports.js';
import { registerDocuments } from './documents.js';
import { aiStatus } from './ai.js';
import { registerReminders } from './reminders.js';
import { amount, cents, dateSchema, expenseSchema, expenseView, HttpError, sumAmounts, today } from './domain.js';
export interface AppOptions { dbPath?:string; now?:()=>number }
export async function buildApp(options:AppOptions={}) {
 const app=Fastify({logger:false,bodyLimit:8*1024*1024});
 const store=new Store(options.dbPath??process.env.DB_PATH??resolve('data/ledger.sqlite'));
 const now=options.now??Date.now;
 const inventory=new InventoryService(store,now);
 await app.register(cookie);
 const settings=(user?:Row):Settings=>({...DEFAULTS,...(user?JSON.parse(user.settings):{})});
 const actor=(request:any):Row=>{if(!request.actor)throw new HttpError(401,'Please sign in to continue');return request.actor;};
 const space=(request:any):string=>z.enum(['real','demo']).parse(request.query?.space??'real');
 const authPaths=new Set(['/api/session','/api/register','/api/login','/api/health']);
 app.decorateRequest('actor',null);
 app.addHook('onRequest',async(request,reply)=>{
   reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin').header('X-Frame-Options','DENY');
   if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
   if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
     if(request.headers['x-ledger-request']!=='1')throw new HttpError(403,'Missing request protection header');
     const origin=request.headers.origin;
     const origins=(process.env.LOCAL_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001,http://127.0.0.1:3101,http://localhost:3101').split(',');
     if(origin && !origins.includes(origin))throw new HttpError(403,'Request origin is not allowed');
   }
   const token=request.cookies.ledger_session;
   if(token)(request as any).actor=store.one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',createHash('sha256').update(token).digest('hex'),now())??null;
   if(request.url.startsWith('/api/') && !authPaths.has(request.url.split('?')[0]))actor(request);
 });
 app.setErrorHandler((error:any,_request,reply)=>{
   if(error instanceof ZodError)return reply.code(400).send({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '),code:'VALIDATION'});
   if(error instanceof HttpError)return reply.code(error.status).send({error:error.message,code:error.code,candidates:error.candidates});
   if(error.statusCode && error.statusCode<500)return reply.code(error.statusCode).send({error:error.message});
   console.error(error);
   return reply.code(500).send({error:'The operation could not be completed. Please try again.'});
 });
 const session=(user?:Row)=>({user:user?{id:user.id,name:user.name,email:user.email}:null,settings:settings(user),brand:BRAND,today:today(settings(user).timezone,now()),ai:aiStatus()});
 const startSession=(user:Row,reply:any)=>{
   const token=randomBytes(32).toString('base64url');
   store.run('INSERT INTO sessions VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),user.id,now()+7*24*60*60*1000);
   reply.setCookie('ledger_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='1',path:'/',maxAge:7*24*60*60});
 };
 const attempts=new Map<string,{count:number;until:number}>();
 const authLimit=(ip:string)=>{let a=attempts.get(ip);if(!a||a.until<now()){a={count:0,until:now()+60000};attempts.set(ip,a);}if(++a.count>15)throw new HttpError(429,'Too many sign-in attempts. Try again in a minute.');};
 app.get('/api/health',async()=>({ok:true}));
 app.get('/api/session',async(request)=>session((request as any).actor??undefined));
 const loginSchema=z.object({email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(10).max(128)});
 app.post('/api/register',async(request,reply)=>{
   authLimit(request.ip);
   const data=loginSchema.extend({name:z.string().trim().min(1).max(80)}).parse(request.body);
   if(store.one('SELECT id FROM users WHERE email=?',data.email))throw new HttpError(409,'This email is already registered. Please sign in.');
   const salt=randomBytes(16).toString('hex');const id=randomUUID();
   store.run('INSERT INTO users (id,email,name,password_hash,salt,settings,remind_at) VALUES (?,?,?,?,?,?,?)',id,data.email,data.name,scryptSync(data.password,salt,64).toString('hex'),salt,JSON.stringify(DEFAULTS),now()+DEFAULTS.reminderMinutes*60000);
   const user=store.one('SELECT * FROM users WHERE id=?',id)!;startSession(user,reply);reply.code(201);return session(user);
 });
 app.post('/api/login',async(request,reply)=>{
   authLimit(request.ip);const data=loginSchema.parse(request.body);
   const user=store.one('SELECT * FROM users WHERE email=?',data.email);
   const hash=scryptSync(data.password,user?.salt??'invalid-user-salt',64);
   if(!user || !timingSafeEqual(hash,Buffer.from(user.password_hash,'hex')))throw new HttpError(401,'Email or password is incorrect');
   startSession(user,reply);return session(user);
 });
 app.post('/api/logout',async(request,reply)=>{
   store.run('DELETE FROM sessions WHERE token_hash=?',createHash('sha256').update(request.cookies.ledger_session??'').digest('hex'));
   reply.clearCookie('ledger_session',{path:'/'});return {ok:true};
 });
 app.get('/api/settings',async(request)=>settings(actor(request)));
 app.patch('/api/settings',async(request)=>{
   const data=z.object({timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Use a valid IANA timezone').optional(),weekStartsOn:z.number().int().min(0).max(6).optional(),reminderMinutes:z.number().int().min(1).max(1440).optional()}).parse(request.body);
   const user=actor(request);const updated={...settings(user),...data};
   store.run('UPDATE users SET settings=? WHERE id=?',JSON.stringify(updated),user.id);
   if(data.reminderMinutes!==undefined&&data.reminderMinutes!==settings(user).reminderMinutes)store.run('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE id=?',now()+updated.reminderMinutes*60000,user.id);
   return updated;
 });
 const listExpenses=(user:Row,scope:string,query:any)=>{
   if(scope==='demo')seedExpenses(store,user,settings(user),now());
   const from=query.from?dateSchema.parse(query.from):null;const to=query.to?dateSchema.parse(query.to):null;
   if(from&&to&&from>to)throw new HttpError(400,'Start date must not be after end date');
   const method=query.method?z.enum(['Cash','UPI','Card']).parse(query.method):null;
   const q=z.string().max(200).parse(query.q??'').toLowerCase();
   const records=store.all('SELECT e.*,(SELECT count(*) FROM documents d WHERE d.expense_id=e.id AND d.user_id=e.user_id AND d.space=e.space) AS documents_count FROM expenses e WHERE e.user_id=? AND e.space=? ORDER BY e.payment_date DESC,e.created_at DESC',user.id,scope).map(expenseView).filter(r=>(!from||r.paymentDate>=from)&&(!to||r.paymentDate<=to)&&(!method||r.method===method)&&(!q||`${r.description} ${r.additionalInformation} ${r.transactionRef}`.toLowerCase().includes(q)));
   return {records,total:sumAmounts(records),count:records.length};
 };
 const saveExpense=(user:Row,scope:string,input:unknown,id?:string)=>{
   const data=expenseSchema.parse(input);const value=cents(data.amount);
   const old=id?store.one('SELECT * FROM expenses WHERE id=? AND user_id=? AND space=?',id,user.id,scope):undefined;
   if(id&&!old)throw new HttpError(404,'Expense not found');
   const purchaseId=data.purchaseId===undefined?(old?.purchase_id??null):data.purchaseId;
   const taxRate=data.taxRate===undefined?(old?.tax_rate??null):data.taxRate;
   if(purchaseId)inventory.purchase(user,scope,purchaseId);
   if(old&&data.version!==old.version)throw new HttpError(409,'This expense changed in another tab. Reload before editing.','STALE_VERSION');
   if(!id){
     const retry=store.one('SELECT * FROM expenses WHERE user_id=? AND space=? AND request_key=?',user.id,scope,data.requestKey);
     if(retry){if(retry.payment_date!==data.paymentDate||retry.amount_cents!==value||retry.description!==data.description||retry.method!==data.method)throw new HttpError(409,'This save key was already used for another entry. Reopen the form.');return expenseView(retry);}
   }
   const reference=data.transactionRef?store.one('SELECT * FROM expenses WHERE user_id=? AND space=? AND lower(transaction_ref)=lower(?) AND id<>?',user.id,scope,data.transactionRef,id??''):undefined;
   const candidates=reference?[reference]:store.all('SELECT * FROM expenses WHERE user_id=? AND space=? AND payment_date=? AND amount_cents=? AND lower(description)=lower(?) AND method=? AND id<>?',user.id,scope,data.paymentDate,value,data.description,data.method,id??'');
   if(reference||(!id&&!data.allowDuplicate&&candidates.length))throw new HttpError(409,'Possible duplicate: review the existing transaction instead of counting its bill and payment receipt twice.','DUPLICATE',candidates.map(expenseView));
   return store.transaction(()=>{
     const recordId=id??randomUUID();const at=now();
     if(old)store.run('UPDATE expenses SET payment_date=?,description=?,amount_cents=?,method=?,additional_information=?,transaction_ref=?,tax_rate=?,purchase_id=?,version=version+1,updated_at=? WHERE id=?',data.paymentDate,data.description,value,data.method,data.additionalInformation,data.transactionRef,taxRate,purchaseId,at,recordId);
     else store.run('INSERT INTO expenses (id,user_id,space,payment_date,description,amount_cents,method,additional_information,transaction_ref,request_key,purchase_id,tax_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',recordId,user.id,scope,data.paymentDate,data.description,value,data.method,data.additionalInformation,data.transactionRef,data.requestKey,purchaseId,taxRate,at,at);
     const saved=expenseView(store.one('SELECT * FROM expenses WHERE id=?',recordId)!);
     store.audit(user.id,scope,recordId,old?'corrected':'created',old?expenseView(old):null,saved,at);
     store.run('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE id=?',at+settings(user).reminderMinutes*60000,user.id);
     return saved;
   });
 };
 app.get('/api/expenses',async(request)=>listExpenses(actor(request),space(request),request.query));
 app.post('/api/expenses',async(request,reply)=>{const value=saveExpense(actor(request),space(request),request.body);reply.code(201);return value;});
 app.put('/api/expenses/:id',async(request)=>saveExpense(actor(request),space(request),request.body,(request.params as any).id));
 app.get('/api/expenses/:id/history',async(request)=>{
   const user=actor(request),scope=space(request),id=(request.params as any).id;
   if(!store.one('SELECT id FROM expenses WHERE id=? AND user_id=? AND space=?',id,user.id,scope))throw new HttpError(404,'Expense not found');
   return {records:store.all('SELECT * FROM audit_events WHERE user_id=? AND space=? AND record_id=? ORDER BY at,id',user.id,scope,id).map(r=>({at:r.at,action:r.action,before:r.before_json?JSON.parse(r.before_json):null,after:r.after_json?JSON.parse(r.after_json):null}))};
 });
 registerInventory(app,inventory,{actor,space,settings,store,now});
 registerReports(app,{actor,space,settings,now,inventory,listExpenses});
 registerDocuments(app,{store,inventory,actor,space,settings,now,saveExpense});
 registerReminders(app,{store,actor,settings,now});
 app.addHook('onClose',async()=>store.close());
 if(existsSync(resolve('dist/index.html'))){
   await app.register(fastifyStatic,{root:resolve('dist'),prefix:'/'});
   app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:'Endpoint not found'}):reply.sendFile('index.html'));
 }
 return app;
}
