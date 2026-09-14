#!/usr/bin/env node
/**
 * Spike 1 — does Privy hand an X account the wallet we pre-made for its id?
 *
 *   node worker/spike1.mjs <x-numeric-id> [handle]
 *
 * Step A (this script, needs PRIVY_APP_SECRET): look the X id up, pre-make a
 * user + Ethereum wallet if there is none, print the wallet.
 * Step B (a person): sign in with that X account on /app/settings and compare
 * the "TweetSend wallet" line with the address printed here. Same → the
 * design holds. Different → PLAN.md §4 must change before anything ships.
 *
 * Exit codes: 0 printed a wallet · 2 missing input or secret · 3 Privy refused.
 */
import { privySecretPresent, getUserByXId, getUserByXHandle, ensureUserForX } from '../shared/privy.mjs';

const [xId, handle] = process.argv.slice(2);
if (!xId || !/^\d+$/.test(xId)) {
  console.error('usage: node worker/spike1.mjs <x-numeric-id> [handle]\n(the id is the number X gives every account; https://api.x.com/2/users/by/username/<handle> returns it)');
  process.exit(2);
}
if (!privySecretPresent()) {
  console.error('PRIVY_APP_SECRET is not set — Privy dashboard → App settings → Basics → App secret. Add it to the env yourself, then rerun.');
  process.exit(2);
}

try {
  const byId = await getUserByXId(xId);
  console.log(`lookup by subject ${xId}: ${byId ? `found ${byId.privyId} wallet ${byId.wallet ?? 'none'}` : 'no user'}`);
  if (handle) {
    const byHandle = await getUserByXHandle(handle);
    console.log(`lookup by username @${handle}: ${byHandle ? `found ${byHandle.privyId} wallet ${byHandle.wallet ?? 'none'}` : 'no user'}`);
  }
  const u = await ensureUserForX({ xId, handle: handle ?? null, name: null });
  console.log(`${u.created ? 'pre-made' : 'existing'} user ${u.privyId}`);
  console.log(`wallet ${u.wallet}`);
  console.log('\nnow sign in with that X account on /app/settings and compare the "TweetSend wallet" line.');
} catch (e) {
  console.error(`Privy refused: ${e.message}`);
  process.exit(3);
}
