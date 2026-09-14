import type { APIRoute } from 'astro';
import { caller } from '../../server/auth';
import { guard, json, publicIntent } from '../../server/http';
import { activityFor, claimsFor } from '../../../shared/intents.mjs';

export const prerender = false;

/** Everything the signed-in person sent or was sent. `?claims=1` narrows to what landed in their wallet. */
export const GET: APIRoute = ({ request }) =>
  guard(async () => {
    const me = await caller(request);
    const url = new URL(request.url);
    const wallet = me.wallet ?? url.searchParams.get('wallet');
    if (url.searchParams.get('claims') === '1') {
      if (!me.xId) return json({ intents: [], xId: null });
      const rows = await claimsFor(me.xId);
      return json({ intents: rows.map(publicIntent), xId: me.xId });
    }
    const rows = await activityFor({ xId: me.xId, wallet });
    return json({ intents: rows.map(publicIntent), xId: me.xId, wallet });
  });
