import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { BRAND } from '../shared/config';
import type { Session } from '../shared/types';
import { api, errorMessage } from './api';
import { Brand, Notice } from './components';

export function Auth({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { document.title = `${BRAND.name} · ${register ? 'Create account' : 'Sign in'}`; }, [register]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      const session = await api<Session>(register ? '/register' : '/login', { method: 'POST', body: JSON.stringify(register ? { name: name.trim(), email: email.trim(), password } : { email: email.trim(), password }) });
      onAuthenticated(session);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <main className="auth-shell">
    <section className="auth-story" aria-label="About your workspace"><Brand inverse /><div className="auth-story-content"><span className="eyebrow">A LITTLE CLARITY. EVERY DAY.</span><h1>Good business starts<br />with clear books.</h1><p>{BRAND.tagline}</p><div className="auth-rule" /><div className="auth-benefit"><Check size={18} aria-hidden="true" /><span>Record every expense, with the details intact.</span></div><div className="auth-benefit"><Check size={18} aria-hidden="true" /><span>A separate demo space. Your real books stay yours.</span></div></div><span className="auth-story-footer">Less scattered. More in order.</span></section>
    <section className="auth-form-section"><div className="auth-mobile-brand"><Brand /></div><div className="auth-form-card"><span className="eyebrow">YOUR BUSINESS, IN GOOD ORDER</span><h2>{register ? 'A fresh start for your books' : 'Welcome back'}</h2><p className="muted">{register ? 'Create your own workspace. Start with a clean ledger.' : 'Sign in to pick up right where you left off.'}</p>
      <form onSubmit={submit} className="auth-form" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {register && <label>Your name<input name="name" autoComplete="name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} placeholder="you@yourbusiness.com" /></label>
        <label htmlFor="auth-password">Password</label><div className="password-field"><input id="auth-password" name="password" type={visible ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} aria-describedby={register ? 'password-hint' : undefined} /><button className="icon-button" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        {register && <p className="field-hint" id="password-hint">Use at least 10 characters.</p>}
        <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}<ArrowRight size={17} aria-hidden="true" /></button>
      </form>
      <p className="auth-switch">{register ? 'Already have a workspace?' : 'New to the workspace?'} <button type="button" className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Sign in instead' : 'Create an account'}</button></p>
      <div className="auth-assurance"><ShieldCheck size={16} aria-hidden="true" /><span>Your records are private to your account.</span></div>
    </div><span className="auth-bottom">A considered workspace for everyday business.</span></section>
  </main>;
}
