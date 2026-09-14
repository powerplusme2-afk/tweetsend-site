import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMentions, oauthHeader } from '../shared/x.mjs';

/* The shape docs.x.com documents for GET /2/users/:id/mentions with
   expansions=author_id,in_reply_to_user_id — saved here so a rename on X's
   side fails a test before it fails the bot. Both spellings are accepted. */
const RAW = {
  data: [
    {
      id: '1900000000000000001',
      text: '@TweetSend $25',
      author_id: '111',
      in_reply_to_user_id: '222',
      conversation_id: '1899999999999999999',
      created_at: '2026-09-14T08:00:00.000Z',
      referenced_tweets: [{ type: 'replied_to', id: '1899999999999999999' }],
    },
    {
      id: '1900000000000000002',
      text: '@TweetSend thanks',
      author_id: '111',
      referenced_posts: [{ type: 'quoted', id: '5' }],
    },
  ],
  includes: {
    users: [
      { id: '111', username: 'alice', name: 'Alice', profile_image_url: 'https://pbs.twimg.com/a_normal.jpg' },
      { id: '222', username: 'bob', name: 'Bob', profile_image_url: 'https://pbs.twimg.com/b_normal.jpg' },
    ],
  },
  meta: { newest_id: '1900000000000000002', result_count: 2 },
};

test('normaliseMentions resolves author, recipient and parent from one response', () => {
  const { mentions, newestId } = normaliseMentions(RAW);
  assert.equal(newestId, '1900000000000000002');
  assert.equal(mentions.length, 2);
  const m = mentions[0];
  assert.equal(m.authorHandle, 'alice');
  assert.equal(m.recipientId, '222');
  assert.equal(m.recipientHandle, 'bob');
  assert.equal(m.recipientAvatar, 'https://pbs.twimg.com/b_200x200.jpg');
  assert.equal(m.parentTweetId, '1899999999999999999');
  const n = mentions[1];
  assert.equal(n.recipientId, null);
  assert.equal(n.parentTweetId, null);
});

test('oauthHeader reproduces the signature from the X docs worked example', () => {
  /* docs.x.com "Creating a signature": consumer + token from the example. */
  process.env.X_API_KEY = 'xvz1evFS4wEEPTGEFPHBog';
  process.env.X_API_SECRET = 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw';
  process.env.X_ACCESS_TOKEN = '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb';
  process.env.X_ACCESS_TOKEN_SECRET = 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE';
  const h = oauthHeader(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json',
    { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    1318622958 * 1000,
    'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
  );
  assert.match(h, /^OAuth /);
  assert.ok(h.includes('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"'), h);
});

/* ---------------------------------------------------------------- webhook */
import { normaliseActivityMention, crcResponseToken, signatureValid } from '../shared/x.mjs';
import { createHmac } from 'node:crypto';

/* docs.x.com "Event payloads" sample for post.mention.create (14 Sep 2026),
   with the reply fields a real mention-in-a-reply carries. */
const EVENT = {
  data: {
    event_uuid: '2080765813578191303',
    filter: { user_id: '999' },
    event_type: 'post.mention.create',
    tag: 'mentions',
    payload: {
      id: '2080765813578191303',
      text: '@tweetsendcc $25',
      author_id: '111',
      in_reply_to_user_id: '222',
      conversation_id: '1899999999999999999',
      created_at: '2026-09-14T13:00:00.000Z',
      referenced_tweets: [{ type: 'replied_to', id: '1899999999999999999' }],
      entities: { mentions: [{ start: 0, end: 12, username: 'tweetsendcc', id: '999' }] },
    },
    includes: {
      users: [
        { id: '111', username: 'alice', name: 'Alice', profile_image_url: 'https://pbs.twimg.com/a_normal.jpg' },
        { id: '222', username: 'bob', name: 'Bob' },
        { id: '999', username: 'tweetsendcc', name: 'TweetSend' },
      ],
    },
  },
};

test('normaliseActivityMention gives the same record the poll would', () => {
  const m = normaliseActivityMention(EVENT);
  assert.equal(m.id, '2080765813578191303');
  assert.equal(m.text, '@tweetsendcc $25');
  assert.equal(m.authorId, '111');
  assert.equal(m.authorHandle, 'alice');
  assert.equal(m.recipientId, '222');
  assert.equal(m.recipientHandle, 'bob');
  assert.equal(m.parentTweetId, '1899999999999999999');
  assert.equal(m.recipientAvatar, null);
  assert.equal(normaliseActivityMention({ data: { event_type: 'like.create', payload: { id: '1' } } }), null);
  assert.equal(normaliseActivityMention(null), null);
});

test('CRC answer and event signature use HMAC-SHA256 of the API secret, base64', () => {
  process.env.X_API_SECRET = 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw';
  const expect = (s) => `sha256=${createHmac('sha256', process.env.X_API_SECRET).update(s).digest('base64')}`;
  assert.equal(crcResponseToken('abc123'), expect('abc123'));
  const body = JSON.stringify(EVENT);
  assert.equal(signatureValid(body, expect(body)), true);
  assert.equal(signatureValid(body, expect(body + ' ')), false);
  assert.equal(signatureValid(body, 'sha256=short'), false);
  assert.equal(signatureValid(body, null), false);
});
