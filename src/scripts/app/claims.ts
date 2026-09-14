import { api, blockedReason, bootShell, el, esc, icon, onWallet, poll, privy, setHtml, setText, show, signInHtml, statusPill, txLink, usd, when, whoami } from './shell';

interface Intent {
  id: string;
  sender_handle: string | null;
  sender_wallet: string | null;
  amount_usd: number;
  status: string;
  tx_hash: string | null;
  paid_at: string | null;
  created_at: string;
}

async function load(): Promise<void> {
  const me = await whoami();
  show('[data-no-x]', !me.user.xId);
  const link = el<HTMLButtonElement>('[data-link-x]');
  if (link) { link.hidden = !privy()?.linkX; link.onclick = () => privy()?.linkX?.(); }
  if (me.user.xHandle) setText('[data-me-handle]', `@${me.user.xHandle}`);
  if (me.claimedNow > 0) {
    setText('[data-claimed-now]', `${me.claimedNow} payment${me.claimedNow === 1 ? '' : 's'} claimed just now by signing in.`);
    show('[data-claimed-now]', true);
  }
  const r = await api<{ intents: Intent[] }>('/api/activity?claims=1');
  show('[data-empty]', r.intents.length === 0);
  setHtml(
    '[data-rows]',
    r.intents
      .map(
        (i) => `<li>
        <span class="ico is-claim">${icon('arrow-down-left', 18)}</span>
        <div class="who">
          <b>From @${esc(i.sender_handle ?? 'someone')} ${statusPill(i.status)}</b>
          <span>${i.tx_hash ? txLink(i.tx_hash, 'View transaction') : ''}</span>
        </div>
        <div class="val"><b>+${usd(i.amount_usd)}</b><time>${esc(when(i.paid_at ?? i.created_at))}</time></div>
      </li>`,
      )
      .join(''),
  );
}

export function bootClaims(): void {
  bootShell();
  onWallet(() => {
    const signedIn = !blockedReason(false);
    show('[data-signed-out]', !signedIn);
    show('[data-live]', signedIn);
    if (!signedIn) { setHtml('[data-signin-state]', signInHtml('see what was sent to you')); return; }
    void load().catch((e) => { setText('[data-error]', e.message); show('[data-error]', true); });
  });
  poll(async () => {
    if (privy()?.authenticated) await load().catch(() => {});
  });
}
