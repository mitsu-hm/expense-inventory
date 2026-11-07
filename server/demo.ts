import { randomUUID } from 'node:crypto';
import type { Store, Row } from './store.js';
import { cents, today } from './domain.js';
import type { Settings } from '../shared/types.js';
export function seedExpenses(store:Store,user:Row,settings:Settings,now:number) {
 if(store.one('SELECT user_id FROM demo_seeds WHERE user_id=?',user.id))return;
 const fixtures=[['Nila Packaging','1240.50','UPI','Packaging',0],['Cedar Market Supplies','3850.00','Card','Stock purchase',0],['Meadow Chai Co.','280.00','Cash','Refreshments',1],['Sunbeam Logistics','650.00','UPI','Delivery',3],['Orchard Pantry','1925.75','Card','Stock purchase',7],['Willow Paperworks','420.00','Cash','Office',14],['Fern Facilities','2100.00','UPI','Utilities',30],['Maple Beverage Supply','4680.25','Card','Stock purchase',45]] as const;
 store.transaction(()=>{
  fixtures.forEach(([name,value,method,category,offset],index)=>{
   const day=new Date(today(settings.timezone,now)+'T00:00:00Z');day.setUTCDate(day.getUTCDate()-offset);
   store.run('INSERT INTO expenses (id,user_id,space,payment_date,description,amount_cents,method,additional_information,transaction_ref,request_key,tax_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),user.id,'demo',day.toISOString().slice(0,10),name,cents(value),method,`${category} · Fictional demo transaction`,`DEMO-PAY-${index+1}`,`demo-expense-${index+1}`,index%2?'18':'5',now-index,now);
  });
  store.run('INSERT INTO demo_seeds VALUES (?,?)',user.id,now);
 });
}
