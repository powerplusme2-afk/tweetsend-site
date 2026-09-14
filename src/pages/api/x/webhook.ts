/**
 * Where X pushes the bot's mentions — the instant path.
 *
 * `GET ?crc_token=…` is X checking that this URL is ours (at registration and
 * about hourly after); the answer is an HMAC of the token with the app's API
 * secret. `POST` is one event. Its signature is checked over the raw body
 * before anything is parsed, X gets its 200 at once, and the mention is
 * answered in the time Vercel keeps the function alive afterwards
 * (`waitUntil`) — X drops webhooks that answer slowly, so the reply must not
 * be on the response's critical path. Nothing here needs TICK_TOKEN: the
 * signature is the authentication.
 */
import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { json, fail } from '../../../server/http';
import { crcResponseToken, signatureValid } from '../../../../shared/x.mjs';
import { handleActivityEvent } from '../../../../shared/bot.mjs';
import { logEvent } from '../../../../shared/db.mjs';

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const token = url.searchParams.get('crc_token');
  if (!token) return fail('crc_token missing', 400);
  try {
    return json({ response_token: crcResponseToken(token) });
  } catch {
    return fail('The X API keys are not set on the server.', 503);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const raw = await request.text();
  let ok = false;
  try {
    ok = signatureValid(raw, request.headers.get('x-twitter-webhooks-signature'));
  } catch {
    return fail('The X API keys are not set on the server.', 503);
  }
  if (!ok) {
    /* Logged, not silent: "did X push anything?" must be answerable. The
       body is not kept — only its size and whether a signature came at all. */
    const sig = request.headers.get('x-twitter-webhooks-signature');
    waitUntil(logEvent(null, 'webhook-reject', `bad signature: header ${sig ? 'present' : 'missing'}, body ${raw.length} bytes, ua ${request.headers.get('user-agent') ?? '-'}`));
    return fail('bad signature', 401);
  }
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return fail('not json', 400);
  }
  const type = (event as { data?: { event_type?: string } })?.data?.event_type ?? 'unknown';
  waitUntil(
    handleActivityEvent(event, { log: (...a: unknown[]) => console.log(...a) })
      .then((r) => logEvent(null, 'webhook', `${type}: ${JSON.stringify(r)}`))
      .catch((e: Error) => {
        console.error('webhook handling failed', e);
        return logEvent(null, 'webhook-error', `${type}: ${e.message}`);
      }),
  );
  return json({ ok: true });
};
