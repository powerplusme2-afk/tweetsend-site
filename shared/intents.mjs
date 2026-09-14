/**
 * Intents: the one record a payment leaves behind, from "someone typed
 * @TweetSend $25" to "the money is in @bob's wallet and @bob has seen it".
 *
 * Status is set in exactly three places: the worker (pending, expired), the
 * paid route after it has checked the receipt on chain (paid), and the /me
 * route when the recipient signs in (claimed). Nothing else writes `status`.
 */
import { randomBytes } from 'node:crypto';
import { getSql, logEvent, expireStale } from './db.mjs';
export { logEvent };
import { intentId, LIMITS } from './command.mjs';

export const STATUSES = ['pending', 'paid', 'claimed', 'expired'];

export function newId() {
  return intentId(randomBytes(12));
}

function expiry() {
  return new Date(Date.now() + LIMITS.expiryHours * 3600 * 1000);
}

/** Sum of what a sender has paid or promised in the last 24 h, for the daily cap. */
export async function senderDayTotal(senderXId) {
  const sql = await getSql();
  const rows = await sql`
    select coalesce(sum(amount_usd), 0) as total from intents
    where sender_x_id = ${senderXId}
      and status in ('pending', 'paid', 'claimed')
      and created_at > now() - interval '24 hours'`;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Creates a pending intent. `trigger_tweet_id` is unique, so the same
 * mention seen twice (a re-poll after a crash) returns the existing intent
 * instead of a second one.
 */
export async function createIntent(i) {
  const sql = await getSql();
  const id = newId();
  if (i.triggerTweetId) {
    const existing = await sql`select * from intents where trigger_tweet_id = ${i.triggerTweetId}`;
    if (existing[0]) return { intent: existing[0], created: false };
  }
  const rows = await sql`
    insert into intents (
      id, sender_x_id, sender_handle, sender_privy_id, recipient_x_id, recipient_handle, recipient_wallet,
      amount_usd, chain, status, source, trigger_tweet_id, parent_tweet_id, expires_at
    ) values (
      ${id}, ${i.senderXId ?? null}, ${i.senderHandle ?? null}, ${i.senderPrivyId ?? null},
      ${i.recipientXId}, ${i.recipientHandle ?? null}, ${i.recipientWallet ?? null},
      ${i.amountUsd}, ${i.chain}, 'pending', ${i.source}, ${i.triggerTweetId ?? null}, ${i.parentTweetId ?? null},
      ${expiry()}
    )
    on conflict (trigger_tweet_id) do nothing
    returning *`;
  if (!rows[0]) {
    const again = await sql`select * from intents where trigger_tweet_id = ${i.triggerTweetId}`;
    return { intent: again[0], created: false };
  }
  await logEvent(id, 'created', `${i.source}: ${i.amountUsd} USDG to @${i.recipientHandle ?? i.recipientXId}`);
  return { intent: rows[0], created: true };
}

export async function getIntent(id) {
  const sql = await getSql();
  const rows = await sql`select * from intents where id = ${id}`;
  const it = rows[0] ?? null;
  if (it && it.status === 'pending' && new Date(it.expires_at) < new Date()) {
    await expireStale();
    return (await sql`select * from intents where id = ${id}`)[0] ?? null;
  }
  return it;
}

/** The recipient wallet was unknown when the intent was made; fill it in. */
export async function setRecipientWallet(id, wallet) {
  const sql = await getSql();
  await sql`update intents set recipient_wallet = ${wallet} where id = ${id} and recipient_wallet is null`;
}

export async function setBotReply(id, field, tweetId) {
  const sql = await getSql();
  if (field === 'ready') await sql`update intents set bot_reply_id = ${tweetId} where id = ${id}`;
  else await sql`update intents set bot_paid_reply_id = ${tweetId} where id = ${id}`;
  await logEvent(id, 'bot-reply', `${field}: ${tweetId}`);
}

export async function txHashUsed(hash) {
  const sql = await getSql();
  const rows = await sql`select id from intents where tx_hash = ${hash} limit 1`;
  return rows[0]?.id ?? null;
}

/** Only after the receipt has been checked on chain by the caller. */
export async function markPaid(id, { txHash, ethTxHash, senderWallet, senderPrivyId, senderXId, senderHandle }) {
  const sql = await getSql();
  const rows = await sql`
    update intents set
      status = 'paid', paid_at = now(), tx_hash = ${txHash}, eth_tx_hash = ${ethTxHash ?? null},
      sender_wallet = ${senderWallet ?? null},
      sender_privy_id = coalesce(sender_privy_id, ${senderPrivyId ?? null}),
      sender_x_id = coalesce(sender_x_id, ${senderXId ?? null}),
      sender_handle = coalesce(sender_handle, ${senderHandle ?? null})
    where id = ${id} and status = 'pending'
    returning *`;
  if (rows[0]) await logEvent(id, 'paid', txHash);
  return rows[0] ?? null;
}

/** When @bob signs in, everything paid to @bob becomes claimed. */
export async function claimAllFor(xId) {
  const sql = await getSql();
  const rows = await sql`
    update intents set status = 'claimed', claimed_at = now()
    where recipient_x_id = ${xId} and status = 'paid'
    returning id`;
  for (const r of rows) await logEvent(r.id, 'claimed', `@${xId} signed in`);
  return rows.length;
}

/** Everything a person sent or was sent, newest first. */
export async function activityFor({ xId, wallet }) {
  const sql = await getSql();
  await expireStale();
  return sql`
    select * from intents
    where (${xId ?? ''} <> '' and (sender_x_id = ${xId ?? ''} or recipient_x_id = ${xId ?? ''}))
       or (${wallet ?? ''} <> '' and (sender_wallet = ${wallet ?? ''} or recipient_wallet = ${wallet ?? ''}))
    order by created_at desc
    limit 200`;
}

/** What is sitting in this person's wallet that they have not yet seen. */
export async function claimsFor(xId) {
  const sql = await getSql();
  return sql`
    select * from intents where recipient_x_id = ${xId} and status in ('paid', 'claimed')
    order by paid_at desc limit 100`;
}

/** Paid intents the worker has not yet answered on X. */
export async function paidUnannounced() {
  const sql = await getSql();
  return sql`
    select * from intents
    where status in ('paid', 'claimed') and source = 'x' and bot_paid_reply_id is null and trigger_tweet_id is not null
    order by paid_at asc limit 50`;
}

export async function eventsFor(intentId) {
  const sql = await getSql();
  return sql`select kind, detail, at from events where intent_id = ${intentId} order by at asc`;
}

/* ---------------------------------------------------------------- users */

export async function upsertUser(u) {
  const sql = await getSql();
  const rows = await sql`
    insert into users (privy_id, x_id, x_handle, x_name, avatar_url, wallet, email, last_login_at)
    values (${u.privyId}, ${u.xId ?? null}, ${u.xHandle ?? null}, ${u.xName ?? null}, ${u.avatar ?? null}, ${u.wallet ?? null}, ${u.email ?? null}, now())
    on conflict (privy_id) do update set
      x_id = coalesce(excluded.x_id, users.x_id),
      x_handle = coalesce(excluded.x_handle, users.x_handle),
      x_name = coalesce(excluded.x_name, users.x_name),
      avatar_url = coalesce(excluded.avatar_url, users.avatar_url),
      wallet = coalesce(excluded.wallet, users.wallet),
      email = coalesce(excluded.email, users.email),
      last_login_at = now()
    returning *`;
  return rows[0];
}

export async function userByHandle(handle) {
  const sql = await getSql();
  const h = String(handle).replace(/^@/, '');
  const rows = await sql`select * from users where lower(x_handle) = lower(${h}) limit 1`;
  return rows[0] ?? null;
}

export async function userByXId(xId) {
  const sql = await getSql();
  const rows = await sql`select * from users where x_id = ${xId} limit 1`;
  return rows[0] ?? null;
}

/** Remembers a recipient the worker resolved, so the site can address them too. */
export async function rememberX({ privyId, xId, handle, name, avatar, wallet }) {
  const sql = await getSql();
  await sql`
    insert into users (privy_id, x_id, x_handle, x_name, avatar_url, wallet)
    values (${privyId}, ${xId}, ${handle ?? null}, ${name ?? null}, ${avatar ?? null}, ${wallet ?? null})
    on conflict (privy_id) do update set
      x_handle = coalesce(excluded.x_handle, users.x_handle),
      x_name = coalesce(excluded.x_name, users.x_name),
      avatar_url = coalesce(excluded.avatar_url, users.avatar_url),
      wallet = coalesce(excluded.wallet, users.wallet)`;
}

/** Everyone who has signed in — sender never sees this; the worker uses it. */
export async function hasSignedIn(xId) {
  const sql = await getSql();
  const rows = await sql`select last_login_at from users where x_id = ${xId} and last_login_at is not null limit 1`;
  return rows.length > 0;
}
