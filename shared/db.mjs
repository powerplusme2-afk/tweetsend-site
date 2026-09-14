/**
 * One database module for the API routes and the worker.
 *
 * `DATABASE_URL` set → Neon Postgres over HTTP (`@neondatabase/serverless`),
 * which is what runs on Vercel and on the worker host.
 * `DATABASE_URL` unset → PGlite, a real Postgres running in-process with its
 * files under `.data/pglite` — the local development and test database, so
 * the whole flow runs on a laptop with nothing provisioned. Never used on
 * Vercel: a serverless filesystem does not persist, so `db.ts` refuses to
 * fall back there.
 *
 * Both are exposed as the same tagged template: `sql\`select … ${x}\`` →
 * array of rows. Every query in the app goes through here.
 */

import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

let sqlPromise = null;

export function databaseKind() {
  return process.env.DATABASE_URL ? 'neon' : 'pglite';
}

export async function getSql() {
  if (!sqlPromise) sqlPromise = open();
  return sqlPromise;
}

async function open() {
  const url = process.env.DATABASE_URL;
  let sql;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const q = neon(url);
    sql = (strings, ...values) => q(strings, ...values);
  } else {
    if (process.env.VERCEL) {
      throw new Error('DATABASE_URL is not set. On Vercel the app needs the Neon Postgres resource connected.');
    }
    const { PGlite } = await import('@electric-sql/pglite');
    /* Next to this file, not the process cwd — the dev server may be started
       from the workspace root with `--root`. */
    const dir = process.env.PGLITE_DIR || fileURLToPath(new URL('../.data/pglite', import.meta.url));
    mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir);
    await pg.waitReady;
    sql = async (strings, ...values) => (await pg.sql(strings, ...values)).rows;
  }
  await migrate(sql);
  return sql;
}

/**
 * Idempotent schema. Runs on every cold start; every statement is
 * `IF NOT EXISTS`, so a second run is a no-op.
 */
async function migrate(sql) {
  await sql`
    create table if not exists users (
      privy_id      text primary key,
      x_id          text unique,
      x_handle      text,
      x_name        text,
      avatar_url    text,
      wallet        text,
      email         text,
      created_at    timestamptz not null default now(),
      last_login_at timestamptz
    )`;
  await sql`
    create table if not exists intents (
      id                text primary key,
      sender_x_id       text,
      sender_handle     text,
      sender_privy_id   text,
      sender_wallet     text,
      recipient_x_id    text not null,
      recipient_handle  text,
      recipient_wallet  text,
      amount_usd        numeric(12,2) not null,
      asset             text not null default 'USDG',
      chain             integer not null,
      status            text not null default 'pending',
      source            text not null,
      trigger_tweet_id  text unique,
      parent_tweet_id   text,
      bot_reply_id      text,
      bot_paid_reply_id text,
      tx_hash           text,
      eth_tx_hash       text,
      created_at        timestamptz not null default now(),
      paid_at           timestamptz,
      claimed_at        timestamptz,
      expires_at        timestamptz not null
    )`;
  await sql`create index if not exists intents_sender on intents (sender_x_id, created_at desc)`;
  await sql`create index if not exists intents_recipient on intents (recipient_x_id, created_at desc)`;
  await sql`create index if not exists intents_status on intents (status, expires_at)`;
  /* One receipt pays one send. Without this, the same hash could "pay" a second
     intent to the same wallet for the same amount. */
  await sql`create unique index if not exists intents_tx_hash on intents (tx_hash) where tx_hash is not null`;
  await sql`
    create table if not exists events (
      id        bigserial primary key,
      intent_id text,
      kind      text not null,
      detail    text,
      at        timestamptz not null default now()
    )`;
  await sql`create index if not exists events_intent on events (intent_id, at desc)`;
  await sql`
    create table if not exists worker_state (
      key   text primary key,
      value text,
      at    timestamptz not null default now()
    )`;
}

/* ---------------------------------------------------------------- helpers */

/**
 * @param {string | null} intentId
 * @param {string} kind
 * @param {string | null} [detail]
 */
export async function logEvent(intentId, kind, detail = null) {
  const sql = await getSql();
  await sql`insert into events (intent_id, kind, detail) values (${intentId}, ${kind}, ${detail})`;
}

/** The one place a pending intent becomes expired. Called by the worker and lazily by reads. */
export async function expireStale() {
  const sql = await getSql();
  const rows = await sql`
    update intents set status = 'expired'
    where status = 'pending' and expires_at < now()
    returning id`;
  for (const r of rows) await logEvent(r.id, 'expired', 'unpaid after the expiry window');
  return rows.length;
}
