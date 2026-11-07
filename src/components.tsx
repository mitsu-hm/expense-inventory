import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, LoaderCircle, Sprout, X } from 'lucide-react';
import { BRAND } from '../shared/config';

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <div className={`brand ${inverse ? 'brand-inverse' : ''}`}><span className="brand-symbol"><Sprout size={23} strokeWidth={1.8} aria-hidden="true" /></span><span>{BRAND.name}<span className="brand-caption">THE BUSINESS WORKSPACE</span></span></div>;
}

export function Notice({ children, tone = 'error', retry }: { children: ReactNode; tone?: 'error' | 'info' | 'success'; retry?: () => void }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><AlertCircle size={17} aria-hidden="true" /><div>{children}</div>{retry && <button className="text-button" type="button" onClick={retry}>Try again</button>}</div>;
}

export function Loading({ children = 'Loading your workspace…' }: { children?: ReactNode }) {
  return <div className="loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" /><span>{children}</span></div>;
}

/** Native modal semantics, focus containment, Escape, and focus return. */
export function Dialog({ open, onClose, title, id, children, className = '', busy = false, closeLabel = 'Close dialog' }: { open: boolean; onClose: () => void; title: string; id: string; children: ReactNode; className?: string; busy?: boolean; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={ref} className={`dialog ${className}`} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) closeRef.current(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">YOUR LEDGER, UP TO DATE</span><h2 id={`${id}-title`}>{title}</h2></div><button type="button" className="icon-button" aria-label={closeLabel} onClick={onClose} disabled={busy}><X size={20} aria-hidden="true" /></button></div>
    {children}
  </dialog>;
}

/** Payment dates are date-only; format at UTC to avoid timezone day shifts. */
export function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

/** Keep decimal strings exact (including values beyond Number's safe range). */
export function formatMoney(value: string, currency: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return `${currency} ${value}`;
  const [integer, decimals = ''] = value.split('.');
  const number = new Intl.NumberFormat('en-IN', { useGrouping: true }).format(BigInt(integer));
  const symbol = new Intl.NumberFormat('en-IN', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency;
  return `${symbol}${number}.${decimals.padEnd(2, '0')}`;
}
