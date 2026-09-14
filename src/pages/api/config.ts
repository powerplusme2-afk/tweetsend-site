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
import { LIMITS, BOT_HANDLE } from '../../../shared/command.mjs';
import { privySecretPresent } from '../../../shared/privy.mjs';
import { xKeysPresent, xReadPresent } from '../../../shared/x.mjs';
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

export const GET: APIRoute = async () => {
  const c = config();
  return json({
    chainId: chainId(),
    chainName: c.name,
    usdg: c.usdg,
    explorer: c.explorer,
    gasSponsored: c.gasSponsored,
    usdgMintable: c.usdgMintable,
    limits: LIMITS,
    botHandle: BOT_HANDLE,
    privyAppId: APP_ID,
    xLogin: await xLoginEnabled(),
    privySecret: privySecretPresent(),
    xKeys: xKeysPresent(),
    xRead: xReadPresent(),
    database: databaseKind(),
    devFakeAuth: import.meta.env.DEV && process.env.DEV_FAKE_AUTH === '1',
  });
};
