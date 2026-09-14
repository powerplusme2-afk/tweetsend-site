/**
 * One intent, as the pay page and the activity rows see it.
 *
 * Public by design: the id is the capability (10 chars, 50 bits, unguessable)
 * and the bot posts it under a tweet. It shows the recipient's handle and
 * avatar, the amount and the status — the things a sender must see before
 * signing — and never the sender's Privy id.
 */
import type { APIRoute } from 'astro';
import { guard, json, fail, publicIntent } from '../../../server/http';
import { getIntent, eventsFor, userByXId } from '../../../../shared/intents.mjs';

export const prerender = false;

export const GET: APIRoute = ({ params }) =>
  guard(async () => {
    const it = await getIntent(params.id ?? '');
    if (!it) return fail('No such send.', 404);
    const recipient = it.recipient_x_id ? await userByXId(it.recipient_x_id) : null;
    const events = await eventsFor(it.id);
    return json({
      intent: publicIntent(it),
      recipient: recipient
        ? { handle: recipient.x_handle, name: recipient.x_name, avatar: recipient.avatar_url, signedIn: Boolean(recipient.last_login_at) }
        : { handle: it.recipient_handle, name: null, avatar: null, signedIn: false },
      events,
    });
  });
