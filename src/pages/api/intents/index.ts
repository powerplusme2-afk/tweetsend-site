/**
 * Send from the site: `POST { handle, amount }` → a pending intent, same
 * pipeline as a tweet, `source = site`, no bot reply.
 */
import type { APIRoute } from 'astro';
import { caller } from '../../../server/auth';
import { guard, json, fail, body, publicIntent } from '../../../server/http';
import { resolveHandle } from '../../../server/recipient';
import { createIntent, senderDayTotal } from '../../../../shared/intents.mjs';
import { LIMITS } from '../../../../shared/command.mjs';
import { chainId } from '../../../app/chain';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    const me = await caller(request);
    const b = await body<{ handle?: string; amount?: number | string }>(request);
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < LIMITS.minUsd || amount > LIMITS.maxUsd) {
      return fail(`Sends are $${LIMITS.minUsd}–$${LIMITS.maxUsd}.`, 422, { code: 'limits' });
    }
    const r = await resolveHandle(b.handle ?? '');
    if (!r.ok) return fail(r.reason, 422, { code: r.code });
    if (me.xId && r.recipient.xId === me.xId) return fail("You can't send to yourself.", 422, { code: 'self' });

    if (me.xId) {
      const today = await senderDayTotal(me.xId);
      if (today + amount > LIMITS.dailyUsd) {
        return fail(`That would take you past $${LIMITS.dailyUsd} in 24 hours ($${today.toFixed(2)} so far).`, 422, { code: 'daily' });
      }
    }

    const { intent } = await createIntent({
      senderXId: me.xId, senderHandle: me.xHandle, senderPrivyId: me.privyId,
      recipientXId: r.recipient.xId, recipientHandle: r.recipient.handle, recipientWallet: r.recipient.wallet,
      amountUsd: amount, chain: chainId(), source: 'site',
    });
    return json({ intent: publicIntent(intent), recipient: r.recipient });
  });

/** `GET ?handle=bob` — preview who a handle resolves to, before an amount is typed. */
export const GET: APIRoute = ({ request }) =>
  guard(async () => {
    await caller(request);
    const handle = new URL(request.url).searchParams.get('handle') ?? '';
    const r = await resolveHandle(handle);
    if (!r.ok) return fail(r.reason, 422, { code: r.code });
    return json({ recipient: r.recipient });
  });
