/**
 * The sender says "I paid". The chain decides.
 *
 * Rules: the intent must be pending; if the intent came from a tweet the
 * signed-in X account must be the one that wrote it; the USDG receipt must
 * carry a Transfer to the recipient wallet of at least the amount; the ETH
 * drip, if given, must go to the same wallet. Only then does status become
 * `paid`. Posting the same hash twice is harmless — the second call finds the
 * intent no longer pending and returns it as it is.
 */
import type { APIRoute } from 'astro';
import { caller } from '../../../../server/auth';
import { guard, json, fail, body, publicIntent } from '../../../../server/http';
import { verifyPayment } from '../../../../server/chain';
import { getIntent, markPaid, logEvent, txHashUsed } from '../../../../../shared/intents.mjs';

export const prerender = false;

export const POST: APIRoute = ({ request, params }) =>
  guard(async () => {
    const me = await caller(request);
    const it = await getIntent(params.id ?? '');
    if (!it) return fail('No such send.', 404);
    if (it.status !== 'pending') return json({ intent: publicIntent(it), already: true });
    if (it.source === 'x' && it.sender_x_id && me.xId !== it.sender_x_id) {
      return fail(`This send belongs to @${it.sender_handle ?? it.sender_x_id}. Sign in as that account to pay it.`, 403, { code: 'wrong-sender' });
    }
    if (!it.recipient_wallet) return fail('This send has no recipient wallet yet.', 409, { code: 'no-wallet' });

    const b = await body<{ usdgHash?: string; ethHash?: string | null }>(request);
    const used = b.usdgHash ? await txHashUsed(b.usdgHash) : null;
    if (used && used !== it.id) return fail('That transaction already paid another send.', 422, { code: 'hash-used' });
    const v = await verifyPayment({
      usdgHash: b.usdgHash ?? '', ethHash: b.ethHash ?? null, recipient: it.recipient_wallet, amountUsd: Number(it.amount_usd),
    });
    if (!v.ok) {
      await logEvent(it.id, 'paid-refused', v.reason);
      return fail(v.reason, 422, { code: 'not-verified' });
    }
    const paid = await markPaid(it.id, {
      txHash: b.usdgHash, ethTxHash: b.ethHash ?? null, senderWallet: v.from,
      senderPrivyId: me.privyId, senderXId: me.xId, senderHandle: me.xHandle,
    });
    return json({ intent: publicIntent(paid ?? it), verified: { from: v.from, usdgRaw: v.usdgRaw, ethWei: v.ethWei } });
  });
