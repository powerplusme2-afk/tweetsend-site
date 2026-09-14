/**
 * Registers (and shows) the X webhook that makes the bot instant. Behind
 * TICK_TOKEN like /api/tick, because it spends X credits and changes the
 * app's X configuration.
 *
 *   GET                      → every webhook + activity subscription on the app
 *   POST {"action":"install"}   → webhook for <site>/api/x/webhook + a
 *                                 post.mention.create subscription on the bot
 *   POST {"action":"uninstall"} → removes both
 *   POST {"action":"replay","minutes":60} → X re-pushes the last hour's events
 *
 * Ids and URLs come back; keys never do.
 */
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { json, fail, guard, body } from '../../../server/http';
import { hookStatus, installWebhook, uninstallWebhook, replayWebhook, me, xKeysPresent } from '../../../../shared/x.mjs';
import { getSql } from '../../../../shared/db.mjs';

export const prerender = false;

const SITE = (process.env.PUBLIC_SITE_URL || 'https://tweetsend-site.vercel.app').replace(/\/$/, '');
const WEBHOOK_URL = `${SITE}/api/x/webhook`;

function allowed(request: Request): boolean {
  const token = process.env.TICK_TOKEN;
  if (!token) return false;
  const auth = request.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

export const GET: APIRoute = ({ request }) =>
  guard(async () => {
    if (!allowed(request)) return fail('TICK_TOKEN missing or wrong.', 401);
    if (!xKeysPresent()) return fail('X keys are not all set.', 503);
    /* The last few deliveries, so "did X actually push anything?" has an
       answer without a database login. Event rows carry ids and outcomes,
       never keys. */
    const sql = await getSql();
    const recent = await sql`
      select kind, detail, at from events
      where kind in ('webhook', 'webhook-error', 'webhook-reject') order by at desc limit 8`;
    const seen = await sql`select via, count(*)::int as n from seen_mentions group by via`;
    return json({ url: WEBHOOK_URL, ...(await hookStatus()), recent, seen });
  });

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    if (!allowed(request)) return fail('TICK_TOKEN missing or wrong.', 401);
    if (!xKeysPresent()) return fail('X keys are not all set.', 503);
    const { action, minutes } = await body<{ action?: string; minutes?: number }>(request);
    if (action === 'install') {
      const bot = await me();
      const r = await installWebhook({ url: WEBHOOK_URL, botUserId: bot.id });
      return json({ bot: bot.handle, url: WEBHOOK_URL, ...r });
    }
    if (action === 'uninstall') return json({ url: WEBHOOK_URL, removed: await uninstallWebhook({ url: WEBHOOK_URL }) });
    /* Ask X to push again everything it recorded for our webhook in the last
       `minutes` (default 60). Mentions already answered come back as
       `skipped: "seen"`; what matters is that `recent` fills up. */
    if (action === 'replay') return json({ url: WEBHOOK_URL, ...(await replayWebhook({ url: WEBHOOK_URL, minutes: Number(minutes) || 60 })) });
    return fail('action must be "install", "uninstall" or "replay".', 400);
  });
