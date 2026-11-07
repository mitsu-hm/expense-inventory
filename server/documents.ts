import { createHash, randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import sharp from 'sharp';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DocumentDraft, DocumentRecord, Expense, Settings } from '../shared/types.js';
import { Store, type Row } from './store.js';
import { expenseView, cents, dateSchema, moneySchema, HttpError } from './domain.js';
import { InventoryService, preciseNumber } from './inventory.js';
import { aiStatus, extractImage, saveFeedback } from './ai.js';
const nullable=z.string().max(2000).nullable();
const kindSchema=z.enum(['bill','payment_receipt','order']);
export const draftSchema=z.object({paymentDate:nullable,orderedDate:nullable,description:nullable,amount:nullable,method:z.enum(['Cash','UPI','Card']).nullable(),additionalInformation:z.string().max(2000),transactionRef:nullable,supplierId:nullable,supplierName:nullable,lines:z.array(z.object({description:nullable,productId:nullable,productType:nullable,brand:nullable,flavour:nullable,packSize:nullable,unit:nullable,quantity:nullable,unitPrice:nullable,taxRate:nullable,evidence:nullable})).max(100)});
const blankDraft=():DocumentDraft=>({paymentDate:null,orderedDate:null,description:null,amount:null,method:null,additionalInformation:'',transactionRef:null,supplierId:null,supplierName:null,lines:[]});
interface Context { store:Store;inventory:InventoryService;actor:(r:any)=>Row;space:(r:any)=>string;settings:(u:Row)=>Settings;now:()=>number;saveExpense:(u:Row,s:string,input:unknown,id?:string)=>Expense }
export function registerDocuments(app:FastifyInstance,ctx:Context) {
 const {store,inventory,now}=ctx;
 const owned=(user:Row,space:string,id:string)=>{const row=store.one('SELECT * FROM documents WHERE id=? AND user_id=? AND space=?',id,user.id,space);if(!row)throw new HttpError(404,'Document not found');return row;};
 const candidates=(user:Row,space:string,draft:DocumentDraft):Expense[]=>{
  const reference=draft.transactionRef?.trim();
  const validAmount=moneySchema.safeParse(draft.amount);const validDate=dateSchema.safeParse(draft.paymentDate);
  const matches:Expense[]=[];
  if(reference)matches.push(...store.all('SELECT * FROM expenses WHERE user_id=? AND space=? AND lower(transaction_ref)=lower(?)',user.id,space,reference).map(expenseView));
  if(validAmount.success&&validDate.success)matches.push(...store.all('SELECT * FROM expenses WHERE user_id=? AND space=? AND payment_date=? AND amount_cents=?',user.id,space,validDate.data,cents(validAmount.data)).map(expenseView));
  return [...new Map(matches.map(record=>[record.id,record])).values()];
 };
 const warnings=(row:Row):string[]=>{
  const draft=JSON.parse(row.draft_json) as DocumentDraft,result:string[]=[];
  if(row.kind!=='order'){
   if(!dateSchema.safeParse(draft.paymentDate).success)result.push('Missing or invalid payment date. A bill date alone does not establish payment.');
   if(!draft.description?.trim())result.push('Missing description/payee.');
   if(!moneySchema.safeParse(draft.amount).success)result.push('Missing or invalid paid amount.');
   if(!draft.method)result.push('Payment method not identified. Select Cash, UPI or Card manually; do not guess.');
  }
  if(row.kind!=='payment_receipt'){
   if(!draft.lines.length)result.push('No item lines are available. A purchase needs manually verified products, quantities and prices.');
   draft.lines.forEach((line,index)=>{
    if(!line.productId)result.push(`Line ${index+1}: uncertain product match. Select and verify brand, flavour, pack size and unit.`);
    if(!preciseNumber.safeParse(line.quantity).success)result.push(`Line ${index+1}: missing or invalid quantity; no pack conversion is inferred.`);
    if(!preciseNumber.safeParse(line.unitPrice).success)result.push(`Line ${index+1}: missing or invalid unit price.`);
    if(line.productId){const p=store.one('SELECT * FROM products WHERE id=? AND user_id=? AND space=?',line.productId,row.user_id,row.space);if(!p)result.push(`Line ${index+1}: product is not available in this workspace.`);else for(const [field,column] of [['brand','brand'],['flavour','flavour'],['packSize','pack_size'],['unit','unit']] as const){const value=line[field];if(value&&value.trim().toLowerCase()!==String(p[column]).trim().toLowerCase())result.push(`Line ${index+1}: document ${field} differs from selected product; verify this variant.`);}}
   });
   if(draft.amount&&moneySchema.safeParse(draft.amount).success&&draft.lines.length&&draft.lines.every(l=>preciseNumber.safeParse(l.quantity).success&&preciseNumber.safeParse(l.unitPrice).success)){
    const subtotal=draft.lines.reduce((n,l)=>n.plus(new Decimal(l.quantity!).times(l.unitPrice!).toDecimalPlaces(2)),new Decimal(0));
    if(!subtotal.eq(draft.amount))result.push(`Item costs total ${subtotal.toFixed(2)}, while the document total is ${draft.amount}. Check taxes, fees and discounts before confirming.`);
   }
  }
  if(row.extracted_json){const extracted=JSON.parse(row.extracted_json);if(Array.isArray(extracted.warnings))result.push(...extracted.warnings.map(String));}
  return [...new Set(result)];
 };
 const view=(row:Row):DocumentRecord=>({id:row.id,name:row.name,kind:row.kind,status:row.status,processing:row.processing,lastError:row.last_error,draft:JSON.parse(row.draft_json),warnings:warnings(row),duplicateCandidates:candidates({id:row.user_id},row.space,JSON.parse(row.draft_json)),version:row.version,imageUrl:`/api/documents/${row.id}/image?space=${row.space}`,expenseId:row.expense_id,purchaseId:row.purchase_id,createdAt:row.created_at});
 const activity=(user:Row)=>store.run('UPDATE users SET remind_at=?,reminder_holder=NULL,reminder_lease=0 WHERE id=?',now()+ctx.settings(user).reminderMinutes*60000,user.id);
 app.get('/api/documents',async request=>{const user=ctx.actor(request),space=ctx.space(request);return {records:store.all('SELECT * FROM documents WHERE user_id=? AND space=? ORDER BY created_at DESC,rowid DESC',user.id,space).map(view),ai:aiStatus()};});
 app.post('/api/documents',async(request,reply)=>{
  const user=ctx.actor(request),space=ctx.space(request);
  const data=z.object({name:z.string().trim().min(1).max(200),mimeType:z.enum(['image/png','image/jpeg','image/webp']),base64:z.string().max(7*1024*1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),kind:kindSchema}).parse(request.body);
  const bytes=Buffer.from(data.base64,'base64');if(bytes.length>5*1024*1024||!bytes.length)throw new HttpError(400,'Use an image up to 5 MB');
  try{const metadata=await sharp(bytes,{limitInputPixels:40000000}).metadata();const expected={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'}[data.mimeType];if(metadata.format!==expected||!metadata.width||!metadata.height||metadata.width*metadata.height>40000000||(metadata.pages??1)>1)throw new Error('Invalid image');}catch{throw new HttpError(400,'The file is not a valid supported single image. Use PNG, JPEG or WebP up to 40 megapixels.');}
  const hash=createHash('sha256').update(bytes).digest('hex');const existing=store.one('SELECT * FROM documents WHERE user_id=? AND space=? AND sha256=?',user.id,space,hash);
  if(existing){activity(user);return {...view(existing),duplicate:true};}
  const id=randomUUID(),at=now();
  store.run('INSERT INTO documents (id,user_id,space,kind,name,mime_type,content,sha256,processing,draft_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,user.id,space,data.kind,data.name,data.mimeType,bytes,hash,aiStatus().configured?'manual':'setup_required',JSON.stringify(blankDraft()),at,at);
  activity(user);reply.code(201);return view(owned(user,space,id));
 });
 app.get('/api/documents/:id',async request=>view(owned(ctx.actor(request),ctx.space(request),(request.params as any).id)));
 app.get('/api/documents/:id/image',async(request,reply)=>{const row=owned(ctx.actor(request),ctx.space(request),(request.params as any).id);reply.header('Content-Type',row.mime_type).header('Content-Disposition','inline').header('Content-Security-Policy',"default-src 'none'; sandbox");return reply.send(Buffer.from(row.content));});
 app.patch('/api/documents/:id',async request=>{
  const user=ctx.actor(request),space=ctx.space(request),row=owned(user,space,(request.params as any).id);
  const data=z.object({version:z.number().int(),draft:draftSchema,kind:kindSchema.optional()}).parse(request.body);
  if(row.status==='confirmed')throw new HttpError(409,'This document is already confirmed. Correct the linked financial record instead.');
  if(row.version!==data.version)throw new HttpError(409,'This draft changed in another tab. Reload it before saving.','STALE_VERSION');
  if(data.draft.supplierId&&!store.one('SELECT id FROM suppliers WHERE id=? AND user_id=? AND space=?',data.draft.supplierId,user.id,space))throw new HttpError(400,'Select a supplier in this workspace');
  for(const line of data.draft.lines)if(line.productId&&!store.one('SELECT id FROM products WHERE id=? AND user_id=? AND space=?',line.productId,user.id,space))throw new HttpError(400,'Select a product in this workspace');
  store.run('UPDATE documents SET draft_json=?,kind=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(data.draft),data.kind??row.kind,now(),row.id);return view(owned(user,space,row.id));
 });
 const scans=new Map<string,number[]>();
 app.post('/api/documents/:id/scan',async request=>{
  const user=ctx.actor(request),space=ctx.space(request),row=owned(user,space,(request.params as any).id);
  const {version,provider}=z.object({version:z.number().int(),provider:z.string().optional()}).parse(request.body);
  if(!aiStatus().configured&&provider!=='free')throw new HttpError(503,'AI scanning requires setup. Enter or review the information manually; no extraction has been simulated.','AI_SETUP_REQUIRED');
  if(row.status==='confirmed'||row.processing==='scanning')throw new HttpError(409,'This document is already confirmed or scanning');
  if(row.version!==version)throw new HttpError(409,'Reload the latest draft before scanning');
  const recent=(scans.get(user.id)??[]).filter(t=>t>now()-60000);if(recent.length>=5)throw new HttpError(429,'Please wait before scanning more documents');scans.set(user.id,[...recent,now()]);
  store.run('UPDATE documents SET processing=?,last_error=NULL WHERE id=?','scanning',row.id);
  try {
   const extracted=await extractImage(Buffer.from(row.content),row.kind,row.mime_type,store,user.id,space,provider),latest=owned(user,space,row.id);
   if(latest.status==='confirmed')throw new HttpError(409,'This document was confirmed while scanning. The saved record is unchanged.');
   const current=JSON.parse(latest.draft_json) as DocumentDraft;
   for(const key of ['paymentDate','orderedDate','description','amount','method','transactionRef','supplierName'] as const)if(!current[key]&&extracted[key]) (current as any)[key]=extracted[key];
   if(!current.additionalInformation)current.additionalInformation=extracted.additionalInformation;
   if(!current.lines.length)current.lines=extracted.lines.map(line=>({...line,productId:null}));
   if(!current.supplierId&&current.supplierName){const match=store.one('SELECT id,name FROM suppliers WHERE user_id=? AND space=? AND lower(name)=lower(?)',user.id,space,current.supplierName.trim());if(match){current.supplierId=match.id;current.supplierName=match.name;}}
   if(current.lines.length){for(const line of current.lines){if(!line.productId&&(line.description||line.brand)){const match=store.one('SELECT id FROM products WHERE user_id=? AND space=? AND (lower(name)=lower(?) OR (lower(brand)=lower(?) AND lower(product_type)=lower(?)))',user.id,space,line.description?.trim()??'',line.brand?.trim()??'',line.productType?.trim()??'');if(match)line.productId=match.id;}}}
   store.run('UPDATE documents SET draft_json=?,extracted_json=?,processing=?,last_error=NULL,version=version+1,updated_at=? WHERE id=?',JSON.stringify(current),JSON.stringify(extracted),'extracted',now(),row.id);
   return view(owned(user,space,row.id));
  }catch(error){const latest=owned(user,space,row.id);if(latest.status==='draft')store.run('UPDATE documents SET processing=?,last_error=?,updated_at=? WHERE id=?','failed','Scanning failed. Your draft is preserved. Retry or use manual review.',now(),row.id);if(error instanceof HttpError)throw error;throw new HttpError(502,'The AI provider is unavailable or timed out. Your draft is preserved; continue manually.');}
 });
 app.post('/api/documents/:id/confirm',async request=>{
  const user=ctx.actor(request),space=ctx.space(request),row=owned(user,space,(request.params as any).id);
  const data=z.object({version:z.number().int(),reviewed:z.literal(true),acknowledgeWarnings:z.boolean().default(false),target:z.enum(['expense','purchase','existingExpense','existingPurchase']),requestKey:z.string().min(1).max(100),allowDuplicate:z.boolean().default(false),existingExpenseId:z.string().optional(),existingPurchaseId:z.string().optional()}).parse(request.body);
  if(row.status==='confirmed')return {document:view(row),expense:row.expense_id?expenseView(store.one('SELECT * FROM expenses WHERE id=?',row.expense_id)!):undefined,purchase:row.purchase_id?inventory.purchase(user,space,row.purchase_id):undefined};
  if(row.version!==data.version)throw new HttpError(409,'Reload the latest document draft before confirming','STALE_VERSION');
  if(warnings(row).length&&!data.acknowledgeWarnings)throw new HttpError(400,'Review and acknowledge the document warnings before confirming');
  if(row.kind==='order'&&(data.target==='expense'||data.target==='existingExpense'))throw new HttpError(400,'An order screenshot is not payment evidence. Save it as an unpaid purchase order.');
  const draft=JSON.parse(row.draft_json) as DocumentDraft;
  return store.transaction(()=>{
   let expense:Expense|undefined,purchase:any;
   if(data.target==='expense'){
    const possible=candidates(user,space,draft);if(possible.length&&!data.allowDuplicate)throw new HttpError(409,'A matching payment already exists. Link this document to it, or explicitly confirm a different legitimate payment.','DUPLICATE',possible);
    expense=ctx.saveExpense(user,space,{paymentDate:draft.paymentDate,description:draft.description,amount:draft.amount,method:draft.method,additionalInformation:draft.additionalInformation,transactionRef:draft.transactionRef??'',requestKey:data.requestKey,allowDuplicate:data.allowDuplicate,purchaseId:data.existingPurchaseId??null});
   }else if(data.target==='purchase'){
    purchase=inventory.createPurchase(user,space,{supplierId:draft.supplierId,orderedDate:draft.orderedDate,reference:draft.transactionRef??'',requestKey:data.requestKey,lines:draft.lines.map(line=>({productId:line.productId,quantity:line.quantity,unitPrice:line.unitPrice,taxRate:line.taxRate}))});
   }else if(data.target==='existingExpense'){
    const existing=store.one('SELECT * FROM expenses WHERE id=? AND user_id=? AND space=?',data.existingExpenseId??'',user.id,space);if(!existing)throw new HttpError(404,'Select an existing payment in this workspace');expense=expenseView(existing);
   }else purchase=inventory.purchase(user,space,data.existingPurchaseId??'');
   const purchaseId=purchase?.id??expense?.purchaseId??null;
   store.run('UPDATE documents SET status=?,expense_id=?,purchase_id=?,confirmed_target=?,version=version+1,updated_at=? WHERE id=?','confirmed',expense?.id??null,purchaseId,data.target,now(),row.id);
   saveFeedback(store,user.id,space,row.id,row.kind,row.extracted_json??JSON.stringify(draft),draft,now());
   store.audit(user.id,space,row.id,'document_confirmed',view(row),{target:data.target,expenseId:expense?.id,purchaseId},now());activity(user);
   return {document:view(owned(user,space,row.id)),expense,purchase};
  });
 });
}
