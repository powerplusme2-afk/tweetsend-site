/**
 * Privy's REST API, the three calls TweetSend makes with its app secret.
 *
 * Used by the worker (to pre-make a wallet for a recipient who has never
 * signed in) and by the API routes (to resolve who a signed-in reader is when
 * no identity token was presented). Needs `PRIVY_APP_SECRET`; without it every
 * function here throws `privy-secret-missing` and the callers say so in words.
 *
 * Endpoints as documented on docs.privy.io, checked 12 Sep 2026. The
 * "user by Twitter subject" and "by username" lookups are UNVERIFIED against
 * a live app until spike #1 runs — see SPIKES.md.
 */

const API = 'https://auth.privy.io/api/v1';

function creds() {
  const id = process.env.PRIVY_APP_ID || process.env.PUBLIC_PRIVY_APP_ID || 'cmtwzyj3t013t0ci9h4wew655';
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) {
    const e = new Error('PRIVY_APP_SECRET is not set');
    e.code = 'privy-secret-missing';
    throw e;
  }
  return { id, secret };
}

export function privySecretPresent() {
  return Boolean(process.env.PRIVY_APP_SECRET);
}

async function call(method, path, body) {
  const { id, secret } = creds();
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      'privy-app-id': id,
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!r.ok) {
    const e = new Error(`Privy ${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
    e.code = 'privy-http';
    e.status = r.status;
    throw e;
  }
  return json;
}

/** Turns a Privy user object into the flat shape the app stores. */
export function flattenUser(u) {
  if (!u) return null;
  const accounts = u.linked_accounts ?? u.linkedAccounts ?? [];
  const tw = accounts.find((a) => a.type === 'twitter_oauth');
  const wallet =
    accounts.find((a) => a.type === 'wallet' && (a.wallet_client_type ?? a.walletClientType) === 'privy' && (a.chain_type ?? a.chainType) === 'ethereum') ??
    accounts.find((a) => a.type === 'wallet' && (a.chain_type ?? a.chainType) === 'ethereum');
  const email = accounts.find((a) => a.type === 'email');
  return {
    privyId: u.id,
    xId: tw?.subject ?? null,
    xHandle: tw?.username ?? null,
    xName: tw?.name ?? null,
    avatar: (tw?.profile_picture_url ?? tw?.profilePictureUrl ?? null)?.replace('_normal', '_200x200') ?? null,
    wallet: wallet?.address ?? null,
    email: email?.address ?? null,
  };
}

export async function getUser(did) {
  return flattenUser(await call('GET', `/users/${encodeURIComponent(did)}`));
}

/** UNVERIFIED endpoint spelling until spike #1. Returns null on 404. */
export async function getUserByXId(subject) {
  try {
    return flattenUser(await call('POST', '/users/twitter/subject', { subject: String(subject) }));
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function getUserByXHandle(username) {
  try {
    return flattenUser(await call('POST', '/users/twitter/username', { username: String(username).replace(/^@/, '') }));
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * Pre-generates a Privy user for an X account that has never signed in, with
 * an Ethereum wallet. When that X account later signs in, Privy hands them
 * this same wallet. "You can even send assets to the wallet before the user
 * logs in." — docs.privy.io, 12 Sep 2026.
 */
export async function pregenerate({ xId, handle, name }) {
  const u = await call('POST', '/users', {
    linked_accounts: [{ type: 'twitter_oauth', subject: String(xId), username: handle ?? null, name: name ?? null }],
    wallets: [{ chain_type: 'ethereum' }],
  });
  return flattenUser(u);
}

/** Find or pre-make: the call the worker and the site's send-by-handle both use. */
export async function ensureUserForX({ xId, handle, name }) {
  const found = await getUserByXId(xId);
  if (found?.wallet) return { ...found, created: false };
  const made = await pregenerate({ xId, handle, name });
  return { ...made, created: true };
}
