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
 *   POST {"action":"ping"} / {"action":"unping","id"} → bot mentions itself / deletes that post
 *   POST {"action":"stream-probe","minutes":12} → holds the stream open that many seconds
 *
 * Ids and URLs come back; keys never do.
 */
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { json, fail, guard, body } from '../../../server/http';
import { hookStatus, installWebhook, uninstallWebhook, replayWebhook, postTweet, deleteTweet, me, xKeysPresent } from '../../../../shared/x.mjs';
import { getSql } from '../../../../shared/db.mjs';
import { activityEvents } from '../../../../shared/stream.mjs';

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
      where kind in ('webhook', 'webhook-error', 'webhook-reject', 'stream', 'stream-error') order by at desc limit 8`;
    const seen = await sql`select via, count(*)::int as n from seen_mentions group by via`;
    return json({ url: WEBHOOK_URL, ...(await hookStatus()), recent, seen });
  });

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    if (!allowed(request)) return fail('TICK_TOKEN missing or wrong.', 401);
    if (!xKeysPresent()) return fail('X keys are not all set.', 503);
    const { action, minutes, id } = await body<{ action?: string; minutes?: number; id?: string }>(request);
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
    /* Self-test: the bot mentions itself, so X has one mention to push. The
       bot never answers its own posts, so nothing else happens; `unping`
       removes the post again. */
    if (action === 'ping') {
      const bot = await me();
      const text = `@${bot.handle} webhook self-test ${new Date().toISOString()}`;
      return json({ posted: await postTweet(text), text });
    }
    if (action === 'unping') return json({ id, deleted: id ? await deleteTweet(id) : false });
    /* Opens the Activity stream for a few seconds with the token that lives
       here, to prove the read token may hold it. Counts only. */
    if (action === 'stream-probe') {
      const ctrl = new AbortController();
      const seconds = Math.min(25, Number(minutes) || 12);
      const t = setTimeout(() => ctrl.abort(), seconds * 1000);
      const lines: string[] = [];
      let events = 0;
      let opened = false;
      try {
        for await (const ev of activityEvents({ token: process.env.X_BEARER_TOKEN as string, signal: ctrl.signal, log: (m: string) => { opened = opened || m.startsWith('stream open'); lines.push(m); } })) {
          events += 1;
          lines.push(`event ${(ev as { data?: { event_type?: string } })?.data?.event_type ?? '?'}`);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) lines.push(`error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        clearTimeout(t);
      }
      return json({ opened, seconds, events, log: lines });
    }
    return fail('action must be "install", "uninstall", "replay", "ping", "unping" or "stream-probe".', 400);
  });
