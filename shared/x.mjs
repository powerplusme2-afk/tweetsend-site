/**
 * The X API v2, the four calls the bot makes.
 *
 * Reads use the app bearer token (`X_BEARER_TOKEN`). Posting a reply is an
 * action by the bot account itself, so it is signed with OAuth 1.0a user
 * context (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
 * `X_ACCESS_TOKEN_SECRET`) — the simplest scheme for one account that never
 * changes, and the one the plan chose. All five values are entered by the
 * client; nothing here ever prints them.
 *
 * Costs (pay-per-use, checked 12 Sep 2026): a mention returned $0.001, an
 * empty poll free, a reply $0.01, a reply containing a URL $0.20.
 */
import { createHmac, randomBytes } from 'node:crypto';

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
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { authorization: `Bearer ${need('X_BEARER_TOKEN')}` } });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`X GET ${path} → ${r.status}: ${JSON.stringify(json).slice(0, 300)}`);
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
