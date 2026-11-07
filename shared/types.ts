export type PaymentMethod = 'Cash' | 'UPI' | 'Card';
export type Space = 'real' | 'demo';
export interface User { id: string; name: string; email: string }
export interface Settings { currency: string; timezone: string; weekStartsOn: number; reminderMinutes: number; reportingDate: string }
export interface Session { user: User | null; settings: Settings; today: string; brand: {name: string; tagline: string}; ai: {configured: boolean; provider: string | null} }
export interface Expense { id: string; paymentDate: string; description: string; amount: string; method: PaymentMethod; additionalInformation: string; transactionRef: string; purchaseId: string | null; version: number; documentsCount: number; taxRate: string | null }
export interface ExpenseInput { paymentDate: string; description: string; amount: string; method: PaymentMethod | ''; additionalInformation: string; transactionRef: string; requestKey: string; allowDuplicate?: boolean; version?: number; purchaseId?: string | null; taxRate?: string | null }
export interface ExpenseList { records: Expense[]; total: string; count: number }

export interface Supplier { id:string; name:string; contactName:string; email:string; address:string; paymentTerms:string; version:number; productCount:number }
export interface Product { id:string; name:string; productType:string; brand:string; flavour:string; packSize:string; unit:string; supplierId:string; supplierName:string; quantity:string; orderedQuantity:string; unitPrice:string; totalCost:string }
export interface PurchaseLine { id:string; productId:string; productName:string; quantity:string; receivedQuantity:string; unitPrice:string; taxRate:string|null; packSize:string; unit:string; lineCost:string; receivedCost:string }
export interface Purchase { id:string; supplierId:string; supplierName:string; orderedDate:string; reference:string; status:'ordered'|'partial'|'received'; lines:PurchaseLine[]; totalCost:string; paidTotal:string; expenseIds:string[] }
export interface InventoryData { products:Product[]; purchases:Purchase[] }
export type DocumentKind = 'bill' | 'payment_receipt' | 'order';
export interface DraftLine { description:string|null; productId:string|null; productType:string|null; brand:string|null; flavour:string|null; packSize:string|null; unit:string|null; quantity:string|null; unitPrice:string|null; taxRate:string|null; evidence:string|null }
export interface DocumentDraft { paymentDate:string|null; orderedDate:string|null; description:string|null; amount:string|null; method:PaymentMethod|null; additionalInformation:string; transactionRef:string|null; supplierId:string|null; supplierName:string|null; lines:DraftLine[] }
export interface DocumentRecord { id:string; name:string; kind:DocumentKind; status:'draft'|'confirmed'; processing:string; lastError:string|null; draft:DocumentDraft; warnings:string[]; duplicateCandidates:Expense[]; version:number; imageUrl:string; expenseId:string|null; purchaseId:string|null; createdAt:number; scanSummary?:{updatedFields:string[];preservedFields:string[]} }
export interface ExpenseReport extends ExpenseList { period:'daily'|'weekly'|'monthly'; date:string; from:string; to:string; periodFrom:string; periodTo:string; method:string; q:string; currency:string; timezone:string; byDay:{date:string;total:string;count:number}[] }

