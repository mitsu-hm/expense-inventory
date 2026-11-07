import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Boxes, PackagePlus, Plus, RefreshCw } from 'lucide-react';
import Decimal from 'decimal.js';
import type { InventoryData, Product, Purchase, Session, Space, Supplier } from '../shared/types';
import { api, errorMessage } from './api';
import { Dialog, formatDate, formatMoney, Loading, Notice } from './components';
import './inventory.css';

type Props = { space: Space; session: Session; onRecordPayment?: (purchase: Purchase) => void };
type ProductDraft = { name: string; productType: string; brand: string; flavour: string; packSize: string; unit: string; supplierId: string; unitPrice: string };
type OrderLineDraft = { key: string; productId: string; quantity: string; unitPrice: string; taxRate: string };
type OrderDraft = { supplierId: string; orderedDate: string; reference: string; requestKey: string; lines: OrderLineDraft[] };
type ReceiptDraft = { requestKey: string; quantities: Record<string, string> };
const blankProduct = (): ProductDraft => ({ name: '', productType: '', brand: '', flavour: '', packSize: '', unit: '', supplierId: '', unitPrice: '0' });
const blankLine = (): OrderLineDraft => ({ key: crypto.randomUUID(), productId: '', quantity: '', unitPrice: '', taxRate: '' });
const blankOrder = (date: string): OrderDraft => ({ supplierId: '', orderedDate: date, reference: '', requestKey: crypto.randomUUID(), lines: [blankLine()] });
const decimalPattern = '\\d+(\\.\\d{1,6})?';
const isPositive = (value: string) => /^\d+(\.\d{1,6})?$/.test(value) && new Decimal(value).gt(0);
const remaining = (quantity: string, received: string) => new Decimal(quantity).minus(received).toFixed();
const statusLabels: Record<Purchase['status'], string> = { ordered: 'Ordered', partial: 'Partially received', received: 'Received' };

/** A keyed workspace prevents real/demo drafts and late responses crossing spaces. */
export function Inventory(props: Props) { return <InventoryWorkspace key={props.space} {...props} />; }

function InventoryWorkspace({ space, session, onRecordPayment }: Props) {
  const [data, setData] = useState<InventoryData | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<'product' | 'order' | 'receive' | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(blankProduct);
  const [orderDraft, setOrderDraft] = useState<OrderDraft>(() => blankOrder(session.today));
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const currency = session.settings.currency;
  const receipt = data?.purchases.find(purchase => purchase.id === receiptId);
  const receiptDraft = receiptId ? receiptDrafts[receiptId] : undefined;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setLoadError('');
    try {
      const [inventory, supplierList] = await Promise.all([
        api<InventoryData>(`/inventory?space=${space}`, { signal }),
        api<{ records: Supplier[] }>(`/suppliers?space=${space}`, { signal }),
      ]);
      if (!signal?.aborted) { setData(inventory); setSuppliers(supplierList.records); }
    } catch (error) { if (!signal?.aborted) setLoadError(errorMessage(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [space]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { const refresh=()=>{ void load(); }; window.addEventListener('ledger-activity',refresh); return()=>window.removeEventListener('ledger-activity',refresh); },[load]);

  const open = (next: 'product' | 'order') => { setSaveError(''); setDialog(next); };
  const close = () => { if (!saving) { setDialog(null); setSaveError(''); } };
  const updateOrder = (changes: Partial<OrderDraft>) => setOrderDraft(previous => ({ ...previous, ...changes, requestKey: crypto.randomUUID() }));
  const updateLine = (key: string, changes: Partial<OrderLineDraft>) => updateOrder({ lines: orderDraft.lines.map(line => line.key === key ? { ...line, ...changes } : line) });

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving) return; setSaving(true); setSaveError('');
    try {
      await api<Product>(`/products?space=${space}`, { method: 'POST', body: JSON.stringify(productDraft) });
      setProductDraft(blankProduct()); setDialog(null); setNotice('Product saved with zero received stock. Create an order, then explicitly receive stock.');
      await load();
    } catch (error) { setSaveError(errorMessage(error)); } finally { setSaving(false); }
  };
  const saveOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving) return;
    if (orderDraft.lines.some(line => !isPositive(line.quantity))) { setSaveError('Enter a quantity greater than zero, with up to six decimal places, for every line.'); return; }
    setSaving(true); setSaveError('');
    try {
      const { lines, ...header } = orderDraft;
      await api<Purchase>(`/purchases?space=${space}`, { method: 'POST', body: JSON.stringify({ ...header, lines: lines.map(({ productId, quantity, unitPrice, taxRate }) => ({ productId, quantity, unitPrice, taxRate: taxRate || null })) }) });
      setOrderDraft(blankOrder(session.today)); setDialog(null); setNotice('Purchase order created. Received stock and payments have not changed.');
      await load();
    } catch (error) { setSaveError(errorMessage(error)); } finally { setSaving(false); }
  };
  const openReceive = (purchase: Purchase) => {
    setReceiptId(purchase.id);
    setReceiptDrafts(previous => previous[purchase.id] ? previous : { ...previous, [purchase.id]: { requestKey: crypto.randomUUID(), quantities: Object.fromEntries(purchase.lines.map(line => [line.id, ''])) } });
    setSaveError(''); setDialog('receive');
  };
  const updateReceipt = (lineId: string, quantity: string) => {
    if (!receiptId || !receiptDraft) return;
    setReceiptDrafts(previous => ({ ...previous, [receiptId]: { requestKey: crypto.randomUUID(), quantities: { ...previous[receiptId].quantities, [lineId]: quantity } } }));
  };
  const receiveStock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving || !receipt || !receiptDraft) return;
    const lines = receipt.lines.filter(line => (receiptDraft.quantities[line.id] ?? '').trim() !== '' && receiptDraft.quantities[line.id] !== '0').map(line => ({ lineId: line.id, quantity: receiptDraft.quantities[line.id] }));
    if (!lines.length || lines.some(line => !isPositive(line.quantity))) { setSaveError('Enter at least one incremental quantity greater than zero, with up to six decimal places. Leave other lines blank.'); return; }
    if (lines.some(line => { const original = receipt.lines.find(item => item.id === line.lineId)!; return new Decimal(line.quantity).gt(remaining(original.quantity, original.receivedQuantity)); })) { setSaveError('A receive-now quantity exceeds the outstanding quantity. Your entries are kept; adjust them or refresh the latest order.'); return; }
    setSaving(true); setSaveError('');
    try {
      await api<Purchase>(`/purchases/${encodeURIComponent(receipt.id)}/receive?space=${space}`, { method: 'POST', body: JSON.stringify({ requestKey: receiptDraft.requestKey, lines }) });
      setReceiptDrafts(previous => { const next = { ...previous }; delete next[receipt.id]; return next; });
      setDialog(null); setReceiptId(null); setNotice('Receipt confirmed. Inventory is read back from saved purchase receipts. No payment was created.');
      await load();
    } catch (error) { setSaveError(errorMessage(error)); } finally { setSaving(false); }
  };

  return <section className="inventory-workspace" aria-label="Inventory workspace">
    <header className="page-heading inventory-heading"><div><span className="eyebrow">YOUR PRODUCTS, PURCHASES & STOCK</span><h1>Inventory<span className="heading-dot" aria-hidden="true">.</span></h1><p className="muted">Know what is on order, what has arrived, and what it cost.</p></div><div className="button-group"><button type="button" className="button button-secondary" onClick={() => open('product')} disabled={!data || loading}><Plus size={16} aria-hidden="true" />Add product</button><button type="button" className="button button-primary" onClick={() => open('order')} disabled={!data?.products.length || !suppliers.length || loading}><PackagePlus size={16} aria-hidden="true" />New purchase order</button></div></header>
    <div className="inventory-messages"><Notice tone="info">External inventory app integration is pending. This workspace stores local products, purchase orders and receipts only; nothing is synced to an external app.</Notice>{notice && <Notice tone="success">{notice}</Notice>}{loadError && <Notice retry={() => void load()}>{loadError} Saved entries are not replaced with empty data.</Notice>}</div>
    {loading && <Loading>Loading products, purchase orders and suppliers…</Loading>}
    {data && <>
      <section className="ledger-panel inventory-panel" aria-labelledby="inventory-products-title" aria-busy={loading}>
        <header className="ledger-panel-heading"><div><h2 id="inventory-products-title">Products & received stock</h2><p className="muted">{data.products.length} products · Stock changes only after an explicit receipt.</p></div><button type="button" className="icon-button" aria-label="Refresh inventory" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /></button></header>
        {!data.products.length ? <div className="ledger-empty"><span className="empty-symbol"><Boxes size={24} aria-hidden="true" /></span><h3>No products yet</h3><p>Add a supplier in Suppliers, then create a product. Creating a product does not add stock.</p><button type="button" className="button button-secondary" onClick={() => open('product')}>Add product</button></div> : <div className="table-scroll" role="region" aria-label="Products and stock table" tabIndex={0}><table className="inventory-table product-table"><caption className="sr-only">Products, received stock and outstanding orders. Historical-cost totals use received quantities at original purchase prices.</caption><thead><tr><th scope="col">Product / type</th><th scope="col">Brand / flavour</th><th scope="col">Pack size / unit</th><th scope="col">Supplier</th><th scope="col" className="amount-cell">Received stock</th><th scope="col" className="amount-cell">Outstanding order quantity</th><th scope="col" className="amount-cell">Historical-cost total</th><th scope="col" className="amount-cell">Latest unit price</th></tr></thead><tbody>{data.products.map(product => <tr key={product.id}><td><strong>{product.name}</strong><small>Type: {product.productType || '—'}</small></td><td><span>Brand: {product.brand || '—'}</span><small>Flavour: {product.flavour || '—'}</small></td><td><span>Pack size: {product.packSize}</span><small>Unit: {product.unit}</small></td><td>{product.supplierName}</td><td className="amount-cell">{product.quantity}</td><td className="amount-cell">{product.orderedQuantity}</td><td className="amount-cell"><strong>{formatMoney(product.totalCost, currency)}</strong></td><td className="amount-cell">{formatMoney(product.unitPrice, currency)}</td></tr>)}</tbody></table></div>}
        <footer className="table-footer inventory-table-note">Historical-cost total = received stock × its original line prices, not today's latest price. Quantities keep their stated units; no pack conversion.</footer>
      </section>
      <section className="inventory-orders" aria-labelledby="inventory-orders-title" aria-busy={loading}><header className="inventory-section-heading"><div><h2 id="inventory-orders-title">Purchase orders</h2><p className="muted">Orders, receipts and payments are separate actions.</p></div><span className="pill pill-neutral">{data.purchases.length} orders</span></header>
        {!data.purchases.length ? <div className="ledger-panel"><div className="ledger-empty"><h3>No purchase orders yet</h3><p>Create an order from existing products. It does not receive stock or record an expense.</p></div></div> : <div className="purchase-list">{data.purchases.map(purchase => <article className="ledger-panel purchase-card" key={purchase.id} aria-label={`Purchase ${purchase.reference || purchase.id}`}>
          <header className="purchase-heading"><div><span className="eyebrow">{purchase.supplierName}</span><h3>{purchase.reference || 'Purchase order'}</h3><p className="muted">Ordered <time dateTime={purchase.orderedDate}>{formatDate(purchase.orderedDate)}</time><span> · {purchase.lines.length} {purchase.lines.length === 1 ? 'line' : 'lines'}</span></p></div><span className={`purchase-status purchase-status-${purchase.status}`}>{statusLabels[purchase.status]}</span></header>
          <div className="table-scroll" role="region" aria-label={`Lines for ${purchase.reference || purchase.id}`} tabIndex={0}><table className="inventory-table purchase-lines"><caption className="sr-only">Original purchase line prices and incremental receipt progress for {purchase.reference || purchase.id}</caption><thead><tr><th scope="col">Product / pack / unit</th><th scope="col" className="amount-cell">Ordered quantity</th><th scope="col" className="amount-cell">Received quantity</th><th scope="col" className="amount-cell">Historical unit price</th><th scope="col" className="amount-cell">Tax rate (reference)</th><th scope="col" className="amount-cell">Line total</th><th scope="col" className="amount-cell">Received cost</th></tr></thead><tbody>{purchase.lines.map(line => <tr key={line.id}><td><strong>{line.productName}</strong><small>Pack size: {line.packSize} · Unit: {line.unit}</small></td><td className="amount-cell">{line.quantity}</td><td className="amount-cell">{line.receivedQuantity}</td><td className="amount-cell">{formatMoney(line.unitPrice, currency)}</td><td className="amount-cell">{line.taxRate === null ? '—' : `${line.taxRate}%`}</td><td className="amount-cell">{formatMoney(line.lineCost, currency)}</td><td className="amount-cell">{formatMoney(line.receivedCost, currency)}</td></tr>)}</tbody></table></div>
          <footer className="purchase-footer"><dl className="purchase-totals"><div><dt>Order total cost</dt><dd>{formatMoney(purchase.totalCost, currency)}</dd></div><div><dt>Paid total</dt><dd>{formatMoney(purchase.paidTotal, currency)}</dd></div></dl><div className="button-group">{purchase.status !== 'received' && <button type="button" className="button button-secondary" disabled={loading || saving} onClick={() => openReceive(purchase)}>Receive stock</button>}<button type="button" className="button button-primary" disabled={!onRecordPayment || saving || loading} onClick={() => onRecordPayment?.(purchase)}>Record payment</button></div>{!onRecordPayment && <p className="field-hint">Payment entry is unavailable here. No expense has been created automatically.</p>}</footer>
        </article>)}</div>}
      </section>
    </>}

    <Dialog open={dialog === 'product'} onClose={close} title="Add product" id="inventory-product" busy={saving}>
      <form className="inventory-form" onSubmit={saveProduct}><p className="inventory-form-intro">A product starts with zero stock. Order and receive it separately.</p><fieldset className="form-fields" disabled={saving}>
        <label>Product name<input required maxLength={200} value={productDraft.name} onChange={event => setProductDraft({ ...productDraft, name: event.target.value })} /></label>
        <div className="form-row"><label>Product type<input required maxLength={120} value={productDraft.productType} onChange={event => setProductDraft({ ...productDraft, productType: event.target.value })} /></label><label>Brand<input required maxLength={120} value={productDraft.brand} onChange={event => setProductDraft({ ...productDraft, brand: event.target.value })} /></label></div>
        <label>Flavour<input aria-label="Flavour" maxLength={120} value={productDraft.flavour} onChange={event => setProductDraft({ ...productDraft, flavour: event.target.value })} /><span className="field-hint">Optional; leave blank if not applicable.</span></label>
        <div className="form-row"><label>Pack size<input required maxLength={80} placeholder="e.g. 250 ml / 12-pack" value={productDraft.packSize} onChange={event => setProductDraft({ ...productDraft, packSize: event.target.value })} /></label><label>Unit<input required maxLength={80} placeholder="e.g. bottle / carton" value={productDraft.unit} onChange={event => setProductDraft({ ...productDraft, unit: event.target.value })} /></label></div>
        <label>Product supplier<select aria-label="Product supplier" required value={productDraft.supplierId} onChange={event => setProductDraft({ ...productDraft, supplierId: event.target.value })}><option value="">Select a supplier</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        {!suppliers.length && <Notice tone="info">Add a supplier in Suppliers first. Your product entries stay here if you close this dialog.</Notice>}
        <label>Initial unit price<input aria-label="Initial unit price" required inputMode="decimal" pattern={decimalPattern} title="A non-negative decimal with up to six decimal places" value={productDraft.unitPrice} onChange={event => setProductDraft({ ...productDraft, unitPrice: event.target.value })} /><span className="field-hint">{currency} per stated unit · up to 6 decimal places. This does not add stock or cost.</span></label>
      </fieldset>{saveError && <Notice>{saveError}</Notice>}<footer className="dialog-footer"><button type="button" className="text-button" onClick={close} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || !suppliers.length}>{saving ? 'Saving…' : 'Save product'}</button></footer></form>
    </Dialog>

    <Dialog open={dialog === 'order'} onClose={close} title="New purchase order" id="inventory-order" busy={saving} className="inventory-wide-dialog">
      <form className="inventory-form" onSubmit={saveOrder}><p className="inventory-form-intro">Creates an order only. Stock stays unchanged until you confirm a receipt; payment requires a separate expense entry.</p><fieldset className="form-fields" disabled={saving}>
        <div className="form-row"><label>Order supplier<select aria-label="Order supplier" required value={orderDraft.supplierId} onChange={event => updateOrder({ supplierId: event.target.value, lines: orderDraft.lines.map(line => ({ ...line, productId: '', unitPrice: '' })) })}><option value="">Select a supplier</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Ordered date<input type="date" required value={orderDraft.orderedDate} onChange={event => updateOrder({ orderedDate: event.target.value })} /></label></div>
        <label>Order reference<input aria-label="Order reference" maxLength={200} value={orderDraft.reference} onChange={event => updateOrder({ reference: event.target.value })} /><span className="field-hint">Optional supplier reference. Duplicate references are reported, not silently overwritten.</span></label>
        <div className="order-draft-lines">{orderDraft.lines.map((line, index) => <fieldset className="order-draft-line" key={line.key}><legend>Line {index + 1}</legend><label>Product for line {index + 1}<select aria-label={`Product for line ${index + 1}`} required value={line.productId} onChange={event => { const product = data?.products.find(item => item.id === event.target.value); updateLine(line.key, { productId: event.target.value, unitPrice: product?.unitPrice ?? '' }); }}><option value="">Select an existing product</option>{data?.products.filter(product => product.supplierId === orderDraft.supplierId).map(product => <option key={product.id} value={product.id}>{product.name} · {product.brand}{product.flavour ? ` / ${product.flavour}` : ''} · {product.packSize} · {product.unit}</option>)}</select></label><div className="order-numeric-fields"><label>Quantity for line {index + 1}<input required inputMode="decimal" pattern={decimalPattern} title="A positive decimal with up to six decimal places" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} /></label><label>Unit price for line {index + 1}<input aria-label={`Unit price for line ${index + 1}`} required inputMode="decimal" pattern={decimalPattern} title="A non-negative decimal with up to six decimal places" value={line.unitPrice} onChange={event => updateLine(line.key, { unitPrice: event.target.value })} /><span className="field-hint">{currency} · up to 6 decimals</span></label><label>Tax rate for line {index + 1}<input inputMode="decimal" pattern={decimalPattern} title="Optional non-negative tax rate" placeholder="Optional %" value={line.taxRate} onChange={event => updateLine(line.key, { taxRate: event.target.value })} /></label></div>{orderDraft.lines.length > 1 && <button type="button" className="text-button" aria-label={`Remove line ${index + 1}`} onClick={() => updateOrder({ lines: orderDraft.lines.filter(item => item.key !== line.key) })}>Remove line</button>}</fieldset>)}</div>
        <button type="button" className="button button-secondary inventory-add-line" onClick={() => updateOrder({ lines: [...orderDraft.lines, blankLine()] })}><Plus size={15} aria-hidden="true" />Add line</button>
        {orderDraft.supplierId && !data?.products.some(product => product.supplierId === orderDraft.supplierId) && <Notice tone="info">This supplier has no products yet. Add a product for this supplier before ordering.</Notice>}
        <p className="field-hint">Tax rate is retained as reference only. Enter the intended unit price; no tax conversion or automatic payment is applied.</p>
      </fieldset>{saveError && <Notice>{saveError}</Notice>}<footer className="dialog-footer"><button type="button" className="text-button" onClick={close} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create order'}</button></footer></form>
    </Dialog>

    <Dialog open={dialog === 'receive'} onClose={close} title="Receive stock" id="inventory-receive" busy={saving} className="inventory-wide-dialog">
      {receipt && receiptDraft && <form className="inventory-form" onSubmit={receiveStock}><p className="inventory-form-intro"><strong>{receipt.supplierName} · {receipt.reference || 'Purchase order'}</strong><br />Enter only the additional quantities arriving now, not the cumulative received total. Blank lines are skipped. No stock changes until you confirm.</p><fieldset className="form-fields" disabled={saving}>{receipt.lines.map(line => { const outstanding = remaining(line.quantity, line.receivedQuantity); return <div className="receipt-line" key={line.id}><div><h3>{line.productName}</h3><p className="field-hint">Pack size: {line.packSize} · Unit: {line.unit}</p><dl className="receipt-progress"><div><dt>Ordered</dt><dd>{line.quantity}</dd></div><div><dt>Already received</dt><dd>{line.receivedQuantity}</dd></div><div><dt>Outstanding</dt><dd>{outstanding}</dd></div></dl></div><label>Receive now for {line.productName}<input aria-description={`Additional ${line.unit}; maximum ${outstanding}`} inputMode="decimal" pattern={decimalPattern} title="Additional quantity arriving now, up to six decimal places" disabled={outstanding === '0'} value={receiptDraft.quantities[line.id] ?? ''} onChange={event => updateReceipt(line.id, event.target.value)} placeholder={outstanding === '0' ? 'Fully received' : 'Leave blank to skip'} /></label></div>; })}</fieldset>{saveError && <Notice>{saveError}</Notice>}<footer className="dialog-footer"><button type="button" className="text-button" onClick={close} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Confirming…' : 'Confirm receipt'}</button></footer></form>}
    </Dialog>
  </section>;
}
