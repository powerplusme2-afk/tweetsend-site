import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, MESSAGES, intentId, LIMITS } from './command.mjs';

test('parses the documented forms', () => {
  assert.deepEqual(parseCommand('@TweetSend $25'), { ok: true, usd: 25 });
  assert.deepEqual(parseCommand('@TweetSend 25'), { ok: true, usd: 25 });
  assert.deepEqual(parseCommand('@TweetSend $25.50'), { ok: true, usd: 25.5 });
  assert.deepEqual(parseCommand('@tweetsend $ 5'), { ok: true, usd: 5 });
  assert.deepEqual(parseCommand('hey @TweetSend send them $5 please'), { ok: true, usd: 5 });
  assert.deepEqual(parseCommand('@TweetSend 7,50'), { ok: true, usd: 7.5 });
});

test('rejects what the docs say is ignored', () => {
  assert.equal(parseCommand('@TweetSend thanks!').reason, 'no-amount');
  assert.equal(parseCommand('nothing here $5').reason, 'no-mention');
  assert.equal(parseCommand('@TweetSend $0.50').reason, 'too-small');
  assert.equal(parseCommand('@TweetSend $501').reason, 'too-large');
  assert.equal(parseCommand('@TweetSend $5 or $10').reason, 'multiple');
  assert.equal(parseCommand('@TweetSendApp $5').reason, 'no-mention');
  /* A number that is part of a word or a handle is not an amount. */
  assert.equal(parseCommand('@TweetSend @user42').reason, 'no-amount');
  assert.equal(parseCommand('@TweetSend v2').reason, 'no-amount');
});

test('a number before the mention does not count', () => {
  assert.equal(parseCommand('$50 @TweetSend').reason, 'no-amount');
});

test('messages are the fixed strings from the plan', () => {
  assert.equal(
    MESSAGES.ready({ amount: 25, to: 'bob', link: 'tweetsend.xyz/p/k7f3q' }),
    'Ready — confirm your $25 to @bob: tweetsend.xyz/p/k7f3q',
  );
  assert.equal(MESSAGES.sent({ amount: 25.5, to: 'bob' }), '$25.50 sent to @bob.');
  assert.equal(
    MESSAGES.waiting({ amount: 25, to: 'bob', site: 'TweetSend' }),
    '$25 is waiting for @bob. Claim it by signing in with X at TweetSend.',
  );
  assert.equal(MESSAGES.limits(), `Sends are $${LIMITS.minUsd}–$${LIMITS.maxUsd} for now.`);
});

test('intent ids are 10 chars from the safe alphabet', () => {
  const id = intentId(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  assert.match(id, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
});
