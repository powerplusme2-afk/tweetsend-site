#!/usr/bin/env node
/**
 * The TweetSend bot: one always-on loop.
 *
 * Every 60 s (jittered):
 *   1. read new mentions of the bot since the last cursor;
 *   2. for each: parse the amount, find who was replied to, make sure that
 *      person has a wallet (Privy pre-generate if not), write a pending
 *      intent, reply with the pay link;
 *   3. for every intent the site has marked paid and nobody has announced,
 *      reply "sent" / "waiting";
 *   4. expire what nobody paid.
 *
 * Replies are fixed strings from shared/command.mjs — never generated — and
 * only ever posted under a tweet that mentioned the bot, which is what X's
 * automation rules allow. Every reply id is written back to the intent, so a
 * restart never posts the same answer twice.
 *
 * Env (entered by the client, never printed): X_BEARER_TOKEN, X_API_KEY,
 * X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET, PRIVY_APP_ID,
 * PRIVY_APP_SECRET, DATABASE_URL, PUBLIC_SITE_URL, PUBLIC_CHAIN_ID.
 *
 * Flags: `--once` runs one tick and exits; `--dry` reads mentions and
 * writes intents but posts nothing to X.
 */
import { parseCommand, MESSAGES } from '../shared/command.mjs';
import { getSql, expireStale, logEvent } from '../shared/db.mjs';
import { me, mentions, reply, xKeysPresent } from '../shared/x.mjs';
import { ensureUserForX, privySecretPresent } from '../shared/privy.mjs';
import { createIntent, setBotReply, setRecipientWallet, paidUnannounced, rememberX, hasSignedIn } from '../shared/intents.mjs';

const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry');
const SITE = (process.env.PUBLIC_SITE_URL || 'https://tweetsend-site.vercel.app').replace(/\/$/, '');
const CHAIN = Number(process.env.PUBLIC_CHAIN_ID || 46630);
const EVERY_MS = 60_000;

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function cursor(sql, value) {
  if (value === undefined) {
    const rows = await sql`select value from worker_state where key = 'since_id'`;
    return rows[0]?.value ?? null;
  }
  await sql`insert into worker_state (key, value, at) values ('since_id', ${value}, now())
            on conflict (key) do update set value = excluded.value, at = now()`;
  return value;
}

async function post(tweetId, text, intentId, field) {
  if (DRY) {
    log(`DRY reply to ${tweetId}: ${text}`);
    return null;
  }
  const id = await reply(tweetId, text);
  if (intentId) await setBotReply(intentId, field, id);
  return id;
}

/** One mention → one intent (or one templated refusal, or silence). */
export async function handleMention(m, bot) {
  if (m.authorId === bot.id) return { skipped: 'own-post' };
  if (m.recipientId === bot.id) return { skipped: 'reply-to-bot' };
  const parsed = parseCommand(m.text, bot.handle);
  if (!parsed.ok) {
    if (parsed.reason === 'no-mention') return { skipped: 'no-mention' };
    if (parsed.reason === 'too-small' || parsed.reason === 'too-large') {
      await post(m.id, MESSAGES.limits(), null);
      return { refused: parsed.reason };
    }
    await post(m.id, MESSAGES.noAmount(), null);
    return { refused: parsed.reason };
  }
  if (!m.recipientId) return { skipped: 'not-a-reply' };
  if (m.recipientId === m.authorId) {
    await post(m.id, MESSAGES.self(), null);
    return { refused: 'self' };
  }

  const user = await ensureUserForX({ xId: m.recipientId, handle: m.recipientHandle, name: m.recipientName });
  await rememberX({ privyId: user.privyId, xId: m.recipientId, handle: m.recipientHandle, name: m.recipientName, avatar: m.recipientAvatar, wallet: user.wallet });

  const { intent, created } = await createIntent({
    senderXId: m.authorId, senderHandle: m.authorHandle,
    recipientXId: m.recipientId, recipientHandle: m.recipientHandle, recipientWallet: user.wallet,
    amountUsd: parsed.usd, chain: CHAIN, source: 'x', triggerTweetId: m.id, parentTweetId: m.parentTweetId,
  });
  if (!intent.recipient_wallet && user.wallet) await setRecipientWallet(intent.id, user.wallet);
  if (!created && intent.bot_reply_id) return { intent: intent.id, skipped: 'already-answered' };

  const link = `${SITE}/pay/${intent.id}`;
  await post(m.id, MESSAGES.ready({ amount: parsed.usd, to: m.recipientHandle ?? m.recipientId, link }), intent.id, 'ready');
  return { intent: intent.id, created, walletMade: user.created };
}

async function announcePaid() {
  const rows = await paidUnannounced();
  for (const it of rows) {
    const signedIn = await hasSignedIn(it.recipient_x_id);
    const text = signedIn
      ? MESSAGES.sent({ amount: Number(it.amount_usd), to: it.recipient_handle ?? it.recipient_x_id })
      : MESSAGES.waiting({ amount: Number(it.amount_usd), to: it.recipient_handle ?? it.recipient_x_id, site: SITE.replace(/^https?:\/\//, '') });
    await post(it.trigger_tweet_id, text, it.id, 'paid');
  }
  return rows.length;
}

async function tick(bot, sql) {
  const since = await cursor(sql);
  const { mentions: list, newestId } = await mentions(bot.id, since);
  log(`mentions since ${since ?? 'start'}: ${list.length}`);
  for (const m of [...list].reverse()) {
    try {
      const r = await handleMention(m, bot);
      log(`  ${m.id} @${m.authorHandle} → ${JSON.stringify(r)}`);
    } catch (e) {
      log(`  ${m.id} FAILED ${e.message}`);
      await logEvent(null, 'worker-error', `${m.id}: ${e.message}`);
    }
  }
  if (newestId) await cursor(sql, newestId);
  const announced = await announcePaid();
  const expired = await expireStale();
  if (announced || expired) log(`announced ${announced}, expired ${expired}`);
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
  const sql = await getSql();
  const bot = await me();
  log(`bot @${bot.handle} (${bot.id}) · site ${SITE} · chain ${CHAIN}${DRY ? ' · DRY' : ''}`);
  for (;;) {
    let backoff = 0;
    try {
      await tick(bot, sql);
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

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
