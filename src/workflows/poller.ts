/**
 * The bot's clock, as a Vercel Workflow: one poll tick, sleep, repeat —
 * without any process staying alive and without GitHub's cron (which fired
 * 0 times in 5 hours on 14 Sep 2026). A `sleep` costs no compute; a tick is
 * one short function call. Hobby includes 50 000 workflow events a month;
 * a tick + sleep is about five, so every 5 minutes is ~43 000.
 *
 * One chain at a time: `/api/poller` writes a lease token to worker_state
 * when it starts a chain, and every tick checks the token is still the one
 * it was born with. Stop = clear the lease; the run ends at its next tick.
 * A run hands over to a fresh run once a day (limits are per run).
 */
import { sleep } from 'workflow';
import { start } from 'workflow/api';
import { runTick } from '../../shared/bot.mjs';
import { getSql } from '../../shared/db.mjs';

export const TICK_EVERY_MINUTES = 5;
const TICKS_PER_RUN = Math.floor((24 * 60) / TICK_EVERY_MINUTES);

async function leaseIs(sql: (s: TemplateStringsArray, ...v: unknown[]) => Promise<Record<string, unknown>[]>, token: string) {
  const rows = await sql`select value from worker_state where key = 'poller_lease'`;
  return rows[0]?.value === token;
}

async function tickStep(token: string): Promise<'ok' | 'lost' | 'failed'> {
  'use step';
  const sql = await getSql();
  if (!(await leaseIs(sql, token))) return 'lost';
  const lines: string[] = [];
  try {
    const r = await runTick({ dry: false, log: (...a: unknown[]) => lines.push(a.map(String).join(' ')) });
    const note = JSON.stringify({ at: new Date().toISOString(), mentions: r.mentions, announced: r.announced, expired: r.expired, results: r.results });
    await sql`insert into worker_state (key, value, at) values ('poller_last', ${note}, now())
              on conflict (key) do update set value = excluded.value, at = now()`;
    return 'ok';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`insert into worker_state (key, value, at) values ('poller_last', ${JSON.stringify({ at: new Date().toISOString(), failed: msg })}, now())
              on conflict (key) do update set value = excluded.value, at = now()`;
    return 'failed';
  }
}

async function handOver(token: string) {
  'use step';
  const sql = await getSql();
  if (!(await leaseIs(sql, token))) return null;
  const run = await start(pollerWorkflow, [token]);
  return run.runId;
}

export async function pollerWorkflow(token: string) {
  'use workflow';
  let ticks = 0;
  let failed = 0;
  for (let i = 0; i < TICKS_PER_RUN; i++) {
    const r = await tickStep(token);
    if (r === 'lost') return { stopped: 'lease released', ticks, failed };
    ticks += 1;
    if (r === 'failed') failed += 1;
    await sleep(`${TICK_EVERY_MINUTES} minutes`);
  }
  const next = await handOver(token);
  return { handedOver: next, ticks, failed };
}
