import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { Expense, Space } from '../shared/types';
import { api, errorMessage } from './api';
import { Dialog, formatDate, formatMoney, Loading, Notice } from './components';

interface AuditEvent { at: number | string; action: string; before: Expense | null; after: Expense | null }
function Snapshot({ label, expense, currency }: { label: string; expense: Expense | null; currency: string }) {
  return <section className="history-snapshot"><h4>{label}</h4>{expense ? <dl><div><dt>Payment date</dt><dd>{formatDate(expense.paymentDate)}</dd></div><div><dt>Description</dt><dd>{expense.description}</dd></div><div><dt>Amount</dt><dd>{formatMoney(expense.amount, currency)}</dd></div><div><dt>Payment method</dt><dd>{expense.method}</dd></div><div><dt>Additional information</dt><dd>{expense.additionalInformation || 'Not provided'}</dd></div><div><dt>Transaction reference</dt><dd>{expense.transactionRef || 'Not provided'}</dd></div><div><dt>Version</dt><dd>{expense.version}</dd></div></dl> : <p className="field-hint">No previous entry.</p>}</section>;
}
export function HistoryDialog({ expense, space, currency, timezone, onClose }: { expense: Expense | null; space: Space; currency: string; timezone: string; onClose: () => void }) {
  const [records, setRecords] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expense) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setRecords([]);
    api<{ records: AuditEvent[] }>(`/expenses/${encodeURIComponent(expense.id)}/history?space=${space}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setRecords(data.records); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [expense?.id, space, retry]);
  return <Dialog id="history" title="Expense history" open={Boolean(expense)} onClose={onClose} closeLabel="Close history" className="history-dialog"><div className="history-content"><p className="muted">{expense?.description} · {space === 'demo' ? 'Fictional demo space' : 'Real workspace'}</p><p className="field-hint">Saved versions, shown in {timezone}. Draft changes are not recorded.</p>{loading ? <Loading>Loading saved history…</Loading> : error ? <Notice retry={() => setRetry(value => value + 1)}>{error}</Notice> : !records.length ? <p className="empty-history">No history is available for this expense.</p> : <ol className="history-list">{records.map((record, index) => <li key={`${record.at}-${index}`}><div className="history-event-heading"><Clock3 size={16} aria-hidden="true" /><strong>{record.action === 'created' ? 'Expense created' : 'Expense updated'}</strong><time dateTime={new Date(record.at).toISOString()}>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(record.at))}</time></div><div className="history-snapshots"><Snapshot label="Before" expense={record.before} currency={currency} /><Snapshot label="After" expense={record.after} currency={currency} /></div></li>)}</ol>}</div></Dialog>;
}
