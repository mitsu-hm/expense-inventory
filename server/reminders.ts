import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Settings } from '../shared/types.js';
import type { Store, Row } from './store.js';
export function registerReminders(app:FastifyInstance,ctx:{store:Store;actor:(r:any)=>Row;settings:(u:Row)=>Settings;now:()=>number}) {
 const input=z.object({tabId:z.string().min(1).max(100)});
 const state=(user:Row)=>({dueAt:user.remind_at,now:ctx.now(),intervalMinutes:ctx.settings(user).reminderMinutes});
 app.get('/api/reminders',async request=>state(ctx.actor(request)));
 app.post('/api/reminders/claim',async request=>{
  const user=ctx.actor(request),{tabId}=input.parse(request.body);
  return ctx.store.transaction(()=>{
   const current=ctx.store.one('SELECT * FROM users WHERE id=?',user.id)!;const time=ctx.now();
   const due=current.remind_at<=time && (current.reminder_lease<=time||current.reminder_holder===tabId);
   if(due)ctx.store.run('UPDATE users SET reminder_holder=?,reminder_lease=? WHERE id=?',tabId,time+90000,user.id);
   return {...state(current),due};
  });
 });
 app.post('/api/reminders/dismiss',async request=>{
  const user=ctx.actor(request);input.parse(request.body);
  const dueAt=ctx.now()+ctx.settings(user).reminderMinutes*60000;
  ctx.store.run('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE id=?',dueAt,user.id);
  return {...state(user),dueAt};
 });
 app.post('/api/reminders/release',async request=>{
  const user=ctx.actor(request),{tabId}=input.parse(request.body);
  ctx.store.run('UPDATE users SET reminder_holder=NULL,reminder_lease=0 WHERE id=? AND reminder_holder=?',user.id,tabId);
  return {ok:true};
 });
}
