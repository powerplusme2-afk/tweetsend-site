/**
 * The command grammar, the limits and the bot's fixed replies.
 *
 * Plain ESM so the same file is imported by the worker (Node), the API routes
 * and the browser — one parser, one set of limits, one set of sentences.
 * Every bot reply is a fixed string with numbers filled in; nothing here is
 * generated text, which is what X's automation rules require.
 */

/** Decision C in the plan: $1–$500 per send, $2,000 per sender per day. */
export const LIMITS = Object.freeze({
  minUsd: 1,
  maxUsd: 500,
  dailyUsd: 2000,
  /** Unpaid intents expire after this many hours. */
  expiryHours: 24,
});

/** The bot's handle: `X_BOT_HANDLE`, else what the worker learned from `/users/me`, else the product name. */
export function botHandle() {
  return (typeof process !== 'undefined' && process.env && process.env.X_BOT_HANDLE) || 'TweetSend';
}
export const BOT_HANDLE = botHandle();

/**
 * Finds the amount in a reply such as `@TweetSend $25`, `@TweetSend 25`,
 * `@TweetSend $25.50`, `hey @tweetsend send them $5 please`.
 *
 * Returns `{ ok: true, usd }` with the amount rounded to cents, or
 * `{ ok: false, reason }` where reason is one of:
 *   'no-mention'  — the bot is not mentioned at all
 *   'no-amount'   — mentioned, but no number anywhere after the mention
 *   'too-small' / 'too-large' — outside LIMITS
 *   'multiple'    — more than one amount; ambiguous, so nothing happens
 */
export function parseCommand(text, handle = botHandle()) {
  const t = String(text ?? '');
  const mention = new RegExp(`@${escapeRe(handle)}\\b`, 'i');
  const at = t.search(mention);
  if (at < 0) return { ok: false, reason: 'no-mention' };
  const after = t.slice(at + handle.length + 1);
  const amounts = [];
  const re = /(?:^|[\s(])\$?\s?(\d{1,6}(?:[.,]\d{1,2})?)(?=$|[\s).!?,;:])/g;
  let m;
  while ((m = re.exec(after)) !== null) {
    const raw = m[1].replace(',', '.');
    const n = Number(raw);
    if (Number.isFinite(n)) amounts.push(n);
  }
  if (amounts.length === 0) return { ok: false, reason: 'no-amount' };
  if (amounts.length > 1) return { ok: false, reason: 'multiple' };
  const usd = Math.round(amounts[0] * 100) / 100;
  if (usd < LIMITS.minUsd) return { ok: false, reason: 'too-small' };
  if (usd > LIMITS.maxUsd) return { ok: false, reason: 'too-large' };
  return { ok: true, usd };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function usd(n) {
  const v = Number(n);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

/** The bot's replies. Fixed strings, never generated. */
export const MESSAGES = Object.freeze({
  /** Command detected — decision B: with the pay link ($0.20). */
  ready: ({ amount, to, link }) =>
    amount == null
      ? `Ready — pick an amount to send @${to}: ${link}`
      : `Ready — confirm your ${usd(amount)} to @${to}: ${link}`,
  /** Paid, recipient already has an account. */
  sent: ({ amount, to }) => `${usd(amount)} sent to @${to}.`,
  /** Paid, recipient has never signed in. */
  waiting: ({ amount, to, site }) =>
    `${usd(amount)} is waiting for @${to}. Claim it by signing in with X at ${site}.`,
  /** Kept for the site's own copy; the bot no longer needs an amount in the tweet. */
  noAmount: () => `Tell me how much: reply with @${botHandle()} and an amount, like $10.`,
  limits: () => `Sends are ${usd(LIMITS.minUsd)}–${usd(LIMITS.maxUsd)} for now.`,
  self: () => `You can't send to yourself.`,
});

/** A short, unguessable intent id: 10 chars from a 32-letter alphabet (50 bits). */
export function intentId(randomBytes) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[randomBytes[i] % alphabet.length];
  return out;
}
