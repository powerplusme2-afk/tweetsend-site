/**
 * The X Activity stream: `GET /2/activity/stream`, one long HTTPS response
 * that carries every event of every subscription the app has, one JSON
 * object per line, a bare newline every few seconds as a heartbeat.
 *
 * This is the transport that actually works. X's webhook transport for
 * `post.mention.create` has delivered nothing since 2026-08-09 (X developer
 * forum, confirmed here 14 Sep 2026: two self-mentions, zero POSTs), while
 * the stream delivers the same subscription within about 4 seconds. The
 * stream needs one always-open connection, so it runs off Vercel: in
 * `worker/index.mjs --stream` on any Node host, or in `worker/relay.mjs`,
 * which only needs the read token and forwards each event to the site.
 *
 * Only the bearer token is used here — no posting key, no secret.
 */

const API = 'https://api.x.com/2';

/** Splits a byte stream into complete lines; heartbeats (empty lines) are dropped. */
export function lineSplitter() {
  let rest = '';
  return {
    push(chunk) {
      rest += chunk;
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      return lines.map((l) => l.trim()).filter(Boolean);
    },
    flush() {
      const l = rest.trim();
      rest = '';
      return l ? [l] : [];
    },
  };
}

/**
 * One connection. Yields parsed events until the server closes the
 * response, `signal` aborts, or `idleMs` passes with no byte at all (X sends
 * a heartbeat newline every ~20 s, so silence means a dead socket).
 * `backfillMinutes` (0–5) asks X to replay what was missed just before.
 */
export async function* activityEvents({ token, signal, backfillMinutes = 0, idleMs = 90_000, log = () => {} } = {}) {
  const url = new URL(`${API}/activity/stream`);
  if (backfillMinutes > 0) url.searchParams.set('backfill_minutes', String(Math.min(5, backfillMinutes)));
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let idle = null;
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(new Error(`no byte for ${idleMs} ms`)), idleMs);
  };
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!r.ok || !r.body) {
      const text = await r.text().catch(() => '');
      const e = new Error(`X GET /activity/stream → ${r.status}: ${text.slice(0, 300)}`);
      e.status = r.status;
      throw e;
    }
    log(`stream open (${r.status})`);
    const split = lineSplitter();
    const dec = new TextDecoder();
    armIdle();
    for await (const chunk of r.body) {
      armIdle();
      for (const line of split.push(dec.decode(chunk, { stream: true }))) {
        try {
          yield JSON.parse(line);
        } catch {
          log(`stream: unparsable line (${line.length} bytes)`);
        }
      }
    }
    for (const line of split.flush()) {
      try { yield JSON.parse(line); } catch { /* partial tail */ }
    }
  } finally {
    if (idle) clearTimeout(idle);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Runs `onEvent` for every event, forever, reconnecting with backoff
 * (1 s → 60 s, reset after a connection that lived a minute). The first
 * connection asks for `backfillMinutes` of replay; reconnects ask for the
 * minutes the socket was down. Stops when `signal` aborts.
 */
export async function runStream({ token, onEvent, signal, backfillMinutes = 5, log = () => {} }) {
  let backoff = 1000;
  let backfill = backfillMinutes;
  let downSince = null;
  while (!signal?.aborted) {
    const opened = Date.now();
    try {
      for await (const ev of activityEvents({ token, signal, backfillMinutes: backfill, log })) {
        try {
          await onEvent(ev);
        } catch (e) {
          log(`event failed: ${e.message}`);
        }
      }
      log('stream closed by X');
    } catch (e) {
      if (signal?.aborted) break;
      log(`stream error: ${e.message}`);
      if (e.status === 429) backoff = Math.max(backoff, 60_000);
    }
    if (signal?.aborted) break;
    if (Date.now() - opened > 60_000) backoff = 1000;
    downSince = downSince ?? Date.now();
    await new Promise((r) => setTimeout(r, backoff));
    backfill = Math.min(5, Math.ceil((Date.now() - downSince) / 60_000));
    backoff = Math.min(60_000, backoff * 2);
    if (backoff === 1000) downSince = null;
  }
}
