import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Truck } from 'lucide-react';
import type { Product, Space, Supplier } from '../shared/types';
import { api, ApiError, errorMessage } from './api';
import { Dialog, Loading, Notice } from './components';
import './inventory.css';

type SupplierDraft = { name: string; contactName: string; email: string; address: string; paymentTerms: string; version?: number };
const blankSupplier = (): SupplierDraft => ({ name: '', contactName: '', email: '', address: '', paymentTerms: '' });
const draftFor = (supplier: Supplier): SupplierDraft => ({ name: supplier.name, contactName: supplier.contactName, email: supplier.email, address: supplier.address, paymentTerms: supplier.paymentTerms, version: supplier.version });

export function Suppliers({ space }: { space: Space }) { return <SuppliersWorkspace key={space} space={space} />; }

function SuppliersWorkspace({ space }: { space: Space }) {
  const [records, setRecords] = useState<Supplier[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<Record<string, SupplierDraft>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Supplier | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [productSupplier, setProductSupplier] = useState<Supplier | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [productsReload, setProductsReload] = useState(0);
  const draft = activeKey ? drafts[activeKey] : undefined;
  const editing = activeKey !== null && activeKey !== 'new';

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setLoadError('');
    try { const data = await api<{ records: Supplier[] }>(`/suppliers?space=${space}`, { signal }); if (!signal?.aborted) setRecords(data.records); }
    catch (error) { if (!signal?.aborted) setLoadError(errorMessage(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [space]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (!productSupplier) return;
    const controller = new AbortController();
    setProducts(null); setProductsLoading(true); setProductsError('');
    api<{ records: Product[] }>(`/products?space=${space}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setProducts(data.records.filter(product => product.supplierId === productSupplier.id)); }).catch(error => { if (!controller.signal.aborted) setProductsError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, [space, productSupplier, productsReload]);

  const openSupplier = (supplier?: Supplier) => {
    const key = supplier?.id ?? 'new';
    setDrafts(previous => previous[key] ? previous : { ...previous, [key]: supplier ? draftFor(supplier) : blankSupplier() });
    setActiveKey(key); setEditOpen(true); setSaveError(''); setConflict(false); setLatest(null); setReviewError('');
  };
  const closeEdit = () => { if (!saving && !reviewing) setEditOpen(false); };
  const change = (changes: Partial<SupplierDraft>) => {
    if (!activeKey) return;
    setDrafts(previous => ({ ...previous, [activeKey]: { ...previous[activeKey], ...changes } }));
  };
  const reviewLatest = async () => {
    if (!activeKey || activeKey === 'new') return;
    setReviewing(true); setReviewError('');
    try {
      const data = await api<{ records: Supplier[] }>(`/suppliers?space=${space}`);
      const current = data.records.find(supplier => supplier.id === activeKey);
      if (!current) throw new Error('This supplier is no longer available. Your unsaved entries are kept.');
      setLatest(current); setRecords(data.records);
    } catch (error) { setReviewError(errorMessage(error)); }
    finally { setReviewing(false); }
  };
  const saveSupplier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving || !draft || !activeKey || conflict) return;
    setSaving(true); setSaveError(''); setLatest(null);
    try {
      await api<Supplier>(`${editing ? `/suppliers/${encodeURIComponent(activeKey)}` : '/suppliers'}?space=${space}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      setDrafts(previous => { const next = { ...previous }; delete next[activeKey]; return next; });
      setEditOpen(false); setNotice(editing ? 'Supplier updated. Existing purchase prices and receipts are unchanged.' : 'Supplier added. You can now assign products to this supplier.');
      await load();
    } catch (error) {
      setSaveError(errorMessage(error));
      if (editing && error instanceof ApiError && error.status === 409) { setConflict(true); await reviewLatest(); }
    } finally { setSaving(false); }
  };

  return <section className="suppliers-workspace" aria-label="Suppliers workspace">
    <header className="page-heading inventory-heading"><div><span className="eyebrow">THE PEOPLE BEHIND YOUR PRODUCTS</span><h1>Suppliers<span className="heading-dot" aria-hidden="true">.</span></h1><p className="muted">Keep contacts, payment terms and linked products together.</p></div><button type="button" className="button button-primary" onClick={() => openSupplier()} disabled={loading}><Plus size={16} aria-hidden="true" />Add supplier</button></header>
    <div className="inventory-messages">{notice && <Notice tone="success">{notice}</Notice>}{loadError && <Notice retry={() => void load()}>{loadError} Your saved supplier data has not been cleared.</Notice>}</div>
    {loading && <Loading>Loading suppliers…</Loading>}
    {records && <section className="ledger-panel" aria-labelledby="supplier-directory-title" aria-busy={loading}><header className="ledger-panel-heading"><div><h2 id="supplier-directory-title">Supplier directory</h2><p className="muted">{records.length} suppliers · Contact details and product links</p></div><button type="button" className="icon-button" aria-label="Refresh suppliers" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /></button></header>
      {!records.length ? <div className="ledger-empty"><span className="empty-symbol"><Truck size={24} aria-hidden="true" /></span><h3>No suppliers yet</h3><p>Add your first supplier, then connect products and create purchase orders in Inventory.</p><button type="button" className="button button-secondary" onClick={() => openSupplier()}>Add supplier</button></div> : <div className="table-scroll" role="region" aria-label="Supplier directory table" tabIndex={0}><table className="inventory-table supplier-table"><caption className="sr-only">Supplier contact details, payment terms, record version and linked product counts</caption><thead><tr><th scope="col">Supplier</th><th scope="col">Contact name</th><th scope="col">Email</th><th scope="col">Address</th><th scope="col">Payment terms</th><th scope="col">Products</th><th scope="col">Actions</th></tr></thead><tbody>{records.map(supplier => <tr key={supplier.id}><td><strong>{supplier.name}</strong><small>Version {supplier.version}</small></td><td>{supplier.contactName || '—'}</td><td>{supplier.email || '—'}</td><td className="address-cell">{supplier.address || '—'}</td><td>{supplier.paymentTerms || '—'}</td><td><button type="button" className="text-button" aria-label={`View products for ${supplier.name}`} onClick={() => setProductSupplier(supplier)}>{supplier.productCount} {supplier.productCount === 1 ? 'product' : 'products'}</button></td><td><button type="button" className="text-button" aria-label={`Edit ${supplier.name}`} disabled={loading || saving} onClick={() => openSupplier(supplier)}>Edit</button></td></tr>)}</tbody></table></div>}
      <footer className="table-footer inventory-table-note">Supplier details are saved in the selected workspace. Editing a supplier does not change historical purchase costs or create a payment.</footer>
    </section>}

    <Dialog open={editOpen} onClose={closeEdit} title={editing ? 'Edit supplier' : 'Add supplier'} id="supplier-edit" busy={saving || reviewing}>
      {draft && <form className="inventory-form" onSubmit={saveSupplier}><p className="inventory-form-intro">{editing ? `Editing saved version ${draft.version}. ` : ''}Only the supplier name is required. Unsaved values are kept when a save fails or this dialog is closed.</p><fieldset className="form-fields" disabled={saving || reviewing}>
        <label>Supplier name<input required maxLength={200} value={draft.name} onChange={event => change({ name: event.target.value })} /></label>
        <div className="form-row"><label>Contact name<input maxLength={200} value={draft.contactName} onChange={event => change({ contactName: event.target.value })} /></label><label>Email<input type="email" maxLength={254} value={draft.email} onChange={event => change({ email: event.target.value })} /></label></div>
        <label>Address<textarea maxLength={2000} value={draft.address} onChange={event => change({ address: event.target.value })} /></label>
        <label>Payment terms<input maxLength={500} placeholder="e.g. Net 30 / payment on delivery" value={draft.paymentTerms} onChange={event => change({ paymentTerms: event.target.value })} /></label>
      </fieldset>{saveError && <Notice>{saveError}</Notice>}
        {conflict && <section className="supplier-version-review" aria-label="Latest supplier version"><h3>Review before saving again</h3><p className="field-hint">Your entries above are unchanged. Compare the latest saved supplier details below before explicitly choosing to retry your draft against that version.</p>{reviewing && <Loading>Loading the latest supplier version…</Loading>}{reviewError && <Notice retry={() => void reviewLatest()}>{reviewError}</Notice>}{latest && <><dl className="supplier-product-meta"><div><dt>Saved version</dt><dd>{latest.version}</dd></div><div><dt>Supplier name</dt><dd>{latest.name}</dd></div><div><dt>Contact name</dt><dd>{latest.contactName || '—'}</dd></div><div><dt>Email</dt><dd>{latest.email || '—'}</dd></div><div><dt>Address</dt><dd>{latest.address || '—'}</dd></div><div><dt>Payment terms</dt><dd>{latest.paymentTerms || '—'}</dd></div></dl><button type="button" className="button button-secondary" disabled={saving || reviewing} onClick={() => { change({ version: latest.version }); setConflict(false); setLatest(null); setSaveError(''); }}>Use latest version, keep my entries</button></>}{!latest && !reviewError && !reviewing && <button type="button" className="button button-secondary" onClick={() => void reviewLatest()}>Review latest version</button>}</section>}
        <footer className="dialog-footer"><button type="button" className="text-button" onClick={closeEdit} disabled={saving || reviewing}>Cancel</button><button type="submit" className="button button-primary" disabled={saving || reviewing || conflict}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save supplier'}</button></footer></form>}
    </Dialog>

    <Dialog open={Boolean(productSupplier)} onClose={() => setProductSupplier(null)} title={`Products from ${productSupplier?.name ?? 'supplier'}`} id="supplier-products" className="inventory-wide-dialog">
      <div className="supplier-products-content">{productsLoading && <Loading>Loading linked products…</Loading>}{productsError && <Notice retry={() => setProductsReload(previous => previous + 1)}>{productsError}</Notice>}{products && <><p>{products.length} linked {products.length === 1 ? 'product' : 'products'}</p>{!products.length ? <div className="ledger-empty"><h3>No linked products yet</h3><p>Create a product in Inventory and select this supplier.</p></div> : <ul className="supplier-products-list">{products.map(product => <li key={product.id}><strong>{product.name}</strong><dl className="supplier-product-meta"><div><dt>Type</dt><dd>{product.productType || '—'}</dd></div><div><dt>Brand</dt><dd>{product.brand || '—'}</dd></div><div><dt>Flavour</dt><dd>{product.flavour || '—'}</dd></div><div><dt>Pack size</dt><dd>{product.packSize}</dd></div><div><dt>Unit</dt><dd>{product.unit}</dd></div><div><dt>Received stock</dt><dd>{product.quantity}</dd></div><div><dt>Outstanding order quantity</dt><dd>{product.orderedQuantity}</dd></div></dl></li>)}</ul>}</>}</div>
    </Dialog>
  </section>;
}
