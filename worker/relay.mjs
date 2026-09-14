#!/usr/bin/env node
/**
 * The smallest always-on piece: holds the X Activity stream open and hands
 * every event to the site (`POST /api/x/event`), which answers the mention
 * with the keys that live on Vercel. Every 5 minutes it also asks the site
 * for one poll tick (`GET /api/tick`), the safety net GitHub's cron never
 * delivered (0 scheduled runs in 3.5 h on 14 Sep 2026).
 *
 * Needs only two values:
 *   X_BEARER_TOKEN  — the app's read token (the stream is app-only)
 *   TICK_TOKEN      — the site's own random string, same as in Vercel
 * Optional: SITE (default https://tweetsend.com), MAX_MINUTES (default 350 —
 * a GitHub Actions job may live 360; the workflow starts the next one),
 * TICK_MINUTES (default 5).
 *
 * Exits 0 when MAX_MINUTES is up, 2 when a value is missing. Never exits on
 * an X or site error — it backs off and reconnects, and prints one line
 * per event (ids and handles only, never a token).
 */
import { runStream } from '../shared/stream.mjs';

const SITE = (process.env.SITE || process.env.PUBLIC_SITE_URL || 'https://tweetsend.com').replace(/\/$/, '');
const MAX_MS = Number(process.env.MAX_MINUTES || 350) * 60_000;
const TICK_MS = Number(process.env.TICK_MINUTES || 5) * 60_000;

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function site(method, path, body) {
  const r = await fetch(`${SITE}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.TICK_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function main() {
  if (!process.env.X_BEARER_TOKEN || !process.env.TICK_TOKEN) {
    console.error('set X_BEARER_TOKEN and TICK_TOKEN');
    process.exit(2);
  }
  log(`relay → ${SITE}, ${MAX_MS / 60_000} min, tick every ${TICK_MS / 60_000} min`);
  const ctrl = new AbortController();
  const stop = setTimeout(() => ctrl.abort(), MAX_MS);
  const tick = async () => {
    try {
      const t = await site('GET', '/api/tick');
      log(`tick: mentions ${t.mentions}, announced ${t.announced}, expired ${t.expired}`);
    } catch (e) {
      log(`tick failed: ${e.message}`);
    }
  };
  await tick();
  const timer = setInterval(tick, TICK_MS);
  await runStream({
    token: process.env.X_BEARER_TOKEN,
    signal: ctrl.signal,
    log,
    onEvent: async (ev) => {
      const type = ev?.data?.event_type ?? 'unknown';
      const id = ev?.data?.payload?.id ?? '-';
      const r = await site('POST', '/api/x/event', ev);
      log(`${type} ${id} → ${JSON.stringify(r).slice(0, 160)}`);
    },
  });
  clearInterval(timer);
  clearTimeout(stop);
  log('time is up, exiting so the next run takes over');
}

main().catch((e) => { console.error(e); process.exit(1); });
