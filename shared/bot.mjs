/**
 * One tick of the TweetSend bot, as a function.
 *
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
 * Two callers: `worker/index.mjs` (an always-on loop on any Node host) and
 * `src/pages/api/tick.ts` (the same tick on Vercel, hit by a cron or by hand).
 * `dry: true` reads mentions and writes intents but posts nothing to X.
 */
import { parseCommand, MESSAGES } from './command.mjs';
import { getSql, expireStale, logEvent } from './db.mjs';
import { me, mentions, reply } from './x.mjs';
import { ensureUserForX } from './privy.mjs';
import { createIntent, setBotReply, setRecipientWallet, paidUnannounced, rememberX, hasSignedIn } from './intents.mjs';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://tweetsend-site.vercel.app').replace(/\/$/, '');
const CHAIN = Number(process.env.PUBLIC_CHAIN_ID || 46630);

async function cursor(sql, value) {
  if (value === undefined) {
    const rows = await sql`select value from worker_state where key = 'since_id'`;
    return rows[0]?.value ?? null;
  }
  await sql`insert into worker_state (key, value, at) values ('since_id', ${value}, now())
            on conflict (key) do update set value = excluded.value, at = now()`;
  return value;
}

/** Posts a reply unless dry; returns the reply id (or the text it would have posted). */
async function post(ctx, tweetId, text, intentId, field) {
  if (ctx.dry) {
    ctx.log(`DRY reply to ${tweetId}: ${text}`);
    ctx.wouldPost.push({ tweetId, text });
    return null;
  }
  const id = await reply(tweetId, text);
  if (intentId) await setBotReply(intentId, field, id);
  return id;
}

/** One mention → one intent (or one templated refusal, or silence). */
export async function handleMention(ctx, m, bot) {
  if (m.authorId === bot.id) return { skipped: 'own-post' };
  if (m.recipientId === bot.id) return { skipped: 'reply-to-bot' };
  const parsed = parseCommand(m.text, bot.handle);
  if (!parsed.ok) {
    if (parsed.reason === 'no-mention') return { skipped: 'no-mention' };
    if (parsed.reason === 'too-small' || parsed.reason === 'too-large') {
      await post(ctx, m.id, MESSAGES.limits(), null);
      return { refused: parsed.reason };
    }
    await post(ctx, m.id, MESSAGES.noAmount(), null);
    return { refused: parsed.reason };
  }
  if (!m.recipientId) return { skipped: 'not-a-reply' };
  if (m.recipientId === m.authorId) {
    await post(ctx, m.id, MESSAGES.self(), null);
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
  await post(ctx, m.id, MESSAGES.ready({ amount: parsed.usd, to: m.recipientHandle ?? m.recipientId, link }), intent.id, 'ready');
  return { intent: intent.id, created, walletMade: user.created };
}

async function announcePaid(ctx) {
  const rows = await paidUnannounced();
  for (const it of rows) {
    const signedIn = await hasSignedIn(it.recipient_x_id);
    const text = signedIn
      ? MESSAGES.sent({ amount: Number(it.amount_usd), to: it.recipient_handle ?? it.recipient_x_id })
      : MESSAGES.waiting({ amount: Number(it.amount_usd), to: it.recipient_handle ?? it.recipient_x_id, site: SITE.replace(/^https?:\/\//, '') });
    await post(ctx, it.trigger_tweet_id, text, it.id, 'paid');
  }
  return rows.length;
}

/**
 * Runs one tick. `bot` may be passed in by a long-running caller that looked
 * itself up once; otherwise `/users/me` is asked (one cheap call).
 * Returns a summary that names no key and no wallet secret.
 */
export async function runTick({ dry = false, log = () => {}, bot = null } = {}) {
  const ctx = { dry, log, wouldPost: [] };
  const sql = await getSql();
  const who = bot ?? (await me());
  if (!process.env.X_BOT_HANDLE) process.env.X_BOT_HANDLE = who.handle;
  const since = await cursor(sql);
  const { mentions: list, newestId } = await mentions(who.id, since);
  log(`mentions since ${since ?? 'start'}: ${list.length}`);
  const results = [];
  for (const m of [...list].reverse()) {
    try {
      const r = await handleMention(ctx, m, who);
      log(`  ${m.id} @${m.authorHandle} → ${JSON.stringify(r)}`);
      results.push({ tweetId: m.id, author: m.authorHandle, ...r });
    } catch (e) {
      log(`  ${m.id} FAILED ${e.message}`);
      await logEvent(null, 'worker-error', `${m.id}: ${e.message}`);
      results.push({ tweetId: m.id, author: m.authorHandle, failed: e.message });
    }
  }
  if (newestId) await cursor(sql, newestId);
  const announced = await announcePaid(ctx);
  const expired = await expireStale();
  if (announced || expired) log(`announced ${announced}, expired ${expired}`);
  return { bot: who.handle, since, newestId, mentions: list.length, results, announced, expired, dry, wouldPost: ctx.wouldPost };
}
