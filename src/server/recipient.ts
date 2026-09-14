/**
 * Turns an @handle into the wallet money for that handle goes to.
 *
 * Order, cheapest first:
 *   1. our own users table — anyone who has signed in, or anyone the worker
 *      has already resolved;
 *   2. Privy, by X username — a pre-made user we did not record;
 *   3. X, by username → numeric id → Privy pre-generate a wallet for that id.
 * Steps 2–3 need `PRIVY_APP_SECRET`; step 3 also needs `X_BEARER_TOKEN`.
 * When a step is not wired the reason says which variable is missing, so a
 * "recipient not found" is never a mystery.
 */
import { userByHandle as dbUserByHandle, rememberX } from '../../shared/intents.mjs';
import { getUserByXHandle, ensureUserForX, privySecretPresent } from '../../shared/privy.mjs';
import { userByHandle as xUserByHandle, xReadPresent } from '../../shared/x.mjs';

export interface Recipient {
  xId: string;
  handle: string;
  name: string | null;
  avatar: string | null;
  wallet: string;
  /** True when this person has signed in at least once — they will see it without a claim. */
  signedIn: boolean;
  via: 'db' | 'privy' | 'x+privy';
}

export type Resolved = { ok: true; recipient: Recipient } | { ok: false; reason: string; code: string };

export async function resolveHandle(handleRaw: string): Promise<Resolved> {
  const handle = String(handleRaw ?? '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return { ok: false, reason: 'That is not an X handle. Letters, numbers and _ only, up to 15.', code: 'bad-handle' };
  }

  const local = await dbUserByHandle(handle);
  if (local?.wallet && local.x_id) {
    return {
      ok: true,
      recipient: {
        xId: local.x_id, handle: local.x_handle, name: local.x_name, avatar: local.avatar_url,
        wallet: local.wallet, signedIn: Boolean(local.last_login_at), via: 'db',
      },
    };
  }

  if (!privySecretPresent()) {
    return {
      ok: false,
      code: 'privy-secret-missing',
      reason: `@${handle} has not signed in to TweetSend yet, and the server cannot make a wallet for them until PRIVY_APP_SECRET is set.`,
    };
  }

  const inPrivy = await getUserByXHandle(handle);
  if (inPrivy?.wallet && inPrivy.xId) {
    await rememberX({ privyId: inPrivy.privyId, xId: inPrivy.xId, handle: inPrivy.xHandle, name: inPrivy.xName, avatar: inPrivy.avatar, wallet: inPrivy.wallet });
    return {
      ok: true,
      recipient: { xId: inPrivy.xId, handle: inPrivy.xHandle ?? handle, name: inPrivy.xName, avatar: inPrivy.avatar, wallet: inPrivy.wallet, signedIn: false, via: 'privy' },
    };
  }

  if (!xReadPresent()) {
    return {
      ok: false,
      code: 'x-keys-missing',
      reason: `@${handle} has not signed in to TweetSend yet, and the server cannot look them up on X until X_BEARER_TOKEN is set.`,
    };
  }

  const onX = await xUserByHandle(handle);
  if (!onX) return { ok: false, reason: `There is no @${handle} on X.`, code: 'no-such-handle' };
  const made = await ensureUserForX({ xId: onX.id, handle: onX.handle, name: onX.name });
  if (!made.wallet) return { ok: false, reason: 'Privy made the user but returned no wallet address.', code: 'no-wallet' };
  await rememberX({ privyId: made.privyId, xId: onX.id, handle: onX.handle, name: onX.name, avatar: onX.avatar, wallet: made.wallet });
  return {
    ok: true,
    recipient: { xId: onX.id, handle: onX.handle, name: onX.name, avatar: onX.avatar, wallet: made.wallet, signedIn: false, via: 'x+privy' },
  };
}
