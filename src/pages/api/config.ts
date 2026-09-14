/**
 * What is wired and what is not — booleans only, never a value.
 *
 * The Settings page paints this as a checklist so the client can see, in the
 * app, which of the pieces they own (X login in Privy, the app secret, the X
 * API keys, the database) are in place.
 */
import type { APIRoute } from 'astro';
import { json } from '../../server/http';
import { APP_ID } from '../../server/env';
import { chainId, config } from '../../app/chain';
import { LIMITS, botHandle } from '../../../shared/command.mjs';
import { privySecretPresent, getUserByXId } from '../../../shared/privy.mjs';
import { xKeysPresent, xReadPresent, userByHandle, me, accessLevel } from '../../../shared/x.mjs';
import { databaseKind } from '../../../shared/db.mjs';

export const prerender = false;

async function xLoginEnabled(): Promise<boolean | null> {
  try {
    const r = await fetch(`https://auth.privy.io/api/v1/apps/${APP_ID}`, { headers: { 'privy-app-id': APP_ID } });
    if (!r.ok) return null;
    const j = (await r.json()) as { twitter_oauth?: boolean };
    return j.twitter_oauth === true;
  } catch {
    return null;
  }
}

/**
 * `?probe=1`: one real call each to X (a public profile lookup) and Privy (a
 * user lookup that is expected to find nobody) so the client can see that the
 * keys they entered are accepted — status codes only, never a value.
 */
async function probe(): Promise<{ x: Record<string, unknown>; bot: Record<string, unknown>; privy: Record<string, unknown> }> {
  const x = await userByHandle('X')
    .then((u) => ({ ok: true, status: 200, found: Boolean(u?.id) }))
    .catch((e: Error & { code?: string; status?: number }) => ({ ok: false, status: e.status ?? null, code: e.code ?? null, reason: e.message.replace(/Bearer\s+\S+/g, 'Bearer …') }));
  const privy = await getUserByXId('0')
    .then((u) => ({ ok: true, status: u ? 200 : 404 }))
    .catch((e: Error & { code?: string; status?: number }) => ({ ok: false, status: e.status ?? null, code: e.code ?? null, reason: e.message }));
  /* The bot account's handle is public; it is the one thing the probe names. */
  const bot = xKeysPresent()
    ? await me()
        .then(async (b) => ({ ok: true, status: 200, handle: b.handle, access: await accessLevel().catch((e: Error & { status?: number }) => `error ${e.status ?? e.message}`) }))
        .catch((e: Error & { code?: string; status?: number }) => ({ ok: false, status: e.status ?? null, code: e.code ?? null, reason: e.message }))
    : { ok: false, status: null, code: 'x-keys-missing', reason: 'X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET not set' };
  return { x, bot, privy };
}

export const GET: APIRoute = async ({ url }) => {
  const c = config();
  if (url.searchParams.get('probe') === '1') return json(await probe());
  return json({
    chainId: chainId(),
    chainName: c.name,
    usdg: c.usdg,
    explorer: c.explorer,
    gasSponsored: c.gasSponsored,
    usdgMintable: c.usdgMintable,
    limits: LIMITS,
    botHandle: botHandle(),
    privyAppId: APP_ID,
    xLogin: await xLoginEnabled(),
    privySecret: privySecretPresent(),
    xKeys: xKeysPresent(),
    xRead: xReadPresent(),
    database: databaseKind(),
    devFakeAuth: import.meta.env.DEV && process.env.DEV_FAKE_AUTH === '1',
  });
};
