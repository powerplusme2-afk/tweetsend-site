/**
 * Sign in with X, bridged into the plain-DOM app shell.
 *
 * The identity in TweetSend is the X account, not the wallet: a payment is
 * addressed to an @handle and the wallet is whatever Privy made for that X id.
 * So the bridge publishes the X profile (numeric id = Privy's `subject`,
 * handle, name, avatar) beside the wallet, plus two tokens the API routes
 * verify against Privy's public JWKS: the access token (who is signed in) and
 * the identity token (which X account and wallet that person has linked).
 *
 * Whether "Sign in with X" is even offered is read from the Privy app's own
 * public configuration at load time, not assumed. Passing a login method the
 * app does not have enabled makes Privy refuse to open the login sheet at all.
 * So: X when the app allows it, email + wallet otherwise, and the page says
 * which it got. The shared app had `twitter_oauth: false` until the client
 * switched it on (14 Sep 2026); the X button appeared on the next load with
 * no rebuild, as intended.
 *
 * The app id is a public client identifier, never a secret. It is read from
 * `PUBLIC_PRIVY_APP_ID`, falling back to the shared Privy project the sibling
 * products already use (client's instruction, 13 Sep 2026).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PrivyProvider,
  useIdentityToken,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type User,
} from '@privy-io/react-auth';
import { chainId, chainIdOf, viemChain } from './chain';

export const APP_ID = (import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined) || 'cmtwzyj3t013t0ci9h4wew655';

export interface XProfile {
  /** X numeric user id — Privy's `subject` for the twitter_oauth account. */
  id: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
}

export interface TweetSendBridge {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  /** True when the Privy app offers "Sign in with X". Read from Privy, not assumed. */
  xLogin: boolean;
  /** The reader's X account, when one is linked. */
  x: XProfile | null;
  /** The wallet TweetSend addresses payments to for this reader: the embedded one. */
  address: string | null;
  /** The wallet that signs sends: an external one if connected, else the embedded one. */
  signer: string | null;
  email: string | null;
  chainId: number | null;
  embedded: boolean;
  provider: (() => Promise<unknown>) | null;
  switchChain: ((id: number) => Promise<unknown>) | null;
  accessToken: (() => Promise<string | null>) | null;
  identityToken: string | null;
  reason?: string | null;
  login: () => void;
  logout: () => void;
  linkX: (() => void) | null;
}

function publish(bridge: TweetSendBridge): void {
  (window as unknown as { __tweetsendPrivy?: TweetSendBridge }).__tweetsendPrivy = bridge;
  window.dispatchEvent(new Event('tweetsend:wallet'));
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isEmbedded(w: ConnectedWallet): boolean {
  return w.walletClientType === 'privy';
}

function signerWallet(wallets: ConnectedWallet[]): ConnectedWallet | undefined {
  return wallets.find((w) => !isEmbedded(w)) ?? wallets.find(isEmbedded);
}

/** The embedded wallet Privy made for this user — where incoming money lands. */
function embeddedAddress(user: User | null, wallets: ConnectedWallet[]): string | null {
  const linked = user?.linkedAccounts?.find(
    (a) => a.type === 'wallet' && 'walletClientType' in a && a.walletClientType === 'privy' && a.chainType === 'ethereum',
  );
  if (linked && 'address' in linked && typeof linked.address === 'string') return linked.address;
  const w = wallets.find(isEmbedded);
  return w?.address ?? null;
}

function xOf(user: User | null): XProfile | null {
  const t = user?.twitter;
  if (!t?.subject) return null;
  return {
    id: t.subject,
    handle: t.username ?? null,
    name: t.name ?? null,
    avatar: t.profilePictureUrl ? t.profilePictureUrl.replace('_normal', '_200x200') : null,
  };
}

function emailOf(user: User | null): string | null {
  return user?.email?.address ?? null;
}

function Bridge({ xLogin }: { xLogin: boolean }) {
  const { ready, authenticated, login, logout, user, getAccessToken, linkTwitter } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets } = useWallets();
  const signer = signerWallet(wallets);
  const address = embeddedAddress(user, wallets) ?? signer?.address ?? null;
  const x = xOf(user);
  const email = emailOf(user);

  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  useEffect(() => {
    publish({
      configured: true,
      ready,
      authenticated,
      xLogin,
      x,
      address,
      signer: signer?.address ?? null,
      email,
      chainId: chainIdOf(signer?.chainId),
      embedded: signer ? isEmbedded(signer) : false,
      provider: signer ? () => signer.getEthereumProvider() : null,
      switchChain: signer ? (id: number) => signer.switchChain(id) : null,
      accessToken: () => getAccessToken(),
      identityToken,
      login: () => login(),
      logout: () => logout(),
      linkX: xLogin ? () => linkTwitter() : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, xLogin, x?.id, x?.handle, address, email, signer?.address, signer?.chainId, wallets.length, identityToken, login, logout]);

  const chipHost = document.querySelector('[data-privy-chip]');
  const wrongChain = signer && chainIdOf(signer.chainId) !== null && chainIdOf(signer.chainId) !== chainId();
  const label = x?.handle ? `@${x.handle}` : address ? short(address) : email;

  return (
    <>
      {chipHost
        ? createPortal(
            authenticated && label ? (
              <span className="wallet-chips">
                <span className={wrongChain ? 'chip is-wrong' : 'chip is-on'} title={address ?? undefined}>
                  {x?.avatar ? <img className="av" src={x.avatar} alt="" width={20} height={20} /> : <span className="dot"></span>}
                  <span>{label}</span>
                </span>
                {wrongChain ? (
                  <button className="chip chip-sub" type="button" onClick={() => signer?.switchChain(chainId())}>
                    Switch to {viemChain().name}
                  </button>
                ) : null}
                <button className="chip chip-sub" type="button" onClick={() => void logout()}>
                  Sign out
                </button>
              </span>
            ) : (
              <button className="chip" type="button" onClick={() => login()} disabled={!ready}>
                <span className="dot"></span>
                <span>{ready ? (xLogin ? 'Sign in with X' : 'Sign in') : 'Loading…'}</span>
              </button>
            ),
            chipHost,
          )
        : null}
    </>
  );
}

function NotConfigured() {
  useEffect(() => {
    publish({
      configured: false, ready: true, authenticated: false, xLogin: false, x: null,
      address: null, signer: null, email: null, chainId: null, embedded: false,
      provider: null, switchChain: null, accessToken: null, identityToken: null,
      reason: 'Login not configured',
      login: () => {}, logout: () => {}, linkX: null,
    });
  }, []);
  const chipHost = document.querySelector('[data-privy-chip]');
  return chipHost
    ? createPortal(
        <span className="chip is-off" title="PUBLIC_PRIVY_APP_ID is not set in this build">
          <span className="dot"></span>
          <span>Login not configured</span>
        </span>,
        chipHost,
      )
    : null;
}

/**
 * Asks Privy which login methods this app actually has switched on.
 *
 * Same public endpoint the SDK itself reads. If it cannot be reached the app
 * assumes the safe subset (email + wallet), which Privy has always had on.
 */
async function xLoginEnabled(): Promise<boolean> {
  try {
    const r = await fetch(`https://auth.privy.io/api/v1/apps/${APP_ID}`, {
      headers: { 'privy-app-id': APP_ID },
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { twitter_oauth?: boolean };
    return j.twitter_oauth === true;
  } catch {
    return false;
  }
}

/**
 * Dev only: a signed-in bridge without Privy, driven by `sessionStorage.devUser`
 * (the same JSON the API's `x-dev-user` header takes). Lets the screens be
 * exercised and screenshotted with no X account. Cannot sign anything —
 * `provider` is null — and is compiled out of production builds.
 */
function DevBridge({ raw }: { raw: string }) {
  useEffect(() => {
    const u = JSON.parse(raw) as { xId?: string; xHandle?: string; xName?: string; avatar?: string; wallet?: string; email?: string };
    publish({
      configured: true, ready: true, authenticated: true, xLogin: true,
      x: u.xId ? { id: u.xId, handle: u.xHandle ?? null, name: u.xName ?? null, avatar: u.avatar ?? null } : null,
      address: u.wallet ?? null, signer: u.wallet ?? null, email: u.email ?? null,
      chainId: chainId(), embedded: true, provider: null, switchChain: null,
      accessToken: null, identityToken: null,
      login: () => {}, logout: () => { sessionStorage.removeItem('devUser'); location.reload(); }, linkX: null,
    });
  }, [raw]);
  const chipHost = document.querySelector('[data-privy-chip]');
  const u = JSON.parse(raw) as { xHandle?: string };
  return chipHost ? createPortal(<span className="chip is-on"><span className="dot"></span><span>@{u.xHandle} (dev)</span></span>, chipHost) : null;
}

export function PrivyApp() {
  const [xLogin, setXLogin] = useState<boolean | null>(null);
  const devUser = import.meta.env.DEV ? sessionStorage.getItem('devUser') : null;
  useEffect(() => {
    void xLoginEnabled().then(setXLogin);
  }, []);

  if (!APP_ID) return <NotConfigured />;
  if (devUser) return <DevBridge raw={devUser} />;
  if (xLogin === null) return null;

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        appearance: {
          /* The Privy sheet matches the shell: Rulepad's dark theme and mint accent. */
          theme: 'dark',
          accentColor: '#55b1f7',
          logo: '/brand/logo-dark.svg',
          landingHeader: 'Sign in to TweetSend',
          loginMessage: 'Send crypto under a tweet.',
          showWalletLoginFirst: false,
        },
        loginMethods: xLogin ? ['twitter', 'email', 'wallet'] : ['email', 'wallet'],
        supportedChains: [viemChain()],
        defaultChain: viemChain(),
        embeddedWallets: {
          /* Every reader gets a wallet the moment they sign in — that wallet is
             where money addressed to their @handle lands. */
          ethereum: { createOnLogin: 'all-users' },
          showWalletUIs: true,
        },
      }}
    >
      <Bridge xLogin={xLogin} />
    </PrivyProvider>
  );
}
