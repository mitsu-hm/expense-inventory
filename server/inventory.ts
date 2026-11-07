import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Settings, Product, Purchase, Supplier } from '../shared/types.js';
import { Store, type Row } from './store.js';
import { dateSchema, taxSchema, HttpError, amount, today } from './domain.js';
const text=(max=200)=>z.string().trim().max(max);
export const preciseNumber=z.string().regex(/^\d{1,10}(?:\.\d{1,6})?$/,'Use at most six decimal places').refine(v=>new Decimal(v).gt(0),'Must be greater than zero');
const supplierSchema=z.object({name:text().min(1),contactName:text().default(''),email:z.union([z.literal(''),z.email()]).default(''),address:text(1000).default(''),paymentTerms:text(500).default(''),version:z.number().int().optional()});
const productSchema=z.object({name:text().min(1),productType:text().min(1),brand:text().min(1),flavour:text().default(''),packSize:text().min(1),unit:text(80).min(1),supplierId:text(100).min(1),unitPrice:preciseNumber});
export const purchaseSchema=z.object({supplierId:text(100).min(1),orderedDate:dateSchema,reference:text(100).default(''),requestKey:text(100).min(1),lines:z.array(z.object({productId:text(100).min(1),quantity:preciseNumber,unitPrice:preciseNumber,taxRate:taxSchema.nullable().optional()})).min(1).max(100)});
const receiveSchema=z.object({requestKey:text(100).min(1),lines:z.array(z.object({lineId:text(100).min(1),quantity:preciseNumber})).min(1).max(100)});
const hash=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const decimal=(v:string)=>new Decimal(v);
export class InventoryService {
 constructor(private store:Store,private now:()=>number){}
 private owned(table:'suppliers'|'products'|'purchases',user:Row,space:string,id:string):Row {
  const row=this.store.one(`SELECT * FROM ${table} WHERE id=? AND user_id=? AND space=?`,id,user.id,space);
  if(!row)throw new HttpError(404,`${table.slice(0,-1)} not found in this workspace`);return row;
 }
 supplierView(row:Row):Supplier {return {id:row.id,name:row.name,contactName:row.contact_name,email:row.email,address:row.address,paymentTerms:row.payment_terms,version:row.version,productCount:Number(this.store.one('SELECT count(*) AS count FROM product_suppliers WHERE supplier_id=?',row.id)!.count)};}
 suppliers(user:Row,space:string):Supplier[]{return this.store.all('SELECT * FROM suppliers WHERE user_id=? AND space=? ORDER BY name',user.id,space).map(r=>this.supplierView(r));}
 saveSupplier(user:Row,space:string,input:unknown,id?:string):Supplier {
  const data=supplierSchema.parse(input),old=id?this.owned('suppliers',user,space,id):undefined;
  if(old&&old.version!==data.version)throw new HttpError(409,'Supplier changed in another tab. Reload before editing.');
  if(this.store.one('SELECT id FROM suppliers WHERE user_id=? AND space=? AND lower(name)=lower(?) AND id<>?',user.id,space,data.name,id??''))throw new HttpError(409,'A supplier with this name already exists');
  const recordId=id??randomUUID();
  if(old)this.store.run('UPDATE suppliers SET name=?,contact_name=?,email=?,address=?,payment_terms=?,version=version+1 WHERE id=?',data.name,data.contactName,data.email,data.address,data.paymentTerms,recordId);
  else this.store.run('INSERT INTO suppliers (id,user_id,space,name,contact_name,email,address,payment_terms) VALUES (?,?,?,?,?,?,?,?)',recordId,user.id,space,data.name,data.contactName,data.email,data.address,data.paymentTerms);
  return this.supplierView(this.owned('suppliers',user,space,recordId));
 }
 createProduct(user:Row,space:string,input:unknown):Product {
  const data=productSchema.parse(input);this.owned('suppliers',user,space,data.supplierId);
  const duplicate=this.store.one('SELECT id FROM products WHERE user_id=? AND space=? AND lower(name)=lower(?) AND lower(brand)=lower(?) AND lower(flavour)=lower(?) AND lower(pack_size)=lower(?) AND lower(unit)=lower(?)',user.id,space,data.name,data.brand,data.flavour,data.packSize,data.unit);
  if(duplicate)throw new HttpError(409,'This product variant already exists. Reuse it for another purchase.');
  const id=randomUUID();
  this.store.transaction(()=>{
   this.store.run('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,user.id,space,data.name,data.productType,data.brand,data.flavour,data.packSize,data.unit,data.supplierId,decimal(data.unitPrice).toString());
   this.store.run('INSERT INTO product_suppliers VALUES (?,?)',id,data.supplierId);
  });
  return this.products(user,space).find(p=>p.id===id)!;
 }
 products(user:Row,space:string):Product[]{
  return this.store.all('SELECT p.*,s.name AS supplier_name FROM products p JOIN suppliers s ON s.id=p.supplier_id WHERE p.user_id=? AND p.space=? ORDER BY p.name,p.flavour,p.pack_size',user.id,space).map(row=>{
   const lines=this.store.all('SELECT l.* FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id WHERE p.user_id=? AND p.space=? AND l.product_id=?',user.id,space,row.id);
   const quantity=lines.reduce((n,l)=>n.plus(l.received_quantity),decimal('0'));
   const ordered=lines.reduce((n,l)=>n.plus(decimal(l.quantity).minus(l.received_quantity)),decimal('0'));
   const total=lines.reduce((n,l)=>n.plus(decimal(l.received_quantity).times(l.unit_price).toDecimalPlaces(2)),decimal('0'));
   return {id:row.id,name:row.name,productType:row.product_type,brand:row.brand,flavour:row.flavour,packSize:row.pack_size,unit:row.unit,supplierId:row.supplier_id,supplierName:row.supplier_name,quantity:quantity.toString(),orderedQuantity:ordered.toString(),unitPrice:row.unit_price,totalCost:total.toFixed(2)};
  });
 }
 purchase(user:Row,space:string,id:string):Purchase {
  const row=this.owned('purchases',user,space,id);
  const lines=this.store.all('SELECT l.*,p.name AS product_name FROM purchase_lines l JOIN products p ON p.id=l.product_id WHERE l.purchase_id=? ORDER BY l.rowid',id).map(l=>({id:l.id,productId:l.product_id,productName:l.product_name,quantity:l.quantity,receivedQuantity:l.received_quantity,unitPrice:l.unit_price,taxRate:l.tax_rate,packSize:l.pack_size,unit:l.unit,lineCost:decimal(l.quantity).times(l.unit_price).toFixed(2),receivedCost:decimal(l.received_quantity).times(l.unit_price).toFixed(2)}));
  const paid=this.store.all('SELECT id,amount_cents FROM expenses WHERE user_id=? AND space=? AND purchase_id=?',user.id,space,id);
  const status=lines.every(l=>decimal(l.quantity).eq(l.receivedQuantity))?'received':lines.some(l=>decimal(l.receivedQuantity).gt(0))?'partial':'ordered';
  return {id:row.id,supplierId:row.supplier_id,supplierName:this.owned('suppliers',user,space,row.supplier_id).name,orderedDate:row.ordered_date,reference:row.reference,status,lines,totalCost:lines.reduce((n,l)=>n.plus(l.lineCost),decimal('0')).toFixed(2),paidTotal:paid.reduce((n,p)=>n.plus(amount(p.amount_cents)),decimal('0')).toFixed(2),expenseIds:paid.map(p=>p.id)};
 }
 purchases(user:Row,space:string):Purchase[]{return this.store.all('SELECT id FROM purchases WHERE user_id=? AND space=? ORDER BY ordered_date DESC,created_at DESC,rowid DESC',user.id,space).map(r=>this.purchase(user,space,r.id));}
 createPurchase(user:Row,space:string,input:unknown):Purchase {
  const data=purchaseSchema.parse(input);this.owned('suppliers',user,space,data.supplierId);
  if(new Set(data.lines.map(l=>l.productId)).size!==data.lines.length)throw new HttpError(400,'Use one purchase line per product variant');
  const products=data.lines.map(l=>this.owned('products',user,space,l.productId));
  const requestHash=hash(data);
  const retry=this.store.one('SELECT id,request_hash FROM purchases WHERE user_id=? AND space=? AND request_key=?',user.id,space,data.requestKey);
  if(retry){if(retry.request_hash!==requestHash)throw new HttpError(409,'This order save key was used for different values');return this.purchase(user,space,retry.id);}
  if(data.reference&&this.store.one('SELECT id FROM purchases WHERE user_id=? AND space=? AND supplier_id=? AND lower(reference)=lower(?)',user.id,space,data.supplierId,data.reference))throw new HttpError(409,'This supplier reference already has a purchase record. Link the document to that purchase.','DUPLICATE_PURCHASE');
  const id=randomUUID();
  this.store.transaction(()=>{
   this.store.run('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?)',id,user.id,space,data.supplierId,data.orderedDate,data.reference,data.requestKey,requestHash,this.now());
   data.lines.forEach((line,index)=>{
    this.store.run('INSERT INTO purchase_lines VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),id,line.productId,decimal(line.quantity).toString(),'0',decimal(line.unitPrice).toString(),line.taxRate??null,products[index].pack_size,products[index].unit);
    this.store.run('INSERT OR IGNORE INTO product_suppliers VALUES (?,?)',line.productId,data.supplierId);
    this.store.run('UPDATE products SET unit_price=? WHERE id=?',decimal(line.unitPrice).toString(),line.productId);
   });
   this.store.audit(user.id,space,id,'purchase_ordered',null,data,this.now());
  });
  return this.purchase(user,space,id);
 }
 receive(user:Row,space:string,id:string,input:unknown):Purchase {
  const data=receiveSchema.parse(input),purchase=this.purchase(user,space,id),requestHash=hash({id,...data});
  const retry=this.store.one('SELECT request_hash FROM stock_receipts WHERE user_id=? AND space=? AND request_key=?',user.id,space,data.requestKey);
  if(retry){if(retry.request_hash!==requestHash)throw new HttpError(409,'This receipt save key was used for different values');return purchase;}
  if(new Set(data.lines.map(l=>l.lineId)).size!==data.lines.length)throw new HttpError(400,'A receipt cannot repeat a purchase line');
  const changes=data.lines.map(change=>{
   const line=purchase.lines.find(l=>l.id===change.lineId);if(!line)throw new HttpError(400,'Receipt line does not belong to this purchase');
   const received=decimal(line.receivedQuantity).plus(change.quantity);
   if(received.gt(line.quantity))throw new HttpError(400,`Received quantity exceeds the outstanding order for ${line.productName}`);
   return {...change,received:received.toString()};
  });
  this.store.transaction(()=>{
   const receiptId=randomUUID();
   this.store.run('INSERT INTO stock_receipts (id,purchase_id,user_id,space,request_key,request_hash,received_at) VALUES (?,?,?,?,?,?,?)',receiptId,id,user.id,space,data.requestKey,requestHash,this.now());
   changes.forEach(change=>{
    this.store.run('UPDATE purchase_lines SET received_quantity=? WHERE id=?',change.received,change.lineId);
    this.store.run('INSERT INTO receipt_lines VALUES (?,?,?)',receiptId,change.lineId,decimal(change.quantity).toString());
   });
   this.store.audit(user.id,space,id,'stock_received',purchase,changes,this.now());
  });
  return this.purchase(user,space,id);
 }
 seedDemo(user:Row,settings:Settings) {
  if(this.store.one('SELECT user_id FROM demo_inventory_seeds WHERE user_id=?',user.id))return;
  const at=this.now(),date=today(settings.timezone,at);
  this.store.transaction(()=>{
   const s1=randomUUID(),s2=randomUUID();
   for(const [id,name,contact,email,address,terms] of [[s1,'Maple Beverage Supply','Maya Rao','maya@example.com','12 Demo Market Road, Pune','Net 15'],[s2,'Nila Packaging','Arun Shah','arun@example.com','8 Fictional Trade Lane, Pune','On receipt']])this.store.run('INSERT INTO suppliers (id,user_id,space,name,contact_name,email,address,payment_terms) VALUES (?,?,?,?,?,?,?,?)',id,user.id,'demo',name,contact,email,address,terms);
   const fixtures=[['Wildleaf Lime Fizz','Drink','Wildleaf','Lime','250 ml','bottle',s1,'24.125','48','24'],['Wildleaf Orange Fizz','Drink','Wildleaf','Orange','250 ml','bottle',s1,'25.50','24','0'],['Kraft Carry Bags','Packaging','Nila','','Pack of 50 bags','pack',s2,'112.75','10','10']];
   const orderedId=randomUUID(),receivedId=randomUUID();
   this.store.run('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?)',orderedId,user.id,'demo',s1,date,'DEMO-ORDER-001','demo-order-001','demo',at);
   this.store.run('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?)',receivedId,user.id,'demo',s2,date,'DEMO-BILL-002','demo-order-002','demo',at);
   fixtures.forEach(([name,type,brand,flavour,pack,unit,supplier,price,qty,received],index)=>{
    const id=randomUUID();this.store.run('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,user.id,'demo',name,type,brand,flavour,pack,unit,supplier,price);
    this.store.run('INSERT INTO product_suppliers VALUES (?,?)',id,supplier);
    this.store.run('INSERT INTO purchase_lines VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),index===2?receivedId:orderedId,id,qty,received,price,'18',pack,unit);
   });
   this.store.run('INSERT INTO demo_inventory_seeds VALUES (?,?)',user.id,at);
  });
 }
}
export function registerInventory(app:FastifyInstance,service:InventoryService,ctx:{actor:(r:any)=>Row;space:(r:any)=>string;settings:(u:Row)=>Settings;store:Store;now:()=>number}) {
 const activity=(user:Row)=>ctx.store.run('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE id=?',ctx.now()+ctx.settings(user).reminderMinutes*60000,user.id);
 const scope=(request:any)=>{const user=ctx.actor(request),space=ctx.space(request);if(space==='demo')service.seedDemo(user,ctx.settings(user));return {user,space};};
 app.get('/api/suppliers',async request=>{const {user,space}=scope(request);return {records:service.suppliers(user,space)};});
 app.post('/api/suppliers',async(request,reply)=>{const {user,space}=scope(request);const saved=service.saveSupplier(user,space,request.body);activity(user);reply.code(201);return saved;});
 app.put('/api/suppliers/:id',async request=>{const {user,space}=scope(request);const saved=service.saveSupplier(user,space,request.body,(request.params as any).id);activity(user);return saved;});
 app.get('/api/products',async request=>{const {user,space}=scope(request);return {records:service.products(user,space)};});
 app.post('/api/products',async(request,reply)=>{const {user,space}=scope(request);const saved=service.createProduct(user,space,request.body);activity(user);reply.code(201);return saved;});
 app.get('/api/inventory',async request=>{const {user,space}=scope(request);return {products:service.products(user,space),purchases:service.purchases(user,space)};});
 app.get('/api/purchases',async request=>{const {user,space}=scope(request);return {records:service.purchases(user,space)};});
 app.post('/api/purchases',async(request,reply)=>{const {user,space}=scope(request);const saved=service.createPurchase(user,space,request.body);ctx.store.run('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE id=?',ctx.now()+ctx.settings(user).reminderMinutes*60000,user.id);reply.code(201);return saved;});
 app.post('/api/purchases/:id/receive',async request=>{const {user,space}=scope(request);const saved=service.receive(user,space,(request.params as any).id,request.body);ctx.store.run('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE id=?',ctx.now()+ctx.settings(user).reminderMinutes*60000,user.id);return saved;});
}
