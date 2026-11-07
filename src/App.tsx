import { useCallback, useEffect, useState } from 'react';
import { Bell, Boxes, ChevronRight, FileBarChart2, FileText, Leaf, LogOut, Menu, Moon, ReceiptText, RotateCw, ShieldCheck, Sun, Truck, X, type LucideIcon } from 'lucide-react';
import { BRAND } from '../shared/config';
import type { Expense, ExpenseInput, ExpenseList, Session, Space, Purchase } from '../shared/types';
import { api, ApiError, errorMessage } from './api';
import { Auth } from './Auth';
import { Brand, Dialog, formatDate, Loading, Notice } from './components';
import { ExpenseDialog, type DuplicateWarning, type ExpenseDraft } from './ExpenseDialog';
import { EMPTY_FILTERS, ExpenseLedger, type ExpenseFilters } from './ExpenseLedger';
import { HistoryDialog } from './HistoryDialog';
import { Inventory } from './Inventory';
import { Suppliers } from './Suppliers';
import { Reports } from './Reports';
import { Documents } from './Documents';
import { ReminderAgent, ReminderSettings } from './Reminders';

const NAVIGATION: { name: string; icon: LucideIcon; stage?: string }[] = [
  { name: 'Expenses', icon: ReceiptText }, { name: 'Inventory', icon: Boxes }, { name: 'Suppliers', icon: Truck },
  { name: 'Reports', icon: FileBarChart2 }, { name: 'Documents', icon: FileText }, { name: 'Reminders', icon: Bell },
];
const blankDraft = (today: string): ExpenseDraft => ({ paymentDate: today, description: '', amount: '', method: '', additionalInformation: '', transactionRef: '', requestKey: crypto.randomUUID(), entryMode: 'choose' });
const hasValues = (draft?: ExpenseDraft) => Boolean(draft && (draft.description || draft.amount || draft.method || draft.additionalInformation || draft.transactionRef));
const viewFromPath = () => window.location.pathname === '/' ? 'Expenses' : NAVIGATION.find(item => `/${item.name.toLowerCase()}` === window.location.pathname)?.name ?? 'Page not found';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadSession = useCallback(async () => {
    setLoading(true); setError('');
    try { setSession(await api<Session>('/session')); } catch (error) { setError(errorMessage(error)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadSession(); }, [loadSession]);
  if (loading || error) return <main className="initial-screen"><Brand /><div className="initial-content">{loading ? <Loading /> : <Notice retry={() => void loadSession()}>{error}</Notice>}</div></main>;
  if (!session?.user) return <Auth onAuthenticated={setSession} />;
  return <Workspace key={session.user.id} session={session} onSessionUpdate={setSession} onSignedOut={() => setSession({ ...session, user: null })} />;
}

function Workspace({ session, onSignedOut, onSessionUpdate }: { session: Session; onSignedOut: () => void; onSessionUpdate: (session:Session)=>void }) {
  const [space, setSpace] = useState<Space>('real');
  const [view, setView] = useState(viewFromPath);
  const [visited, setVisited] = useState<string[]>(() => [viewFromPath()]);
  useEffect(() => { setVisited(previous => previous.includes(view) ? previous : [...previous, view]); }, [view]);
  const [mobileNav, setMobileNav] = useState(false);
  const [filters, setFilters] = useState<ExpenseFilters>({ ...EMPTY_FILTERS });
  const [data, setData] = useState<ExpenseList | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [reload, setReload] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [theme, setTheme] = useState<'light'|'dark'>(()=>{
    if(typeof window!=='undefined'){
      const saved=localStorage.getItem('ledger_theme');
      if(saved==='dark'||saved==='light')return saved;
    }
    return 'light';
  });
  useEffect(()=>{
    document.documentElement.setAttribute('data-theme',theme);
    localStorage.setItem('ledger_theme',theme);
  },[theme]);
  const toggleTheme=()=>setTheme(t=>t==='dark'?'light':'dark');
  const triggerReload=()=>{
    setReloading(true);
    setReload(v=>v+1);
    window.dispatchEvent(new Event('ledger-refresh'));
    setTimeout(()=>setReloading(false),700);
  };
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, ExpenseDraft>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [stale, setStale] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateWarning | null>(null);
  const [uploadNotice, setUploadNotice] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [uploadOverlay, setUploadOverlay] = useState(false);
  const [uploadMounted, setUploadMounted] = useState(false);
  const openUpload = () => { setUploadMounted(true); setUploadOverlay(true); };
  const [history, setHistory] = useState<Expense | null>(null);
  const [notice, setNotice] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const currency = session.settings.currency;
  const timezone = session.settings.timezone;
  const activeDraft = activeKey ? drafts[activeKey] : undefined;
  const newKey = `${space}:new`;
  const newDraft = drafts[newKey];
  useEffect(() => {
    if (window.location.pathname === '/') window.history.replaceState(null, '', `/expenses${window.location.search}${window.location.hash}`);
    const restoreView = () => { setView(viewFromPath()); setMobileNav(false); setNotice(''); };
    window.addEventListener('popstate', restoreView);
    return () => window.removeEventListener('popstate', restoreView);
  }, []);
  useEffect(() => {
    document.title = `${BRAND.name} · ${view}`;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [view]);
  useEffect(() => {
    const unsaved = Object.values(drafts).some(hasValues);
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  useEffect(() => {
    if (!mobileNav) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileNav(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobileNav]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setListError(''); setData(null);
    if (filters.from && filters.to && filters.from > filters.to) { setListError('From date must be on or before To date. Adjust the payment date range.'); setLoading(false); return () => controller.abort(); }
    const query = new URLSearchParams({ space });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    const timer = window.setTimeout(() => {
      api<ExpenseList>(`/expenses?${query}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(error => { if (!controller.signal.aborted) setListError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, filters.q ? 200 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [space, filters, reload]);

  useEffect(() => {
    if (!dialogOpen) return;
    const controller = new AbortController();
    api<{records: Purchase[]}>(`/purchases?space=${space}`,{signal:controller.signal}).then(r=>setPurchases(r.records)).catch(()=>setPurchases([]));
    return ()=>controller.abort();
  }, [dialogOpen, space, reload]);
  const recordPayment = (purchase: Purchase) => {
    const key = `${space}:purchase:${purchase.id}`;
    setDrafts(previous => previous[key] ? previous : { ...previous, [key]: { ...blankDraft(session.today), entryMode:'manual', description:`Payment to ${purchase.supplierName}`, purchaseId:purchase.id, additionalInformation:`Purchase ${purchase.reference || purchase.id}` } });
    setActiveKey(key); setSaveError(''); setStale(false); setDuplicate(null); setDialogOpen(true);
  };
  const changeFilters = (next: ExpenseFilters) => { setFilters(next); setPage(1); };
  const openExpense = (expense?: Expense) => {
    const key = `${space}:${expense?.id ?? 'new'}`;
    setDrafts(previous => previous[key] ? previous : { ...previous, [key]: expense ? { ...expense, requestKey: crypto.randomUUID(), entryMode: 'manual' } : blankDraft(session.today) });
    setActiveKey(key); setSaveError(''); setStale(false); setDuplicate(null); setUploadNotice(false); setDialogOpen(true);
  };
  const updateDraft = (changes: Partial<ExpenseDraft>) => {
    if (!activeKey) return;
    setDrafts(previous => ({ ...previous, [activeKey]: { ...previous[activeKey], ...changes, requestKey: changes.entryMode ? previous[activeKey].requestKey : crypto.randomUUID() } }));
    setDuplicate(null); setSaveError(''); setStale(false);
  };
  const discardDraft = () => {
    if (!activeKey) return;
    setDrafts(previous => { const next = { ...previous }; delete next[activeKey]; return next; });
    setDialogOpen(false); setActiveKey(null); setSaveError(''); setDuplicate(null);
  };
  const save = async (allowDuplicate = false) => {
    if (!activeDraft || !activeKey || saving) return;
    const draft = activeDraft;
    const key = activeKey;
    const scope = space;
    setSaving(true); setSaveError(''); setStale(false);
    const input: ExpenseInput = { paymentDate: draft.paymentDate, description: draft.description, amount: draft.amount, method: draft.method, additionalInformation: draft.additionalInformation, transactionRef: draft.transactionRef, requestKey: draft.requestKey, allowDuplicate, purchaseId: draft.purchaseId ?? null, taxRate: draft.taxRate ?? null, ...(draft.id ? { version: draft.version } : {}) };
    try {
      const saved = await api<Expense>(draft.id ? `/expenses/${encodeURIComponent(draft.id)}?space=${scope}` : `/expenses?space=${scope}`, { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(input) });
      // Read back the saved target, independent of filters, before declaring success.
      const verified = await api<ExpenseList>(`/expenses?space=${scope}`);
      if (!verified.records.some(record => record.id === saved.id && record.version === saved.version && record.amount === saved.amount)) throw new ApiError('The save returned, but could not be verified. Keep this draft and retry with the same save key.', 0);
      setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; });
      setDialogOpen(false); setActiveKey(null); setDuplicate(null); setNotice(draft.id ? 'Changes saved and verified.' : 'Expense saved and verified.'); setReload(value => value + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === 'DUPLICATE') {
        const referenceConflict = Boolean(draft.transactionRef.trim() && error.candidates.some(candidate => candidate.transactionRef.toLowerCase() === draft.transactionRef.trim().toLowerCase()));
        setDuplicate({ message: error.message, candidates: error.candidates, canOverride: !referenceConflict && !draft.id });
      } else { setSaveError(errorMessage(error)); setStale(error instanceof ApiError && error.code === 'STALE_VERSION'); }
    } finally { setSaving(false); }
  };
  const loadLatest = async () => {
    if (!activeKey || !activeDraft?.id) return;
    setSaving(true);
    try {
      const latest = await api<ExpenseList>(`/expenses?space=${space}`);
      const expense = latest.records.find(record => record.id === activeDraft.id);
      if (!expense) throw new Error('This expense is no longer available. Your draft has been kept.');
      setDrafts(previous => ({ ...previous, [activeKey]: { ...expense, entryMode: 'manual', requestKey: crypto.randomUUID() } }));
      setSaveError(''); setStale(false); setDuplicate(null); setReload(value => value + 1);
    } catch (error) { setSaveError(errorMessage(error)); } finally { setSaving(false); }
  };
  const signOut = async () => {
    if (Object.values(drafts).some(hasValues) && !window.confirm('Sign out and discard unsaved drafts in this tab? Saved expenses will stay in your account.')) return;
    setSigningOut(true); setLogoutError('');
    try {
      await api('/logout', { method: 'POST' });
      const result = await api<Session>('/session');
      if (result.user) throw new Error('Sign-out could not be verified. Please try again.');
      onSignedOut();
    } catch (error) { setLogoutError(errorMessage(error)); } finally { setSigningOut(false); }
  };
  const navigate = (name: string) => {
    if (!NAVIGATION.some(item => item.name === name)) return;
    const path = `/${name.toLowerCase()}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setView(name); setMobileNav(false); setNotice('');
    document.getElementById('main-content')?.focus({ preventScroll: true });
  };
  const changeSpace = (next: Space) => { setSpace(next); setVisited([view]); setData(null); setPage(1); setNotice(''); setActiveKey(null); setDialogOpen(false); setHistory(null); setUploadOverlay(false); setUploadMounted(false); };
  const initials = session.user!.name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a>
    {mobileNav && <button type="button" className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`} aria-label="Workspace sidebar"><div className="sidebar-brand"><Brand /><button className="icon-button mobile-close" type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button></div><div className="workspace-select"><label htmlFor="space-select">WORKSPACE SPACE</label><select id="space-select" aria-label="Workspace space" value={space} onChange={event => changeSpace(event.target.value as Space)} disabled={saving}><option value="real">Real workspace</option><option value="demo">Demo · fictional</option></select><span className="workspace-select-hint"><span className={`space-dot ${space === 'demo' ? 'demo-dot' : ''}`} />{space === 'real' ? 'Your actual business records' : 'Separate fictional records'}</span></div><span className="nav-label">WORKSPACE</span><nav aria-label="Main navigation">{NAVIGATION.map(item => <button key={item.name} type="button" onClick={() => navigate(item.name)} className={`nav-item ${view === item.name ? 'nav-item-active' : ''}`} aria-current={view === item.name ? 'page' : undefined}><item.icon size={19} strokeWidth={1.7} aria-hidden="true" /><span>{item.name}</span>{item.stage && <small aria-hidden="true">{item.stage}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><Leaf size={20} strokeWidth={1.6} aria-hidden="true" /><strong>A little order goes a long way.</strong><p>One payment at a time. Keep the details that matter.</p></div><div className="profile"><span className="avatar" aria-hidden="true">{initials}</span><div><strong>{session.user!.name}</strong><span title={session.user!.email}>{session.user!.email}</span></div><button className="icon-button" aria-label="Sign out" title="Sign out" type="button" disabled={signingOut} onClick={() => void signOut()}><LogOut size={17} aria-hidden="true" /></button></div></div></aside>
    <div className="workspace-main"><header className="topbar">{reloading&&<div className="reload-progress-bar" role="progressbar" aria-label="Reloading workspace data" />}<div className="breadcrumb"><button className="icon-button mobile-menu" type="button" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(true)}><Menu size={21} aria-hidden="true" /></button><span className="breadcrumb-root">Workspace</span><ChevronRight size={14} aria-hidden="true" /><strong>{view}</strong></div><div className="topbar-right"><button type="button" className={`icon-button reload-button ${reloading?'is-reloading':''}`} aria-label="Reload workspace" title="Reload workspace data" onClick={triggerReload}><RotateCw size={15} className={reloading?'spin':''} aria-hidden="true" /></button><button type="button" className="icon-button theme-toggle" aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} title={theme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={toggleTheme}>{theme==='dark'?<Sun size={15} aria-hidden="true" />:<Moon size={15} aria-hidden="true" />}</button><span className="local-badge"><ShieldCheck size={14} aria-hidden="true" />Private workspace</span><time dateTime={session.today}>{formatDate(session.today)}</time></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>{space === 'demo' && <div className="demo-banner" role="status"><span className="pill pill-demo">DEMO</span><div><strong>Fictional demo space</strong><span>For exploring only. These records never enter your real books.</span></div></div>}{notice && <div className="workspace-notice"><Notice tone="success">{notice}</Notice><button type="button" className="icon-button" aria-label="Dismiss confirmation" onClick={() => setNotice('')}><X size={16} /></button></div>}{logoutError && <Notice>{logoutError}</Notice>}
        <div key={space}>
          {(visited.includes('Expenses') || view === 'Expenses') && <div hidden={view !== 'Expenses'}><ExpenseLedger data={data} loading={loading} error={listError} filters={filters} space={space} currency={currency} timezone={timezone} page={page} onPage={setPage} onFilters={changeFilters} onRetry={() => setReload(value => value + 1)} onAdd={() => openExpense()} onEdit={openExpense} onHistory={setHistory} hasDraft={hasValues(newDraft)} /></div>}
          {(visited.includes('Inventory') || view === 'Inventory') && <div hidden={view !== 'Inventory'}><Inventory space={space} session={session} onRecordPayment={recordPayment} onNavigateSuppliers={() => navigate('Suppliers')} /></div>}
          {(visited.includes('Suppliers') || view === 'Suppliers') && <div hidden={view !== 'Suppliers'}><Suppliers space={space} /></div>}
          {(visited.includes('Reports') || view === 'Reports') && <div hidden={view !== 'Reports'}><Reports space={space} session={session} /></div>}
          {(visited.includes('Documents') || view === 'Documents') && <div hidden={view !== 'Documents'}><Documents space={space} session={session} onSaved={()=>setReload(n=>n+1)} /></div>}
          {(visited.includes('Reminders') || view === 'Reminders') && <div hidden={view !== 'Reminders'}><ReminderSettings session={session} onUpdated={onSessionUpdate} onBack={()=>navigate('Expenses')} /></div>}
        </div>
        {!NAVIGATION.some(item => item.name === view) && <section className="future-stage"><span className="eyebrow">LET’S GET YOU BACK</span><h1>Page not found</h1><p>This address does not match a workspace section.</p><p className="muted">Choose a section from the navigation or return to your expenses.</p><button className="button button-primary" type="button" onClick={() => navigate('Expenses')}>Back to expenses</button></section>}
      </main><footer className="workspace-footer"><span>{BRAND.name}</span><span>{BRAND.tagline}</span></footer>
    </div>
    {activeDraft && <ExpenseDialog open={dialogOpen} draft={activeDraft} purchases={purchases} space={space} currency={currency} busy={saving} error={saveError} duplicate={duplicate} uploadNotice={uploadNotice} onUpload={() => { setDialogOpen(false); openUpload(); }} onClose={() => { if (!saving) setDialogOpen(false); }} onChange={updateDraft} onSave={allow => void save(allow)} onDiscard={discardDraft} onReload={stale ? () => void loadLatest() : undefined} />}
    {uploadMounted && <Dialog open={uploadOverlay} onClose={()=>setUploadOverlay(false)} title="Upload and review screenshots" id="upload-overlay" className="documents-modal" closeLabel="Close upload review"><Documents key={space} space={space} session={session} onSaved={()=>setReload(n=>n+1)} /></Dialog>}
    <ReminderAgent userId={session.user!.id} onUpload={openUpload} onManual={()=>{ if(!dialogOpen) openExpense(); }} />
    <HistoryDialog expense={history} space={space} currency={currency} timezone={timezone} onClose={() => setHistory(null)} />
  </div>;
}
