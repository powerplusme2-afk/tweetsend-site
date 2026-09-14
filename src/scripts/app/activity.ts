import { config, usdgDecimals } from '../../app/chain';
import { usdgBalance, gasBalance } from '../../app/chain/tx';
import { formatUnits } from 'viem';
import {
  api, avatar, blockedReason, bootShell, el, esc, icon, onWallet, poll, privy, setHtml, setText, short, show,
  signInHtml, statusPill, txLink, usd, when, whoami,
} from './shell';

interface Intent {
  id: string;
  sender_x_id: string | null;
  sender_handle: string | null;
  sender_wallet: string | null;
  recipient_x_id: string;
  recipient_handle: string | null;
  recipient_wallet: string | null;
  amount_usd: number;
  status: string;
  source: string;
  tx_hash: string | null;
  created_at: string;
  paid_at: string | null;
}

let rows: Intent[] = [];
let filter = 'all';
let meX: string | null = null;
let meWallet: string | null = null;

function direction(i: Intent): 'sent' | 'received' {
  if (meX && i.sender_x_id === meX) return 'sent';
  if (meWallet && i.sender_wallet && i.sender_wallet.toLowerCase() === meWallet.toLowerCase()) return 'sent';
  return 'received';
}

function paint(): void {
  const list = rows.filter((i) => {
    if (filter === 'all') return true;
    if (filter === 'sent') return direction(i) === 'sent';
    if (filter === 'received') return direction(i) === 'received';
    return i.status === filter;
  });
  show('[data-empty]', list.length === 0 && rows.length === 0);
  setHtml(
    '[data-rows]',
    list
      .map((i) => {
        const dir = direction(i);
        const who = dir === 'sent' ? i.recipient_handle ?? short(i.recipient_wallet) : i.sender_handle ?? short(i.sender_wallet) ?? 'someone';
        const href = i.status === 'pending' && dir === 'sent' ? `/pay/${i.id}` : `/pay/${i.id}`;
        return `<li>
          <span class="ico ${dir === 'received' ? 'is-in' : ''}">${icon(dir === 'sent' ? 'arrow-up-right' : 'arrow-down-left', 18)}</span>
          <div class="who">
            <b>${dir === 'sent' ? 'To' : 'From'} <a href="${href}">@${esc(who)}</a> ${statusPill(i.status)}</b>
            <span>${esc(i.source === 'x' ? 'from a tweet' : 'from the site')}${i.tx_hash ? ' · ' + txLink(i.tx_hash, 'tx') : ''}</span>
          </div>
          <div class="val"><b>${dir === 'sent' ? '−' : '+'}${usd(i.amount_usd)}</b><time>${esc(when(i.paid_at ?? i.created_at))}</time></div>
        </li>`;
      })
      .join(''),
  );
}

async function load(): Promise<void> {
  const p = privy();
  if (!p?.authenticated) return;
  const me = await whoami();
  meX = me.user.xId;
  meWallet = me.user.wallet ?? p.address;
  const r = await api<{ intents: Intent[] }>('/api/activity');
  rows = r.intents;
  paint();
  const w = meWallet;
  if (w) {
    setText('[data-wallet-short]', short(w));
    const c = el<HTMLElement>('[data-wallet-copy]');
    if (c) { c.dataset.copy = w; c.innerHTML = icon('copy', 15); }
    try {
      const [u, g] = await Promise.all([usdgBalance(w), gasBalance(w)]);
      setText('[data-balance]', Number(formatUnits(u, usdgDecimals())).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      const eth = Number(formatUnits(g, 18));
      setText('[data-gas]', `${eth === 0 ? '0' : eth.toFixed(5)} ETH${config().gasSponsored ? ' (sponsored)' : ''}`);
    } catch (e) {
      setText('[data-balance]', '—');
      setText('[data-gas]', 'could not read');
    }
  }
  setText('[data-chain]', config().name);
}

export function bootActivity(): void {
  bootShell();
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      filter = b.dataset.filter ?? 'all';
      document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('is-on', x === b));
      paint();
    });
  });
  onWallet(() => {
    const blocked = blockedReason(false);
    const signedIn = !blocked;
    show('[data-signed-out]', !signedIn);
    show('[data-live]', signedIn);
    if (!signedIn) setHtml('[data-signin-state]', signInHtml('see your activity'));
    else void load().catch((e) => { setText('[data-error]', e.message); show('[data-error]', true); });
  });
  poll(async () => {
    if (privy()?.authenticated) await load().catch(() => {});
  });
  /* Avatars are not used in rows yet; keep the helper referenced for the bundle. */
  void avatar;
}
