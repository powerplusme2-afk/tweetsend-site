/**
 * One bot tick on Vercel: `GET /api/tick` with `authorization: Bearer
 * <TICK_TOKEN>` (or Vercel's own cron header). `?dry=1` posts nothing.
 *
 * This is how the bot runs without a separate host: a Vercel cron (see
 * vercel.json) or any external pinger hits it every minute. `TICK_TOKEN` is
 * a random string made for this purpose, not one of the client's keys.
 * Returns a summary — counts, intent ids, what it posted — never a value.
 */
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { json, fail, guard } from '../../server/http';
import { runTick } from '../../../shared/bot.mjs';
import { xKeysPresent } from '../../../shared/x.mjs';
import { privySecretPresent } from '../../../shared/privy.mjs';

export const prerender = false;

function allowed(request: Request): boolean {
  const token = process.env.TICK_TOKEN;
  if (!token) return false;
  const auth = request.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

export const GET: APIRoute = ({ request, url }) =>
  guard(async () => {
    if (!allowed(request)) return fail('TICK_TOKEN missing or wrong.', 401);
    if (!xKeysPresent()) return fail('X keys are not all set.', 503);
    if (!privySecretPresent()) return fail('PRIVY_APP_SECRET is not set.', 503);
    const dry = url.searchParams.get('dry') === '1';
    const lines: string[] = [];
    const out = await runTick({ dry, log: (...a: unknown[]) => lines.push(a.map(String).join(' ')) });
    return json({ ...out, log: lines });
  });
