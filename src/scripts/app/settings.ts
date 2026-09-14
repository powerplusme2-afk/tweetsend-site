import { config } from '../../app/chain';
import { api, blockedReason, bootShell, el, esc, onWallet, privy, setHtml, setText, show, signInHtml, whoami } from './shell';

interface Config {
  chainId: number;
  chainName: string;
  usdg: string;
  gasSponsored: boolean;
  botHandle: string;
  privyAppId: string;
  xLogin: boolean | null;
  privySecret: boolean;
  xKeys: boolean;
  xRead: boolean;
  database: string;
  devFakeAuth: boolean;
}

function row(ok: boolean | null, title: string, sub: string): string {
  const mark = ok === null ? '?' : ok ? '✓' : '✗';
  const cls = ok === null ? 'is-unknown' : ok ? 'is-ok' : 'is-missing';
  return `<li><span class="setup-mark ${cls}">${mark}</span><div><b>${esc(title)}</b><span>${esc(sub)}</span></div></li>`;
}

async function paintSetup(): Promise<void> {
  const c = await api<Config>('/api/config');
  setHtml(
    '[data-setup]',
    [
      row(c.xLogin, 'Sign in with X (Privy)', c.xLogin ? 'Enabled on the Privy app.' : c.xLogin === null ? 'Could not read the Privy app config.' : `Off. Privy dashboard → app ${c.privyAppId} → Login methods → Twitter (X).`),
      row(c.privySecret, 'PRIVY_APP_SECRET', c.privySecret ? 'Set. The server can make wallets for people who have never signed in.' : 'Not set. Sends only reach people who already signed in.'),
      row(c.xRead, 'X_BEARER_TOKEN', c.xRead ? 'Set. Handles are looked up on X.' : 'Not set. Unknown handles cannot be looked up.'),
      row(c.xKeys, 'X bot keys (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET)', c.xKeys ? 'Set. The bot can reply.' : 'Not set. The bot cannot read mentions or reply.'),
      row(c.database === 'neon', 'Database', c.database === 'neon' ? 'Neon Postgres.' : 'Local PGlite (development only).'),
      row(true, 'Chain', `${c.chainName} (${c.chainId}) · USDG ${c.usdg.slice(0, 8)}… · gas ${c.gasSponsored ? 'sponsored' : 'paid by sender drip'}`),
      row(true, 'Bot handle', `@${c.botHandle}`),
    ].join(''),
  );
}

export function bootSettings(): void {
  bootShell();
  void paintSetup().catch((e) => setHtml('[data-setup]', row(false, 'Could not read /api/config', e.message)));
  el('[data-signout]')?.addEventListener('click', () => privy()?.logout());
  el('[data-link-x]')?.addEventListener('click', () => privy()?.linkX?.());
  setText('[data-chain]', `${config().name} (${config().rpc.length ? 'live' : 'no rpc'})`);

  onWallet(() => {
    const p = privy();
    const signedIn = !blockedReason(false);
    show('[data-signin-state]', !signedIn);
    show('[data-account]', signedIn);
    show('[data-signout]', signedIn);
    show('[data-link-x]', signedIn && Boolean(p?.linkX) && !p?.x);
    setText('[data-wallet]', p?.address ?? '—');
    setText('[data-signer]', p?.signer ? `${p.signer}${p.embedded ? ' (TweetSend wallet)' : ' (external)'}` : '—');
    if (!signedIn) { setHtml('[data-signin-state]', signInHtml('see your account')); return; }
    setHtml('[data-x]', p?.x ? `${p.x.avatar ? `<img class="av" src="${esc(p.x.avatar)}" alt="" width="22" height="22" style="display:inline-block;vertical-align:middle;border-radius:50%;margin-right:6px" />` : ''}@${esc(p.x.handle ?? '')}${p.x.name ? ` · ${esc(p.x.name)}` : ''}` : 'None linked');
    setText('[data-xid]', p?.x?.id ?? '—');
    setText('[data-email]', p?.email ?? '—');
    void whoami().then((me) => setText('[data-via]', me.identityVia)).catch((e) => setText('[data-via]', e.message));
  });
}
