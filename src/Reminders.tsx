import { useEffect, useRef, useState } from 'react';
import { Bell, Upload, PenLine } from 'lucide-react';
import { DEFAULTS, formatReminderMessage } from '../shared/config';
import type { Session } from '../shared/types';
import { api, errorMessage } from './api';
import { Dialog, Notice } from './components';
import './reminders.css';
interface ReminderState {due:boolean;dueAt:number;now:number;intervalMinutes:number}
export function ReminderAgent({userId,onUpload,onManual}:{userId:string;onUpload:()=>void;onManual:()=>void}) {
 const [tabId]=useState(()=>crypto.randomUUID()),[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [intervalMinutes,setIntervalMinutes]=useState<number>(DEFAULTS.reminderMinutes);
 const deferUntil=useRef(0),channel=useRef<BroadcastChannel|null>(null),actions=useRef({onUpload,onManual});actions.current={onUpload,onManual};
 useEffect(()=>{
  let active=true,inFlight=false;
  if(typeof BroadcastChannel!=='undefined')channel.current=new BroadcastChannel('ledger-reminders-'+userId);
  const check=async()=>{
   if(!active||inFlight||document.visibilityState==='hidden')return;inFlight=true;
   try {const state=await api<ReminderState>('/reminders/claim',{method:'POST',body:JSON.stringify({tabId})});if(active){setIntervalMinutes(state.intervalMinutes);setOpen(state.due&&Date.now()>=deferUntil.current);setError('');}}
   catch{if(active)setError('Reminders are reconnecting. Your forms and saved records are unchanged.');}finally{inFlight=false;}
  };
  const release=()=>{setOpen(false);void fetch('/api/reminders/release',{method:'POST',headers:{'content-type':'application/json','x-ledger-request':'1'},credentials:'same-origin',body:JSON.stringify({tabId}),keepalive:true}).catch(()=>{});};
  const visibility=()=>{if(document.visibilityState==='hidden')release();else void check();};
  const activity=()=>{deferUntil.current=0;setOpen(false);channel.current?.postMessage({type:'activity'});void check();};
  if(channel.current)channel.current.onmessage=event=>{if(event.data?.type==='activity'||event.data?.type==='dismiss'){setOpen(false);deferUntil.current=0;void check();}};
  const timer=window.setInterval(()=>void check(),5000);void check();
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',release);window.addEventListener('ledger-activity',activity);
  return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',release);window.removeEventListener('ledger-activity',activity);release();channel.current?.close();channel.current=null;};
 },[userId,tabId]);
 const dismiss=async()=>{
  if(busy)return;setBusy(true);setError('');
  try{await api('/reminders/dismiss',{method:'POST',body:JSON.stringify({tabId})});setOpen(false);deferUntil.current=0;channel.current?.postMessage({type:'dismiss'});}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 };
 const act=(type:'upload'|'manual')=>{deferUntil.current=Date.now()+120000;setOpen(false);if(type==='upload')actions.current.onUpload();else actions.current.onManual();};
 return <>{error&&!open&&<div className="reminder-connection" role="status">{error}</div>}<Dialog id="inactivity-reminder" title="Time to update your ledger" open={open} onClose={()=>void dismiss()} busy={busy} className="reminder-dialog" closeLabel="Dismiss reminder"><div className="reminder-message"><Bell size={26} aria-hidden="true" /><p>{formatReminderMessage(intervalMinutes)}</p></div>{error&&<Notice>{error}</Notice>}<p className="field-hint">Your current form stays intact. A successful upload or saved manual entry resets the timer. Dismiss postpones the next reminder for your configured interval.</p><div className="reminder-actions"><button type="button" className="button button-primary" disabled={busy} onClick={()=>act('upload')}><Upload size={16} aria-hidden="true" />Upload Screenshot</button><button type="button" className="button button-secondary" disabled={busy} onClick={()=>act('manual')}><PenLine size={16} aria-hidden="true" />Manual Entry</button><button type="button" className="text-button" disabled={busy} onClick={()=>void dismiss()}>Dismiss</button></div></Dialog></>;
}
export function ReminderSettings({session,onUpdated,onBack}:{session:Session;onUpdated:(session:Session)=>void;onBack:()=>void}) {
 const [timezone,setTimezone]=useState(session.settings.timezone),[week,setWeek]=useState(session.settings.weekStartsOn),[minutes,setMinutes]=useState(String(session.settings.reminderMinutes)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const submit=async(event:React.FormEvent)=>{event.preventDefault();setBusy(true);setError('');setSaved(false);try{await api('/settings',{method:'PATCH',body:JSON.stringify({timezone,weekStartsOn:week,reminderMinutes:Number(minutes)})});const fresh=await api<Session>('/session');onUpdated(fresh);setSaved(true);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
 return <section className="reminder-settings"><div><span className="eyebrow">A GENTLE NUDGE, ON YOUR TERMS</span><h1>Reminders</h1><p className="muted">Preferences are saved per signed-in user and shared across your tabs.</p></div><div className="settings-card"><h2>In-app inactivity reminders</h2><p>Reminders run while this website is open. Only one visible tab shows a reminder at a time. Successful uploads and saved manual entries restart the interval; dismissal postpones the next reminder.</p><blockquote>{formatReminderMessage(session.settings.reminderMinutes)}</blockquote><form onSubmit={event=>void submit(event)}><fieldset disabled={busy}><legend className="sr-only">Workspace preferences</legend><label>Reminder interval (minutes)<input type="number" min="1" max="1440" required value={minutes} onChange={e=>{setMinutes(e.target.value);setSaved(false);}} /></label><label>Business timezone<input required value={timezone} onChange={e=>{setTimezone(e.target.value);setSaved(false);}} placeholder="Asia/Kolkata" /></label><label>Calendar week starts<select aria-label="Calendar week starts" value={week} onChange={e=>{setWeek(Number(e.target.value));setSaved(false);}}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label></fieldset><p className="field-hint">Amounts are recorded in INR; changing currency is not supported. Reports use payment dates and calendar months. Changing the reminder interval starts a new interval.</p>{error&&<Notice>{error}</Notice>}{saved&&<Notice tone="success">Preferences saved.</Notice>}<div className="button-group"><button type="submit" className="button button-primary" disabled={busy}>{busy?'Saving…':'Save preferences'}</button><button type="button" className="button button-secondary" onClick={onBack}>Back to expenses</button></div></form></div><Notice tone="info">There are no closed-browser notifications, push messages, emails, or external inventory synchronization in this local version.</Notice></section>;
}
