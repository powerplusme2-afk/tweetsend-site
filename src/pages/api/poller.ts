/**
 * Starts, stops and shows the bot's clock (src/workflows/poller.ts). Behind
 * TICK_TOKEN like /api/tick.
 *
 *   GET                       → { lease, last } — is a chain running, what the last tick did
 *   POST {"action":"start"}   → new lease, new run (an older chain stops at its next tick)
 *   POST {"action":"stop"}    → clears the lease
 */
import type { APIRoute } from 'astro';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { start } from 'workflow/api';
import { json, fail, guard, body } from '../../server/http';
import { getSql } from '../../../shared/db.mjs';
import { pollerWorkflow, TICK_EVERY_MINUTES } from '../../workflows/poller';

export const prerender = false;

function allowed(request: Request): boolean {
  const token = process.env.TICK_TOKEN;
  if (!token) return false;
  const auth = request.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

async function state() {
  const sql = await getSql();
  const rows = await sql`select key, value, at from worker_state where key in ('poller_lease', 'poller_last', 'poller_run')`;
  const get = (k: string) => rows.find((r) => r.key === k);
  const last = get('poller_last');
  return {
    everyMinutes: TICK_EVERY_MINUTES,
    running: Boolean(get('poller_lease')?.value),
    leaseSince: get('poller_lease')?.at ?? null,
    runId: get('poller_run')?.value ?? null,
    last: last ? { at: last.at, ...JSON.parse(String(last.value)) } : null,
  };
}

export const GET: APIRoute = ({ request }) =>
  guard(async () => {
    if (!allowed(request)) return fail('TICK_TOKEN missing or wrong.', 401);
    return json(await state());
  });

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    if (!allowed(request)) return fail('TICK_TOKEN missing or wrong.', 401);
    const { action } = await body<{ action?: string }>(request);
    const sql = await getSql();
    if (action === 'start') {
      const token = randomBytes(12).toString('hex');
      await sql`insert into worker_state (key, value, at) values ('poller_lease', ${token}, now())
                on conflict (key) do update set value = excluded.value, at = now()`;
      const run = await start(pollerWorkflow, [token]);
      await sql`insert into worker_state (key, value, at) values ('poller_run', ${run.runId}, now())
                on conflict (key) do update set value = excluded.value, at = now()`;
      return json({ started: run.runId, ...(await state()) });
    }
    if (action === 'stop') {
      await sql`delete from worker_state where key in ('poller_lease', 'poller_run')`;
      return json({ stopped: true, ...(await state()) });
    }
    return fail('action must be "start" or "stop".', 400);
  });
