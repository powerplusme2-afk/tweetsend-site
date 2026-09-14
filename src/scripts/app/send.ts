import { formatUnits, parseUnits } from 'viem';
import { config, usdgDecimals } from '../../app/chain';
import { usdgBalance, mintTest } from '../../app/chain/tx';
import { LIMITS } from '../../../shared/command.mjs';
import {
  api, avatar, blockedReason, bootShell, closeSheets, el, esc, onWallet, openSheet, privy, setHtml, setText,
  short, show, signInHtml, usd, whoami, type ApiError,
} from './shell';
import { dripSentence, paintDone, runPayment, DRIP_ETH_LABEL } from './payflow';

interface Recipient {
  xId: string;
  handle: string;
  name: string | null;
  avatar: string | null;
  wallet: string;
  signedIn: boolean;
}

let recipient: Recipient | null = null;
let lookupTimer: number | undefined;
let balanceRaw: bigint | null = null;

function amountValue(): number {
  const raw = (el<HTMLInputElement>('[data-amount]')?.value ?? '').replace(/,/g, '').trim();
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function lookup(): Promise<void> {
  const handle = (el<HTMLInputElement>('[data-to]')?.value ?? '').replace(/^@/, '').trim();
  recipient = null;
  show('[data-recipient]', false);
  if (!handle) {
    setText('[data-to-line]', 'Type an X handle. The money goes to the wallet that belongs to that account.');
    return;
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    setText('[data-to-line]', 'Letters, numbers and _ only.');
    return;
  }
  setText('[data-to-line]', `Looking up @${handle}…`);
  try {
    const r = await api<{ recipient: Recipient }>(`/api/intents?handle=${encodeURIComponent(handle)}`);
    recipient = r.recipient;
    setText('[data-to-line]', recipient.signedIn ? `@${recipient.handle} has a TweetSend wallet.` : `@${recipient.handle} has not signed in yet — the money waits in a wallet made for them.`);
    setHtml(
      '[data-recipient]',
      `${avatar(recipient.avatar, recipient.handle, 40)}<div><b>${esc(recipient.name ?? '@' + recipient.handle)}</b><span>@${esc(recipient.handle)} · <span class="mono">${esc(short(recipient.wallet))}</span></span></div>`,
    );
    show('[data-recipient]', true);
  } catch (err) {
    const e = err as ApiError;
    setText('[data-to-line]', e.message);
  }
}

async function readBalance(): Promise<void> {
  const p = privy();
  const w = p?.signer;
  if (!w) return;
  try {
    balanceRaw = await usdgBalance(w);
    const n = Number(formatUnits(balanceRaw, usdgDecimals()));
    setText('[data-balance-line]', `You have ${usd(n)} in ${p?.embedded ? 'your TweetSend wallet' : short(w)}.`);
    show('[data-mint]', config().usdgMintable && n < 5);
  } catch {
    setText('[data-balance-line]', 'Could not read your balance.');
  }
}

function review(): void {
  show('[data-error]', false);
  const amount = amountValue();
  if (!recipient) {
    setText('[data-error]', 'Pick a recipient first — type their X handle.');
    show('[data-error]', true);
    return;
  }
  if (amount < LIMITS.minUsd || amount > LIMITS.maxUsd) {
    setText('[data-error]', `Sends are $${LIMITS.minUsd}–$${LIMITS.maxUsd}.`);
    show('[data-error]', true);
    return;
  }
  if (balanceRaw !== null && balanceRaw < parseUnits(amount.toFixed(2), usdgDecimals())) {
    setText('[data-error]', `You have ${usd(Number(formatUnits(balanceRaw, usdgDecimals())))} and this send is ${usd(amount)}.`);
    show('[data-error]', true);
    return;
  }
  const sheet = el<HTMLElement>('[data-sheet="review"]')!;
  setHtml('[data-r-to]', `@${esc(recipient.handle)}${recipient.name ? ` · ${esc(recipient.name)}` : ''}`, sheet);
  setText('[data-r-amount]', `${usd(amount)} USDG`, sheet);
  setText('[data-r-wallet]', recipient.wallet, sheet);
  setText('[data-r-chain]', config().name, sheet);
  show('[data-r-drip-row]', !config().gasSponsored, sheet);
  setText('[data-r-drip]', DRIP_ETH_LABEL, sheet);
  openSheet('review');
}

async function confirm(): Promise<void> {
  const sheet = el<HTMLElement>('[data-sheet="review"]')!;
  if (!recipient) return;
  const amount = amountValue();
  let intent: { id: string; recipient_wallet: string | null; recipient_handle: string | null; amount_usd: number };
  try {
    const r = await api<{ intent: typeof intent }>('/api/intents', {
      method: 'POST',
      body: JSON.stringify({ handle: recipient.handle, amount }),
    });
    intent = r.intent;
  } catch (err) {
    const node = el<HTMLElement>('[data-sheet-err]', sheet);
    if (node) { node.hidden = false; node.textContent = (err as Error).message; }
    return;
  }
  const o = await runPayment(intent, sheet);
  if (!o.ok) return;
  closeSheets();
  const done = el<HTMLElement>('[data-sheet="done"]')!;
  setText('[data-done-line]', `${usd(amount)} is in @${recipient.handle}'s wallet. ${recipient.signedIn ? 'They will see it in Activity.' : 'They claim it by signing in with X.'}`, done);
  paintDone(done, o);
  openSheet('done');
  void readBalance();
}

async function mint(): Promise<void> {
  const p = privy();
  if (!p?.signer || !p.provider) return;
  const btn = el<HTMLButtonElement>('[data-mint]');
  if (btn) { btn.disabled = true; btn.textContent = 'Minting…'; }
  const r = await mintTest({ to: p.signer, amountRaw: parseUnits('100', usdgDecimals()), provider: await p.provider() });
  if (btn) { btn.disabled = false; btn.textContent = 'Get 100 test USDG (testnet)'; }
  if (r.reason) { setText('[data-error]', r.reason); show('[data-error]', true); }
  await readBalance();
}

export function bootSend(): void {
  bootShell();
  setText('[data-limits-line]', `Sends are $${LIMITS.minUsd}–$${LIMITS.maxUsd}, up to $${LIMITS.dailyUsd.toLocaleString()} a day.`);
  setText('[data-drip-line]', dripSentence());
  el<HTMLInputElement>('[data-to]')?.addEventListener('input', () => {
    window.clearTimeout(lookupTimer);
    lookupTimer = window.setTimeout(() => void lookup(), 450);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach((b) => {
    b.addEventListener('click', () => {
      const a = el<HTMLInputElement>('[data-amount]');
      if (a) a.value = b.dataset.fill ?? '';
    });
  });
  el('[data-review]')?.addEventListener('click', review);
  el('[data-confirm]')?.addEventListener('click', () => void confirm());
  el('[data-mint]')?.addEventListener('click', () => void mint());
  el('[data-send-again]')?.addEventListener('click', () => {
    const a = el<HTMLInputElement>('[data-amount]');
    if (a) a.value = '';
  });

  const q = new URLSearchParams(location.search);
  const to = q.get('to');
  if (to) {
    const i = el<HTMLInputElement>('[data-to]');
    if (i) i.value = to.replace(/^@/, '');
  }

  onWallet(() => {
    const blocked = blockedReason(true);
    const btn = el<HTMLButtonElement>('[data-review]');
    if (btn) { btn.disabled = Boolean(blocked); btn.textContent = blocked ?? 'Review'; }
    const signedIn = !blockedReason(false);
    show('[data-signed-out]', !signedIn);
    show('[data-live]', signedIn);
    if (!signedIn) { setHtml('[data-signin-state]', signInHtml('send by handle')); return; }
    void whoami();
    void readBalance();
    if (to && !recipient) void lookup();
  });
}
