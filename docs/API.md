# Local API contract
The current user prompt supersedes planning-only status and undecided development defaults in PLAN.md/graph.html; preserve those historical planning artifacts. No remote repository, deployment, paid service or purchase is authorized.

All API writes require `x-ledger-request: 1`; sessions use HttpOnly SameSite=Strict cookies. Every business route is scoped to authenticated user and `?space=real|demo` (default real). The fictional demo space is separate from real records. JSON errors: `{error, code?, candidates?}` with meaningful HTTP status. Amounts are decimal strings. Dates are YYYY-MM-DD payment dates.

Stage 1:
- GET /api/session => Session (shared/types.ts); user null when signed out.
- POST /api/register {name,email,password} => Session, starts session. Password min 10 chars.
- POST /api/login {email,password} => Session. POST /api/logout => {ok:true}.
- GET /api/expenses?space=&from=&to=&method=&q= => {records:Expense[],total:string,count:number}; all matching rows, client pagination permitted.
- POST /api/expenses?space= {ExpenseInput} => Expense, status201. requestKey is a stable UUID for a save attempt; duplicates409 {code:'DUPLICATE',candidates:Expense[]}. User may explicitly allow a legitimate repeat with allowDuplicate:true; a repeated transactionRef cannot create a second transaction.
- PUT /api/expenses/:id?space= {ExpenseInput,version} => Expense; stale version409.
- GET /api/expenses/:id/history?space= => {records:[{at,action,before,after}]}.
- GET /api/settings => Settings; PATCH /api/settings accepts timezone, weekStartsOn 0..6, reminderMinutes 1..1440. Currency/reportingDate are deployment defaults, not silent currency conversion.

Branding: shared/config.ts is the central name/tagline source. No frontend secrets. Vite web port5173 proxies /api to API port3001. Local SQLite data/ledger.sqlite.

## Stage 2 inventory and suppliers
All requests scoped ?space=real|demo, writes x-ledger-request:1. Types in shared/types.ts.
- GET /api/suppliers => {records:Supplier[]}. POST /api/suppliers {name,contactName?,email?,address?,paymentTerms?} => Supplier201. PUT /api/suppliers/:id same fields + version => Supplier.
- GET /api/inventory => InventoryData {products:Product[],purchases:Purchase[]}.
- GET /api/products => {records:Product[]}. POST /api/products {name,productType,brand,flavour:'',packSize,unit,supplierId,unitPrice:string} => Product201. Products start with zero received stock. Product identity includes brand/flavour/packSize/unit; no pack conversion.
- GET /api/purchases => {records:Purchase[]}. POST /api/purchases {supplierId,orderedDate:ISO,reference:'',requestKey,lines:[{productId,quantity:string,unitPrice:string,taxRate?:string|null}]} => Purchase201. Creates ORDER only. Paid total stays zero until an expense explicitly links purchaseId. Tax rate is preserved as reference; entered unit prices are not auto-converted for tax.
- POST /api/purchases/:id/receive {requestKey,lines:[{lineId,quantity:string}]} => Purchase. Quantity is increment received NOW; may not exceed remaining. Repeated requestKey idempotent. UI requires deliberate receipt confirmation. Partial receipt supported.
- Existing POST/PUT /api/expenses accepts optional purchaseId; store links a paid expense to purchase, never auto-creates payment from purchase.
- Inventory quantities derive from received purchase lines only; totalCost is sum of each received quantity * its historical unitPrice, rounded to two decimals. unitPrice shown on product is latest recorded purchase price, not retroactive valuation basis. orderedQuantity means outstanding unreceived quantity. Purchase lines preserve original prices and pack/unit labels.
## Stage 5 reminder contract
- GET /api/reminders => {dueAt:number,now:number,intervalMinutes:number} persisted per signed-in user, across real/demo spaces.
- POST /api/reminders/claim {tabId} => {due:boolean,dueAt,now,intervalMinutes}; atomically leases a due reminder to one tab for90seconds; current owner renews by polling. Another tab cannot concurrently claim it.
- POST /api/reminders/dismiss {tabId} postpones dueAt by the configured interval (default120minutes) and clears lease.
- POST /api/reminders/release {tabId} releases only the owner's lease without qualifying activity.
- Changing reminderMinutes via PATCH /api/settings reschedules the next reminder using the new interval; no other setting changes reset inactivity.
- UI keeps reminder watcher mounted while signed in and checks visible pages every5seconds. Hidden/closing pages release their lease. Cross-tab messages dismiss/hide promptly; server lease is authoritative. Upload/Manual action never destroys existing expense drafts or counts as a successful entry; while user follows the action, popup presentation is locally deferred for two minutes, without resetting server inactivity. Dismiss is the two-hour postpone action. Actual uploads or explicitly saved financial/inventory entries reset the server timer.

## Stage 4 documents contract
- GET /api/documents?space= => {records:DocumentRecord[],ai:{configured,provider}}. No provider returns setup-required, never invented extraction.
- POST /api/documents?space= {name,mimeType,base64,kind:'bill'|'payment_receipt'|'order'} => DocumentRecord201, exact duplicate200 { ...DocumentRecord,duplicate:true }; PNG/JPEG/WebP at most5MB and40millionpixels. Successful persisted uploads reset reminder timer. File bytes stay private in local database.
- GET /api/documents/:id?space= => DocumentRecord. GET /api/documents/:id/image?space= => private image.
- PATCH /api/documents/:id?space= {version,draft:DocumentDraft,kind?} => DocumentRecord. All unknown fields nullable; user drafts may retain invalid inputs for correction; warnings reflect missing fields, product match uncertainty and inconsistent totals. Status stays draft, no expenses/stock.
- POST /api/documents/:id/scan?space= {version} => DocumentRecord;503 AI_SETUP_REQUIRED when no provider. Optional server-only Ollama adapter, no default model or API key.
- POST /api/documents/:id/confirm?space= {version,reviewed:true,acknowledgeWarnings:true,target:'expense'|'purchase'|'existingExpense'|'existingPurchase',requestKey,allowDuplicate?,existingExpenseId?,existingPurchaseId?,expense?:ExpenseInput,purchase?:purchaseSchema} => {document:DocumentRecord,expense?:Expense,purchase?:Purchase}. Must PATCH editable draft first; confirm validates exact submitted reviewed fields. New expense needs payment date/payee/amount/Cash|UPI|Card; order document cannot create a paid expense. New purchase always ORDER only, never received stock; supplier and existing product matches require manual selection. Existing expense links a bill/receipt without adding another payment. Duplicate warning cannot be bypassed by changing document source. Repeating confirmation returns current link only and never double-posts.
- Frontend Documents({space,session,onSaved?}) list/upload/review component. show original image next to editable fields. Buttons 'Save draft', 'Scan document', 'Confirm reviewed record'. Kind order targets purchase only. Existing-target selectors from GET /expenses and /purchases. All fields nullable/blank until actually present/entered. Brand/flavour/packSize/unit remain separate. Creating missing products/suppliers happens in their own pages; draft persists first. Never describe manual transcription as AI extraction.

## Stage 3 reporting contract
- GET /api/reports?space=real|demo&period=daily|weekly|monthly&date=YYYY-MM-DD&from=&to=&method=&q= => ExpenseReport (shared/types.ts).
- Default period monthly and date server today in user timezone. daily is selected date; weekly uses configured calendar start (default Monday); monthly calendar boundaries. from/to optionally narrow the selected period; effective boundaries remain within it and must intersect. method optional Cash/UPI/Card; q optional search.
- Report returns all matching paid expenses, canonical decimal total, count and daily buckets within effective selected range. No previous-period comparison fields. Only expenses enter totals; purchases/doc drafts do not.
- GET /api/reports/export with identical query => XLSX download. Sheets Summary, Expenses, Inventory, Suppliers. Expenses columns Payment date, Description / payee, Amount, Payment method, Additional information, Transaction reference, Tax rate (%), Linked purchase. Summary labels in A values B; Total recorded expenses is authoritative numeric total. All rows exported regardless visible page; tax percentages retained, never percentage-change columns. Inventory/Suppliers sheets are same-workspace snapshot (not filtered by expense payment date), explicitly labelled.
Frontend stage2: export Inventory({space,session,onRecordPayment?}) and Suppliers({space}) components as named exports in src/Inventory.tsx and src/Suppliers.tsx. onRecordPayment(purchase:Purchase) opens the parent's manual expense form with explicit purchase link. Existing inventory-app integration pending; no fake connector.

