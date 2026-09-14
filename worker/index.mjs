#!/usr/bin/env node
/**
 * The TweetSend bot as an always-on loop: `shared/bot.mjs` every 60 s
 * (jittered). Runs anywhere Node 22+ runs. The same tick is also reachable on
 * Vercel as `/api/tick` for a cron — see src/pages/api/tick.ts.
 *
 * Env (entered by the client, never printed): X_BEARER_TOKEN, X_API_KEY,
 * X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET, PRIVY_APP_ID,
 * PRIVY_APP_SECRET, DATABASE_URL, PUBLIC_SITE_URL, PUBLIC_CHAIN_ID.
 *
 * Flags: `--once` runs one tick and exits; `--dry` reads mentions and
 * writes intents but posts nothing to X; `--stream` also holds the X
 * Activity stream open, so a mention is answered within seconds instead of
 * at the next tick (the tick stays on as the safety net).
 */
import { runTick, handleActivityEvent } from '../shared/bot.mjs';
import { me, xKeysPresent } from '../shared/x.mjs';
import { runStream } from '../shared/stream.mjs';
import { privySecretPresent } from '../shared/privy.mjs';

const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry');
const STREAM = process.argv.includes('--stream');
const SITE = (process.env.PUBLIC_SITE_URL || 'https://tweetsend-site.vercel.app').replace(/\/$/, '');
const CHAIN = Number(process.env.PUBLIC_CHAIN_ID || 46630);
const EVERY_MS = 60_000;

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function main() {
  if (!xKeysPresent()) {
    console.error('X keys missing: set X_BEARER_TOKEN, X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.');
    process.exit(2);
  }
  if (!privySecretPresent()) {
    console.error('PRIVY_APP_SECRET missing: the bot cannot make wallets for recipients.');
    process.exit(2);
  }
  const bot = await me();
  log(`bot @${bot.handle} (${bot.id}) · site ${SITE} · chain ${CHAIN}${DRY ? ' · DRY' : ''}${STREAM ? ' · stream' : ''}`);
  if (STREAM && !DRY && !ONCE) {
    runStream({
      token: process.env.X_BEARER_TOKEN,
      log,
      onEvent: async (ev) => {
        const r = await handleActivityEvent(ev, { log, via: 'stream' });
        log(`stream → ${JSON.stringify(r)}`);
      },
    }).catch((e) => log(`stream stopped: ${e.message}`));
  }
  for (;;) {
    let backoff = 0;
    try {
      await runTick({ dry: DRY, log, bot });
    } catch (e) {
      log(`tick failed: ${e.message}`);
      if (e.status === 429) {
        log('rate limited — backing off one extra interval');
        backoff = EVERY_MS;
      }
    }
    if (ONCE) break;
    const jitter = Math.floor(Math.random() * 10_000);
    await new Promise((r) => setTimeout(r, EVERY_MS + jitter + backoff));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
