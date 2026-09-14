/**
 * One X Activity event, handed in by the relay (`worker/relay.mjs`) that
 * holds the stream open. Same handling as the webhook route, but the caller
 * is ours, so the check is TICK_TOKEN instead of X's signature, and the
 * answer waits for the reply to be posted (the relay has time; X does not).
 */
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { json, fail, guard } from '../../../server/http';
import { handleActivityEvent } from '../../../../shared/bot.mjs';
import { logEvent } from '../../../../shared/db.mjs';

export const prerender = false;

function allowed(request: Request): boolean {
  const token = process.env.TICK_TOKEN;
  if (!token) return false;
  const auth = request.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    if (!allowed(request)) return fail('TICK_TOKEN missing or wrong.', 401);
    let event: unknown;
    try {
      event = await request.json();
    } catch {
      return fail('not json', 400);
    }
    const type = (event as { data?: { event_type?: string } })?.data?.event_type ?? 'unknown';
    try {
      const r = await handleActivityEvent(event, { via: 'stream', log: (...a: unknown[]) => console.log(...a) });
      await logEvent(null, 'stream', `${type}: ${JSON.stringify(r)}`);
      return json(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logEvent(null, 'stream-error', `${type}: ${msg}`);
      return fail(msg, 500);
    }
  });
