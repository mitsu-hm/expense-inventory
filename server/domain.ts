import { Decimal } from 'decimal.js';
import { z } from 'zod';
import type { Expense } from '../shared/types.js';
import type { Row } from './store.js';
export class HttpError extends Error {
  constructor(public status:number,message:string,public code?:string,public candidates?:unknown[]){super(message);}
}
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10)===value;
},'Enter a real calendar date');
export const moneySchema=z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/,'Use a positive amount with at most two decimal places').refine(v=>new Decimal(v).gt(0),'Amount must be greater than zero');
export const taxSchema=z.string().regex(/^\d{1,3}(?:\.\d{1,6})?$/).refine(v=>new Decimal(v).lte(100),'Tax rate must be between zero and 100');
export const expenseSchema=z.object({paymentDate:dateSchema,description:z.string().trim().min(1).max(200),amount:moneySchema,method:z.enum(['Cash','UPI','Card']),additionalInformation:z.string().trim().max(2000).default(''),transactionRef:z.string().trim().max(100).default(''),requestKey:z.string().min(1).max(100),allowDuplicate:z.boolean().default(false),version:z.number().int().positive().optional(),purchaseId:z.string().max(100).nullable().optional(),taxRate:taxSchema.nullable().optional()});
export function cents(value:string):number {return new Decimal(value).times(100).toNumber();}
export function amount(value:number):string {return new Decimal(value).div(100).toFixed(2);}
export function sumAmounts(records:Expense[]):string {return records.reduce((total,r)=>total.plus(r.amount),new Decimal(0)).toFixed(2);}
export function expenseView(r:Row):Expense {return {id:r.id,paymentDate:r.payment_date,description:r.description,amount:amount(r.amount_cents),method:r.method,additionalInformation:r.additional_information,transactionRef:r.transaction_ref,purchaseId:r.purchase_id,version:r.version,documentsCount:r.documents_count??0,taxRate:r.tax_rate};}
export function today(timezone:string,now=Date.now()):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
