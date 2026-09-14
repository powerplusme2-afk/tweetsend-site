/**
 * "Who am I" — and the moment a recipient claims.
 *
 * Called by every app page after sign-in. Records the person (X id, handle,
 * embedded wallet), and if anything was paid to their X id while they were
 * away, marks it claimed — that is the whole claim step: signing in with the
 * same X account is the proof.
 */
import type { APIRoute } from 'astro';
import { caller } from '../../server/auth';
import { guard, json, body } from '../../server/http';
import { upsertUser, claimAllFor } from '../../../shared/intents.mjs';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    const me = await caller(request);
    /* The embedded wallet the browser sees is accepted only when the server
       could not learn it itself, and never overrides a wallet already on
       record for this Privy id. Money is addressed to the wallet the server
       resolved for an X id; a browser cannot redirect it. */
    const b = await body<{ wallet?: string }>(request);
    const wallet = me.wallet ?? (b.wallet && /^0x[0-9a-fA-F]{40}$/.test(b.wallet) ? b.wallet : null);
    const user = await upsertUser({
      privyId: me.privyId, xId: me.xId, xHandle: me.xHandle, xName: me.xName, avatar: me.avatar, wallet, email: me.email,
    });
    const claimed = me.xId ? await claimAllFor(me.xId) : 0;
    return json({
      user: {
        privyId: user.privy_id, xId: user.x_id, xHandle: user.x_handle, xName: user.x_name,
        avatar: user.avatar_url, wallet: user.wallet, email: user.email,
      },
      identityVia: me.via,
      claimedNow: claimed,
    });
  });
