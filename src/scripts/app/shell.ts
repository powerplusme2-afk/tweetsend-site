/**
 * What the plain-DOM pages can see of the React sign-in layer, the API
 * client, and the states every page has to be able to paint.
 */
import type { TweetSendBridge } from '../../app/privy';
import { chainId, config, txUrl } from '../../app/chain';

export function privy(): TweetSendBridge | undefined {
  return (window as unknown as { __tweetsendPrivy?: TweetSendBridge }).__tweetsendPrivy;
}

/** Runs now and again whenever the sign-in layer reports a change. */
export function onWallet(fn: () => void): void {
  fn();
  window.addEventListener('tweetsend:wallet', fn);
}

export function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<T extends HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function show(sel: string, on: boolean, root: ParentNode = document): void {
  const node = el(sel, root);
  if (node) node.hidden = !on;
}

export function setText(sel: string, text: string, root: ParentNode = document): void {
  const node = el(sel, root);
  if (node) node.textContent = text;
}

export function setHtml(sel: string, html: string, root: ParentNode = document): void {
  const node = el(sel, root);
  if (node) node.innerHTML = html;
}

export function short(address: string | null | undefined): string {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function usd(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ icons */
const PATHS: Record<string, string> = {
  'arrow-up-right':
    'M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z',
  'arrow-down-left':
    'M197.66,69.66,83.31,184H168a8,8,0,0,1,0,16H64a8,8,0,0,1-8-8V88a8,8,0,0,1,16,0v84.69L186.34,58.34a8,8,0,0,1,11.32,11.32Z',
  copy:
    'M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z',
  check:
    'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  x: 'M214.75,211.71l-62.6-98.38,61.77-67.95a8,8,0,0,0-11.84-10.76L143.24,99.34,102.75,35.71A8,8,0,0,0,96,32H48a8,8,0,0,0-6.75,12.3l62.6,98.37-61.77,68a8,8,0,1,0,11.84,10.76l58.84-64.72,40.49,63.63A8,8,0,0,0,160,224h48a8,8,0,0,0,6.75-12.29ZM164.39,208,62.57,48h29L193.43,208Z',
};

export function icon(name: string, size = 18): string {
  const d = PATHS[name];
  if (!d) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

/** Avatar or a neutral disc with the first letter of the handle. */
export function avatar(url: string | null | undefined, handle: string | null | undefined, size = 34): string {
  if (url) return `<img class="av" src="${esc(url)}" alt="" width="${size}" height="${size}" loading="lazy" />`;
  const ch = (handle ?? '?').replace(/^@/, '').slice(0, 1).toUpperCase() || '?';
  return `<span class="av av-letter" style="width:${size}px;height:${size}px">${esc(ch)}</span>`;
}

/* ------------------------------------------------------------- the states */

export function signInHtml(what: string): string {
  const p = privy();
  const x = p?.xLogin;
  return `
    <div class="ico">${icon('x', 22)}</div>
    <h2>Sign in to ${esc(what)}</h2>
    <p>${x ? 'Sign in with the X account you use, and TweetSend makes you a wallet if you do not have one yet.' : 'Sign in with an email or a wallet. Sign in with X appears here once it is switched on in the Privy app.'}</p>
    <button class="btn btn-primary" type="button" data-signin>${x ? 'Sign in with X' : 'Sign in'}</button>`;
}

export function unreachableHtml(reason: string): string {
  return `
    <div class="ico">${icon('arrow-up-right', 22)}</div>
    <h2>Could not read TweetSend</h2>
    <p>${esc(reason)}</p>
    <p class="why">chain ${chainId()} · rpc: ${esc(config().rpc[0] ?? 'none')}</p>`;
}

export function txLink(hash: string, label = 'View on explorer'): string {
  return `<a href="${esc(txUrl(hash))}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

export const STEP_WORDS: Record<string, string> = {
  validating: 'Checking the amount…',
  'checking-balance': 'Checking your balance…',
  'switching-network': 'Pointing your wallet at this network…',
  'sending-usdg': 'Confirm the USDG transfer in your wallet…',
  'confirming-usdg': 'USDG sent — waiting for confirmation…',
  'sending-eth': 'Confirm the small ETH drip for their gas…',
  'confirming-eth': 'ETH sent — waiting for confirmation…',
  recording: 'Recording the payment…',
  done: 'Done.',
};

/** Returns the sentence to put on a disabled button, or null when it can run. */
export function blockedReason(needsWallet = true): string | null {
  const p = privy();
  if (!p) return 'Loading…';
  if (!p.configured) return p.reason ?? 'Login not configured';
  if (!p.authenticated) return p.xLogin ? 'Sign in with X' : 'Sign in';
  if (needsWallet && !p.signer) return 'No wallet yet';
  if (needsWallet && !p.provider) return 'No wallet yet';
  if (needsWallet && p.chainId !== null && p.chainId !== chainId()) return `Switch to ${config().name}`;
  return null;
}

export function statusPill(status: string): string {
  const cls = status === 'pending' ? 'is-wait' : status === 'expired' ? 'is-none' : 'is-back';
  const word = status === 'paid' ? 'Waiting to be claimed' : status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="pill ${cls}">${esc(word)}</span>`;
}

/* --------------------------------------------------------------------- api */

export interface ApiError extends Error {
  status: number;
  code?: string;
}

/** Fetch with the two Privy tokens attached. Throws an ApiError with the server's sentence. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const p = privy();
  const headers = new Headers(init.headers ?? {});
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (p?.accessToken) {
    const t = await p.accessToken();
    if (t) headers.set('authorization', `Bearer ${t}`);
  }
  if (p?.identityToken) headers.set('x-identity-token', p.identityToken);
  const dev = sessionStorage.getItem('devUser');
  if (dev) headers.set('x-dev-user', dev);
  const r = await fetch(path, { ...init, headers });
  const j = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) {
    const e = new Error(j.error ?? `Request failed (${r.status})`) as ApiError;
    e.status = r.status;
    e.code = j.code;
    throw e;
  }
  return j as T;
}

export interface Me {
  user: { privyId: string; xId: string | null; xHandle: string | null; xName: string | null; avatar: string | null; wallet: string | null; email: string | null };
  identityVia: string;
  claimedNow: number;
}

let meCache: Promise<Me> | null = null;
let meKey = '';

/** Registers the signed-in person once per session and returns who they are. */
export function whoami(force = false): Promise<Me> {
  const p = privy();
  const key = `${p?.authenticated}:${p?.x?.id}:${p?.address}`;
  if (!meCache || force || key !== meKey) {
    meKey = key;
    meCache = api<Me>('/api/me', { method: 'POST', body: JSON.stringify({ wallet: p?.address ?? null }) });
  }
  return meCache;
}

/* ------------------------------------------------------------------ sheets */

let sheetReturn: HTMLElement | null = null;

function trap(e: KeyboardEvent): void {
  const open = document.querySelector<HTMLElement>('[data-sheet].is-open');
  if (!open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSheets();
    return;
  }
  if (e.key !== 'Tab') return;
  const stops = Array.from(
    open.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea'),
  ).filter((node) => node.offsetParent !== null);
  if (!stops.length) return;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function openSheet(name: string): void {
  sheetReturn = document.activeElement as HTMLElement | null;
  document.querySelectorAll<HTMLElement>('[data-sheet]').forEach((node) => {
    const on = node.dataset.sheet === name;
    node.classList.toggle('is-open', on);
    node.hidden = !on;
    if (!on) return;
    const box = node.querySelector<HTMLElement>('.box');
    const head = box?.querySelector<HTMLElement>('h2');
    if (box) {
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      if (head) {
        if (!head.id) head.id = `sheet-${name}-title`;
        box.setAttribute('aria-labelledby', head.id);
      }
    }
    (node.querySelector<HTMLElement>('input, select, textarea') ?? node.querySelector<HTMLElement>('[data-confirm]'))?.focus();
  });
  document.addEventListener('keydown', trap);
  document.body.style.overflow = 'hidden';
}

export function closeSheets(): void {
  document.querySelectorAll<HTMLElement>('[data-sheet]').forEach((node) => {
    node.classList.remove('is-open');
    node.hidden = true;
  });
  document.removeEventListener('keydown', trap);
  document.body.style.overflow = '';
  sheetReturn?.focus();
  sheetReturn = null;
}

export function sheetErr(root: ParentNode, msg: string | null): void {
  const node = el<HTMLElement>('[data-sheet-err]', root);
  if (!node) return;
  node.hidden = !msg;
  node.textContent = msg ?? '';
}

export function sheetNote(root: ParentNode, msg: string | null): void {
  const node = el<HTMLElement>('[data-sheet-note]', root);
  if (!node) return;
  node.hidden = !msg;
  node.textContent = msg ?? '';
}

export function sheetBusy(root: ParentNode, busy: boolean): void {
  root.querySelectorAll<HTMLButtonElement>('[data-confirm]').forEach((b) => {
    b.disabled = busy;
  });
}

/* ------------------------------------------------------------------ common */

export function bootShell(): void {
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((node) => {
    node.addEventListener('click', () => closeSheets());
  });
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('[data-signin]');
    if (!btn) return;
    privy()?.login();
  });
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.<HTMLElement>('[data-copy]');
    if (!btn) return;
    const v = btn.dataset.copy ?? '';
    void navigator.clipboard?.writeText(v);
    const was = btn.innerHTML;
    btn.innerHTML = icon('check', 16);
    setTimeout(() => { btn.innerHTML = was; }, 900);
  });
  onWallet(() => {
    const p = privy();
    show('[data-xlogin-off]', Boolean(p && p.configured && p.ready && !p.xLogin));
  });
}

export function poll(fn: () => Promise<void>, everyMs = 20_000): void {
  let inFlight = false;
  const run = async () => {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try {
      await fn();
    } finally {
      inFlight = false;
    }
  };
  void run();
  setInterval(() => void run(), everyMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void run();
  });
}
