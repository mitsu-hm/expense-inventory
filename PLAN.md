# Website plan
Status: planning only. No website implementation or publication is authorized.

## Modules
The website includes Expense Tracker and Inventory Management.

## Expense Tracker
Tracks daily expenses. The Add Expense button offers AI-assisted upload and fully manual entry.
AI-assisted upload accepts a bill screenshot or payment receipt. AI extracts expense details and analyzes payment mode.
Users review extracted information and a dropdown for additional information. They can manually correct details, or save correct details directly to daily expense records.
Fully manual entry lets users enter expense details, payment mode, and additional information, then save to daily expense records.
Expense records include date, description/payee, amount, payment method, and additional information. Payment methods are Cash, UPI, and Card.

## Inventory Management
Inventory information may come from an existing inventory app; how that app connects remains unresolved.
Alternatively users upload a bill screenshot. AI scans the bill and identifies items, organized by flavour, brand, pricing, and total quantity.

## Inactivity reminder
Show a popup every two hours if there was no screenshot upload or manual entry during that period.
Exact popup message: "There were no entries found for the last 2 hours so kindly upload the screenshot or manually update the paid bills"
The reminder prompts screenshot upload or manual update of paid bills.

## Open decisions and suggested behaviour
Unresolved: which existing inventory app and whether connection means import or synchronization.
Unresolved: whether reminder activity covers both modules, whether only saved entries count, business hours, and behaviour when the website is closed.
Suggested, not confirmed: reset inactivity timer on a new entry; let users select payment mode when it cannot be identified from a document.
Unresolved: whether one bill upload should update both inventory and expenses.

## Expense reports
This selected-period reporting specification supersedes earlier expense-comparison requirements. Reports show recorded expenses for the selected period only; inter-period comparisons are not part of expense reporting.
The Expense Tracker includes daily, weekly, and monthly expense reports based on saved expense records.
Every report shows its selected reporting period, explicit start/end dates, matching expense records, and total recorded expenses for that selection.
A daily report shows the selected date, its expense entries, their payment methods, additional information, and total amount. Weekly and monthly reports show the corresponding selected dates, records, and totals.

### Expense records, payment methods, and filters
Each expense record shows date, description/payee, amount, payment method, and additional information.
Payment methods are Cash, UPI, and Card. An unfiltered All control is a filter state, not an additional payment method.
Reports provide date and payment-method filters. The record list, displayed total, and Excel export use the same effective reporting dates and active filters.
When date filters narrow the selected period, the effective start/end dates remain visible.
Pagination does not change the total and does not limit an export to the visible page; totals and exports cover all matching records.
Users can select historical reporting dates and access historical expense records.

### Reporting calculations
Period total = sum of recorded expense amounts matching the selected reporting dates and active payment-method filter.
Any optional within-period subtotal uses those same matching records. Monetary calculations use decimal-safe arithmetic and the subsequently approved currency precision.
An empty selection shows no matching records and a zero total in the configured currency.
Only selected-period records and totals feed expense reports; no reference-period metrics, change indicators, comparison arrows, or comparison-based day rankings are included.
This change does not remove tax rates or unrelated percentage fields and does not change inventory cost calculations.

### Dashboard and reporting screens
Expense dashboard cards show selected-period totals and explicit reporting dates, alongside recent expense records and access to historical records.
Retain Add Expense, AI-assisted upload, and fully manual entry.
The reporting screen provides Daily, Weekly, and Monthly selection, explicit start/end dates, date/payment-method filters, a filtered total, the required expense-record fields, historical navigation, and Excel export.
Optional charts, if retained, show recorded amounts within the selected period only and introduce no reference-period series or change metrics.
Loading, empty, and error states must not introduce expense-comparison values or labels.

### Excel expense export
Excel export matches the selected daily, weekly, or monthly reporting period and active date/payment-method filters.
Expense report summary metadata includes report type, selected period, effective start/end dates, active payment-method filter, currency, and timezone once confirmed.
Exported expense records include date, description/payee, amount, payment method, and additional information, plus the total recorded expenses for the exported selection.
The expense portion of the workbook contains a selected-report summary and matching expense records; exporting one report does not implicitly include unrelated periods.
Export includes every matching record regardless of website pagination and uses the same reporting definitions and data selection as the website.
Use readable dates, monetary formatting, filters, and frozen headers. Expense export contains selected-period records and totals only, with no inter-period metrics or comparison-based formulas, indicators, or formatting.
Inventory and Suppliers sheets retain their product-level supplier links, unit prices, quantities, calculated total costs, and existing supplier/demo specifications.

### Historical data and unchanged scope
This revision changes reporting presentation and selection, not underlying transactions. Do not delete, rewrite, reclassify, or change historical transaction dates, amounts, or payment-method values to apply this specification.
Existing historical payment-method values remain intact and accessible, including any legacy values outside the new-entry choices.
No historical-data migration or destructive record update is authorized by this reporting revision.
Inventory, supplier details, AI extraction and human review, the inactivity reminder, tax rates, and unrelated percentages remain unchanged.

### Undecided reporting choices
Undecided: which date governs report inclusion (payment date, bill date, or another recorded expense date).
Undecided: calendar-based versus rolling weeks/months and the day that starts a reporting week.
Undecided: reporting currency, monetary precision, and business timezone defining reporting-day boundaries.
No decision about reference-period selection, percentage baselines, or matched-period comparisons is needed for this scope.

### Reporting development roadmap
Planning only; no implementation, dependency installation, publication, or deployment is authorized.
1. Confirm reporting dates, period boundaries, currency, precision, timezone, and reporting acceptance criteria without defining comparison policies.
2. Retain manual entry and AI review; use Cash, UPI, and Card for new payment-method selections without rewriting legacy records.
3. Implement selected-period reporting, historical navigation, date/payment-method filters, complete matching records, and decimal-safe totals only after implementation approval.
4. Implement Excel export of the same selected records and totals only after implementation approval.
5. Verify date boundaries, filtering, totals, pagination independence, report/export parity, empty states, and historical-data preservation.
Inventory, supplier, AI-review, security, accessibility, and reminder roadmap workstreams are unchanged.

### Reporting acceptance criteria
- Daily, weekly, and monthly reports display their selected start/end dates.
- Expense records expose date, description/payee, amount, payment method, and additional information.
- Cash, UPI, and Card are available payment-method choices; existing historical values are not rewritten.
- Date and payment-method filters select records and totals consistently.
- Totals include every matching record, including records beyond the current page.
- Historical periods and transactions remain accessible and unaltered.
- Excel contains the same matching records, reporting dates, active filters, and total as the selected report.
- Empty selections show an empty record list and a zero total.
- Date-boundary and timezone tests use the subsequently approved reporting rules.
- Expense dashboards, reports, and exports expose selected-period information only, with no inter-period metrics, change indicators, comparison arrows, or comparison-based day rankings.
- Inventory calculations, supplier details, AI review, reminders, tax rates, and unrelated percentage fields are unaffected.

## Product and supplier inventory details
Each inventory product records its product type, flavour where applicable (for example drinks), brand, purchase price per unit, and quantity.
Total product cost is calculated as purchase price per unit multiplied by quantity.
Supplier details are linked to each specific product.
The Excel workbook includes Inventory and Suppliers sheets with product-level supplier links, unit prices, quantities, and calculated total costs.
Demo inventory uses fictional products, brands, quantities, and suppliers. Supplier examples include contact name, example.com email, demo address, and payment terms; these are sample workbook fields, not confirmed website requirements.
