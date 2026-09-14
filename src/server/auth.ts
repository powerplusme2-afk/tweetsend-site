/**
 * Who is calling an API route.
 *
 * The browser sends two Privy JWTs: the access token (`Authorization: Bearer`)
 * proves a session; the identity token (`x-identity-token`) carries the linked
 * accounts — the X id and handle, the embedded wallet — signed by Privy. Both
 * are ES256 and verified against the app's public JWKS, so no secret is
 * needed to trust them. When no identity token arrives (the Privy app has the
 * feature off — UNVERIFIED whether the shared app issues them until a real
 * X sign-in is observed) the route falls back to Privy's REST API, which needs
 * `PRIVY_APP_SECRET`. If neither path can name the caller's X account the
 * caller is treated as signed in with no X identity, and every route says
 * what that blocks.
 *
 * Dev only: `DEV_FAKE_AUTH=1` together with an `x-dev-user` header lets the
 * end-to-end test drive the routes without an X account. The check is on
 * `import.meta.env.DEV`, so a production build cannot honour the header even
 * if the variable leaks into it.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getUser, privySecretPresent } from '../../shared/privy.mjs';
import { APP_ID } from './env';

export interface Caller {
  privyId: string;
  xId: string | null;
  xHandle: string | null;
  xName: string | null;
  avatar: string | null;
  wallet: string | null;
  email: string | null;
  /** Where the X identity came from, for the status page. */
  via: 'identity-token' | 'privy-api' | 'none' | 'dev';
}

const jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`));

async function verify(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, jwks, { issuer: 'privy.io', audience: APP_ID });
  return payload;
}

interface LinkedAccount {
  type: string;
  subject?: string;
  username?: string | null;
  name?: string | null;
  profile_picture_url?: string | null;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
}

function fromLinked(privyId: string, accounts: LinkedAccount[]): Caller {
  const tw = accounts.find((a) => a.type === 'twitter_oauth');
  const wallet =
    accounts.find((a) => a.type === 'wallet' && a.wallet_client_type === 'privy' && a.chain_type === 'ethereum') ??
    accounts.find((a) => a.type === 'wallet' && a.chain_type === 'ethereum');
  const email = accounts.find((a) => a.type === 'email');
  return {
    privyId,
    xId: tw?.subject ?? null,
    xHandle: tw?.username ?? null,
    xName: tw?.name ?? null,
    avatar: tw?.profile_picture_url?.replace('_normal', '_200x200') ?? null,
    wallet: wallet?.address ?? null,
    email: email?.address ?? null,
    via: 'identity-token',
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function caller(request: Request): Promise<Caller> {
  if (import.meta.env.DEV && process.env.DEV_FAKE_AUTH === '1') {
    const raw = request.headers.get('x-dev-user');
    if (raw) {
      const u = JSON.parse(raw) as Partial<Caller>;
      if (!u.privyId) throw new AuthError('x-dev-user needs privyId');
      return {
        privyId: u.privyId, xId: u.xId ?? null, xHandle: u.xHandle ?? null, xName: u.xName ?? null,
        avatar: u.avatar ?? null, wallet: u.wallet ?? null, email: u.email ?? null, via: 'dev',
      };
    }
  }

  const auth = request.headers.get('authorization') ?? '';
  const access = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!access) throw new AuthError('Sign in first.');
  let payload: JWTPayload;
  try {
    payload = await verify(access);
  } catch {
    throw new AuthError('Your session is not valid any more. Sign in again.');
  }
  const privyId = String(payload.sub ?? '');
  if (!privyId) throw new AuthError('Token has no subject.');

  const identity = request.headers.get('x-identity-token');
  if (identity) {
    try {
      const p = await verify(identity);
      if (p.sub === privyId) {
        const accounts = (p as { linked_accounts?: string | LinkedAccount[] }).linked_accounts;
        const list: LinkedAccount[] = typeof accounts === 'string' ? (JSON.parse(accounts) as LinkedAccount[]) : (accounts ?? []);
        return fromLinked(privyId, list);
      }
    } catch {
      /* fall through to the API */
    }
  }

  if (privySecretPresent()) {
    const u = await getUser(privyId);
    if (u) {
      return { privyId, xId: u.xId, xHandle: u.xHandle, xName: u.xName, avatar: u.avatar, wallet: u.wallet, email: u.email, via: 'privy-api' };
    }
  }

  return { privyId, xId: null, xHandle: null, xName: null, avatar: null, wallet: null, email: null, via: 'none' };
}
