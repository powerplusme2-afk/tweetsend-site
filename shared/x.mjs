/**
 * The X API v2, every call the bot makes.
 *
 * Reads use the app bearer token (`X_BEARER_TOKEN`). Posting a reply is an
 * action by the bot account itself, so it is signed with OAuth 1.0a user
 * context (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
 * `X_ACCESS_TOKEN_SECRET`) — the simplest scheme for one account that never
 * changes, and the one the plan chose. All five values are entered by the
 * client; nothing here ever prints them.
 *
 * Two ways a mention reaches us: the poll (`mentions`, every few minutes)
 * and the X Activity API webhook (`post.mention.create`, pushed within
 * seconds of the tweet). The webhook is what makes the bot answer at once;
 * the poll stays as the safety net that catches anything X did not deliver.
 * The webhook and the activity subscription are registered from here too
 * (`installWebhook`) — checked against api.x.com/2/openapi.json, 14 Sep 2026.
 *
 * Costs (pay-per-use, checked 12 Sep 2026): a mention returned $0.001, an
 * empty poll free, a reply $0.01, a reply containing a URL $0.20; a mention
 * delivered by webhook $0.005.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const API = 'https://api.x.com/2';

export function xKeysPresent() {
  return Boolean(
    process.env.X_BEARER_TOKEN &&
      process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_TOKEN_SECRET,
  );
}

export function xReadPresent() {
  return Boolean(process.env.X_BEARER_TOKEN);
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    const e = new Error(`${name} is not set`);
    e.code = 'x-keys-missing';
    throw e;
  }
  return v;
}

function pct(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** OAuth 1.0a HMAC-SHA1 `Authorization` header for one request. */
export function oauthHeader(method, url, query = {}, now = Date.now(), nonce = randomBytes(16).toString('hex')) {
  const key = need('X_API_KEY');
  const secret = need('X_API_SECRET');
  const token = need('X_ACCESS_TOKEN');
  const tokenSecret = need('X_ACCESS_TOKEN_SECRET');
  const oauth = {
    oauth_consumer_key: key,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(now / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const all = { ...query, ...oauth };
  const base = [
    method.toUpperCase(),
    pct(url),
    pct(
      Object.keys(all)
        .sort()
        .map((k) => `${pct(k)}=${pct(all[k])}`)
        .join('&'),
    ),
  ].join('&');
  const signingKey = `${pct(secret)}&${pct(tokenSecret)}`;
  const sig = createHmac('sha1', signingKey).update(base).digest('base64');
  const parts = { ...oauth, oauth_signature: sig };
  return (
    'OAuth ' +
    Object.keys(parts)
      .sort()
      .map((k) => `${pct(k)}="${pct(parts[k])}"`)
      .join(', ')
  );
}

async function get(path, params) {
  return call('GET', path, { params });
}

/**
 * Diagnostic for /api/config?probe=mentions: what X returns for the bot's
 * mention timeline (raw meta + ids, app-only and as the bot) and for a
 * recent search of its handle — the two ways a mention can be found. Counts
 * and ids only; no text, no key.
 */
export async function timelineDiag(handle, bot) {
  const u = await call('GET', `/users/by/username/${encodeURIComponent(handle)}`, { params: { 'user.fields': 'created_at,protected,public_metrics' } });
  const id = u?.data?.id;
  if (!id) return { found: false };
  const j = await call('GET', `/users/${id}/tweets`, { params: { max_results: 5, 'tweet.fields': 'created_at,in_reply_to_user_id,entities' } });
  return {
    found: true, id, createdAt: u.data.created_at, protected: u.data.protected, metrics: u.data.public_metrics,
    tweets: (j?.data ?? []).map((t) => ({
      id: t.id, at: t.created_at, replyTo: t.in_reply_to_user_id ?? null,
      mentionsBot: (t.entities?.mentions ?? []).some((m) => m.username?.toLowerCase() === bot.handle.toLowerCase()),
      mentionIds: (t.entities?.mentions ?? []).map((m) => `${m.username}:${m.id}`),
    })),
    meta: j?.meta ?? null,
  };
}

/** One tweet by id, app-only and as the bot: found or the error X gives (visibility-limited posts come back as errors). */
export async function tweetDiag(id, bot) {
  const out = {};
  for (const [name, user] of [['appOnly', false], ['asBot', true]]) {
    try {
      const j = await call('GET', `/tweets/${id}`, { params: { 'tweet.fields': 'author_id,created_at,entities,in_reply_to_user_id' }, user });
      const t = j?.data;
      out[name] = t
        ? { found: true, at: t.created_at, author: t.author_id, replyTo: t.in_reply_to_user_id ?? null, mentionsBot: (t.entities?.mentions ?? []).some((m) => m.username?.toLowerCase() === bot.handle.toLowerCase()) }
        : { found: false, errors: j?.errors ?? null };
    } catch (e) {
      out[name] = { error: e.status ?? e.message, body: e.body?.errors ?? e.body ?? null };
    }
  }
  return out;
}

export async function mentionsDiag(bot) {
  const fields = { max_results: 10, 'tweet.fields': 'author_id,created_at' };
  const out = {};
  for (const [name, user] of [['appOnly', false], ['asBot', true]]) {
    try {
      const j = await call('GET', `/users/${bot.id}/mentions`, { params: fields, user });
      out[name] = { count: j?.data?.length ?? 0, meta: j?.meta ?? null, ids: (j?.data ?? []).map((t) => t.id) };
    } catch (e) {
      out[name] = { error: e.status ?? e.message };
    }
  }
  try {
    const j = await call('GET', '/tweets/search/recent', { params: { query: `@${bot.handle}`, max_results: 10, 'tweet.fields': 'author_id,created_at' } });
    out.search = { count: j?.data?.length ?? 0, meta: j?.meta ?? null, ids: (j?.data ?? []).map((t) => `${t.id}:${t.author_id}:${t.created_at}`) };
  } catch (e) {
    out.search = { error: e.status ?? e.message };
  }
  return out;
}

/**
 * One request; a non-2xx becomes an error that names the call, never a key.
 * Bearer (app-only) by default; `user: true` signs it as the bot account with
 * OAuth 1.0a instead — what X demands for a subscription to the bot's own
 * mentions ("OAuth user access token is required for this event type").
 */
async function call(method, path, { params, body, user = false } = {}) {
  const url = new URL(`${API}${path}`);
  const query = {};
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) query[k] = String(v);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = {
    authorization: user ? oauthHeader(method, `${API}${path}`, query) : `Bearer ${need('X_BEARER_TOKEN')}`,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`X ${method} ${path} → ${r.status}: ${JSON.stringify(json).slice(0, 300)}`);
    e.code = 'x-http';
    e.status = r.status;
    e.body = json;
    throw e;
  }
  return json;
}

/**
 * The bot's own account — id and handle. One call at worker start. `/users/me`
 * only answers in user context, so this is signed with the access token, not
 * the bearer: it tells us which account the tokens belong to, which is also
 * how the bot learns its own handle without anyone typing it.
 */
export async function me() {
  const url = `${API}/users/me`;
  const r = await fetch(url, { headers: { authorization: oauthHeader('GET', url) } });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`X GET /users/me → ${r.status}: ${JSON.stringify(json).slice(0, 300)}`);
    e.code = 'x-http';
    e.status = r.status;
    e.body = json;
    throw e;
  }
  return { id: json.data.id, handle: json.data.username };
}

/**
 * What the bot's access token is allowed to do, without posting anything:
 * X answers `verify_credentials` with an `x-access-level` header —
 * `read`, `read-write` or `read-write-directmessages`. Replies need write.
 */
export async function accessLevel() {
  const url = 'https://api.x.com/1.1/account/verify_credentials.json';
  const r = await fetch(url, { headers: { authorization: oauthHeader('GET', url) } });
  if (!r.ok) {
    const e = new Error(`X GET verify_credentials → ${r.status}`);
    e.code = 'x-http';
    e.status = r.status;
    throw e;
  }
  return r.headers.get('x-access-level') ?? 'unknown';
}

/** Public profile by @handle: id, handle, name, avatar. $0.01 per fresh lookup. */
export async function userByHandle(handle) {
  const h = String(handle).replace(/^@/, '');
  const j = await get(`/users/by/username/${encodeURIComponent(h)}`, {
    'user.fields': 'profile_image_url,name,username',
  });
  if (!j?.data) return null;
  return {
    id: j.data.id,
    handle: j.data.username,
    name: j.data.name ?? null,
    avatar: j.data.profile_image_url?.replace('_normal', '_200x200') ?? null,
  };
}

/**
 * Mentions of the bot since `sinceId`, newest first, with the fields the
 * parser needs. `in_reply_to_user_id` names the author of the tweet the
 * mention replied to — the recipient — and `expansions=author_id,
 * in_reply_to_user_id` brings both users' handles in the same response, so no
 * second call. Both `referenced_tweets` (current) and `referenced_posts`
 * (renamed in some docs) are read by the caller.
 */
export async function mentions(botUserId, sinceId) {
  const j = await get(`/users/${botUserId}/mentions`, {
    since_id: sinceId,
    max_results: 100,
    'tweet.fields': 'author_id,in_reply_to_user_id,referenced_tweets,conversation_id,created_at,text',
    expansions: 'author_id,in_reply_to_user_id,referenced_tweets.id',
    'user.fields': 'username,name,profile_image_url',
  });
  return normaliseMentions(j);
}

/** Pure: turns the raw API response into flat mention records. Unit-tested. */
export function normaliseMentions(j) {
  const users = new Map();
  for (const u of j?.includes?.users ?? []) users.set(u.id, u);
  const out = [];
  for (const t of j?.data ?? []) {
    const refs = t.referenced_tweets ?? t.referenced_posts ?? [];
    const parent = refs.find((r) => r.type === 'replied_to');
    const author = users.get(t.author_id);
    const recipient = t.in_reply_to_user_id ? users.get(t.in_reply_to_user_id) : null;
    out.push({
      id: t.id,
      text: t.text,
      createdAt: t.created_at ?? null,
      authorId: t.author_id,
      authorHandle: author?.username ?? null,
      authorName: author?.name ?? null,
      parentTweetId: parent?.id ?? null,
      recipientId: t.in_reply_to_user_id ?? null,
      recipientHandle: recipient?.username ?? null,
      recipientName: recipient?.name ?? null,
      recipientAvatar: recipient?.profile_image_url?.replace('_normal', '_200x200') ?? null,
    });
  }
  return { mentions: out, newestId: j?.meta?.newest_id ?? null };
}

/** Posts a reply under `tweetId`. Returns the new tweet id. */
export async function reply(tweetId, text) {
  const url = `${API}/tweets`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: oauthHeader('POST', url), 'content-type': 'application/json' },
    body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: String(tweetId) } }),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`X POST /tweets → ${r.status}: ${JSON.stringify(json).slice(0, 300)}`);
    e.code = 'x-http';
    e.status = r.status;
    e.body = json;
    throw e;
  }
  return json.data.id;
}

/** A plain post from the bot's own account (the webhook self-test). */
export async function postTweet(text) {
  const j = await call('POST', '/tweets', { body: { text }, user: true });
  return j.data.id;
}

export async function deleteTweet(id) {
  const j = await call('DELETE', `/tweets/${encodeURIComponent(String(id))}`, { user: true });
  return j?.data?.deleted ?? false;
}

/* ------------------------------------------------------------ webhook */

/**
 * Public profile by numeric id — the fallback when a webhook event names a
 * recipient the payload's `includes.users` did not carry. $0.01 per lookup.
 */
export async function userById(id) {
  const j = await get(`/users/${encodeURIComponent(String(id))}`, {
    'user.fields': 'profile_image_url,name,username',
  });
  if (!j?.data) return null;
  return {
    id: j.data.id,
    handle: j.data.username,
    name: j.data.name ?? null,
    avatar: j.data.profile_image_url?.replace('_normal', '_200x200') ?? null,
  };
}

/**
 * The CRC answer X expects when it checks that the webhook URL is ours: it
 * sends `?crc_token=…`, we answer with an HMAC-SHA256 of that token keyed by
 * the app's API secret, base64, as `{ response_token: "sha256=…" }`.
 */
export function crcResponseToken(crcToken) {
  const mac = createHmac('sha256', need('X_API_SECRET')).update(String(crcToken)).digest('base64');
  return `sha256=${mac}`;
}

/**
 * Every event X delivers carries `x-twitter-webhooks-signature`, the same
 * HMAC over the raw request body. Anything without a matching signature is
 * not from X and is dropped before it is even parsed.
 */
export function signatureValid(rawBody, header) {
  if (!header || typeof header !== 'string') return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', need('X_API_SECRET')).update(rawBody).digest('base64')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Pure: one `post.mention.create` event → the same flat mention record the
 * poll produces (see `normaliseMentions`), or null when the event is not a
 * mention. The payload is a full post object, so a reply carries
 * `in_reply_to_user_id` and `referenced_tweets` exactly like the mentions
 * timeline; `includes.users` names the people involved. Unit-tested.
 */
export function normaliseActivityMention(event) {
  const d = event?.data;
  if (!d || d.event_type !== 'post.mention.create') return null;
  const t = d.payload;
  if (!t?.id) return null;
  const users = new Map();
  for (const u of d.includes?.users ?? []) users.set(u.id, u);
  const refs = t.referenced_tweets ?? t.referenced_posts ?? [];
  const parent = refs.find((r) => r.type === 'replied_to');
  const author = users.get(t.author_id);
  const recipient = t.in_reply_to_user_id ? users.get(t.in_reply_to_user_id) : null;
  return {
    id: t.id,
    text: t.text,
    createdAt: t.created_at ?? null,
    authorId: t.author_id,
    authorHandle: author?.username ?? null,
    authorName: author?.name ?? null,
    parentTweetId: parent?.id ?? null,
    recipientId: t.in_reply_to_user_id ?? null,
    recipientHandle: recipient?.username ?? null,
    recipientName: recipient?.name ?? null,
    recipientAvatar: recipient?.profile_image_url?.replace('_normal', '_200x200') ?? null,
  };
}

const MENTION_EVENT = 'post.mention.create';

/** Every webhook on the app and every activity subscription — ids and URLs only. */
export async function hookStatus() {
  const [w, s] = await Promise.all([call('GET', '/webhooks'), call('GET', '/activity/subscriptions', { params: { max_results: 100 }, user: true })]);
  return {
    webhooks: (w?.data ?? []).map((x) => ({ id: x.id, url: x.url, valid: x.valid, createdAt: x.created_at })),
    subscriptions: (s?.data ?? []).map((x) => ({
      id: x.subscription_id,
      eventType: x.event_type,
      userId: x.filter?.user_id ?? null,
      webhookId: x.webhook_id ?? null,
      tag: x.tag ?? null,
    })),
  };
}

/**
 * Makes sure X pushes the bot's mentions to `url`: one webhook for that URL
 * (created if missing, re-validated if X marked it invalid) and one
 * `post.mention.create` subscription on the bot's user id pointed at it.
 * Idempotent — a second call finds both and changes nothing.
 */
export async function installWebhook({ url, botUserId }) {
  const before = await hookStatus();
  let hook = before.webhooks.find((w) => w.url === url);
  let madeHook = false;
  const dropped = [];
  if (!hook) {
    /* X allows one webhook per app. An older one of ours (same path, an
       earlier host — the .vercel.app URL before the domain) is replaced,
       not kept: its subscription is re-pointed at the new hook below. */
    for (const w of before.webhooks) {
      if (w.url.endsWith('/api/x/webhook') && w.url !== url) {
        await call('DELETE', `/webhooks/${w.id}`);
        dropped.push(w.url);
      }
    }
    const j = await call('POST', '/webhooks', { body: { url } });
    hook = { id: j.data.id, url: j.data.url, valid: j.data.valid };
    madeHook = true;
  } else if (!hook.valid) {
    const j = await call('PUT', `/webhooks/${hook.id}`);
    hook.valid = Boolean(j?.data?.valid);
  }
  const ours = before.subscriptions.filter((s) => s.eventType === MENTION_EVENT && s.userId === String(botUserId));
  let sub = ours.find((s) => s.webhookId === hook.id) ?? ours[0];
  let madeSub = false;
  if (!sub) {
    const j = await call('POST', '/activity/subscriptions', {
      body: { event_type: MENTION_EVENT, filter: { user_id: String(botUserId) }, tag: 'mentions', webhook_id: hook.id },
      user: true,
    });
    const s = j?.data?.subscription ?? j?.data ?? {};
    sub = { id: s.subscription_id ?? s.id ?? null, eventType: MENTION_EVENT, userId: String(botUserId), webhookId: hook.id };
    madeSub = true;
  } else if (sub.webhookId !== hook.id) {
    /* Re-point the subscription at the new hook. X's PUT answered 503 every
       time on 14 Sep 2026, so a failed update falls back to delete + create. */
    try {
      await call('PUT', `/activity/subscriptions/${sub.id}`, { body: { webhook_id: hook.id }, user: true });
      sub.webhookId = hook.id;
    } catch {
      /* The stale one may refuse to die too (503 again) — a new subscription
         on the right hook is what matters; the stale row is harmless. */
      await call('DELETE', `/activity/subscriptions/${sub.id}`, { user: true }).catch(() => {});
      const j = await call('POST', '/activity/subscriptions', {
        body: { event_type: MENTION_EVENT, filter: { user_id: String(botUserId) }, tag: 'mentions', webhook_id: hook.id },
        user: true,
      });
      const s = j?.data?.subscription ?? j?.data ?? {};
      sub = { id: s.subscription_id ?? s.id ?? null, eventType: MENTION_EVENT, userId: String(botUserId), webhookId: hook.id };
      madeSub = true;
    }
  }
  return { webhook: hook, subscription: sub, madeHook, madeSub, dropped };
}

/** Removes the mention subscription(s) and the webhook for `url`. */
/**
 * X keeps every event it tried to deliver for a while; a replay job pushes
 * them to the webhook again. Dates are UTC `yyyymmddhhmm`, inclusive.
 * App-only auth, like the webhook itself.
 */
export async function replayWebhook({ url, minutes = 60 }) {
  const hooks = (await hookStatus()).webhooks;
  const hook = hooks.find((h) => h.url === url);
  if (!hook) return { replayed: false, reason: 'no webhook for this url' };
  const stamp = (d) => d.toISOString().replace(/[-T:]/g, '').slice(0, 12);
  const to = new Date(Date.now() - 60_000);
  const from = new Date(Date.now() - minutes * 60_000);
  const j = await call('POST', '/webhooks/replay', { body: { webhook_id: hook.id, from_date: stamp(from), to_date: stamp(to) } });
  return { replayed: true, webhook: hook.id, from: stamp(from), to: stamp(to), job: j?.data ?? j };
}

export async function uninstallWebhook({ url }) {
  const st = await hookStatus();
  const hook = st.webhooks.find((w) => w.url === url);
  const removed = { subscriptions: [], webhook: null };
  for (const s of st.subscriptions) {
    if (s.eventType !== MENTION_EVENT) continue;
    if (hook && s.webhookId !== hook.id) continue;
    await call('DELETE', `/activity/subscriptions/${s.id}`, { user: true });
    removed.subscriptions.push(s.id);
  }
  if (hook) {
    await call('DELETE', `/webhooks/${hook.id}`);
    removed.webhook = hook.id;
  }
  return removed;
}
