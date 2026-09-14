# TweetSend — spikes (week 1 of PLAN.md §6)

Real output only. Anything not run is marked NOT RUN.

## Spike 3 — USDG + dust ETH to a never-signed-in wallet, then a transfer out — DONE 14 Sep 2026

Chain 46630 (Robinhood Chain Testnet). Sender = Sendly faucet wallet `0x9e74bC723dE57d1E3e1613c0840dAAdA82417bA0`. Recipient = a wallet made a second earlier, never used.

| Step | Tx | Result |
|---|---|---|
| Fresh recipient | — | `0x4E15CBad57a8c8f8566612e1c0ef53a5385AFC35` |
| 5 USDG in | `0x7aa3fa06caa77544076a4a0035b43fd40c05ba6f3b1743263df02d8ca5895921` | recipient USDG 5,000,000 raw = 5.00 |
| 0.0002 ETH drip in | `0x980e2aca1a5c7260706c4c2bc31f3e20311628b2df31cceb1bb968384f7649a3` | recipient ETH 0.0002 |
| Transfer out (5 USDG → faucet), paid by the drip | `0x741fa547a39c2c8344fdc99688288631047b0fb7b1cadf3ad399df02d74146ba` | status 0x1, gasUsed 36,828, ETH left 0.00019963 |

Finding: one ERC-20 transfer cost 0.000000368 ETH on the testnet, so a 0.0002 ETH drip pays for ~540 transfers. The drip in `src/app/chain/tx.ts` (`DRIP_ETH = '0.0002'`) is kept at the plan's figure for mainnet, where the gas price is UNVERIFIED; it can be cut 10× once a mainnet transfer has been measured.

Explorer: https://explorer.testnet.chain.robinhood.com/tx/<hash>

## API end-to-end (site send → real receipt → claim) — DONE 14 Sep 2026

`node .verify/e2e.mjs http://localhost:4346` with `DEV_FAKE_AUTH=1`: **19/19**. Includes a real 5 USDG transfer `0x8b2ffe0efd53ad7664c321857be9dd162f2604bb1597025703293b8f5dd259a3`, verified by the server from the receipt's `Transfer` log (to = recipient wallet, value ≥ amount), then `paid` → `claimed` when the recipient signed in. Refusals covered: amount outside limits, self-send, unknown hash, a hash reused for a second send, an unknown handle with no `PRIVY_APP_SECRET` (the error names the variable).

## Spike 1 — Privy pre-made wallet for an X id, then sign in → same wallet — NOT RUN

Blocked on two things the client owns:
1. The shared Privy app `cmtwzyj3t013t0ci9h4wew655` has `twitter_oauth: false` (read from `https://auth.privy.io/api/v1/apps/<id>` on 14 Sep 2026). Enable it: Privy dashboard → Login methods → Twitter (X). The app detects the switch at load time — no rebuild.
2. `PRIVY_APP_SECRET` in the server env, so the worker can call `POST /v1/users` (pre-generate). The call is written in `shared/privy.mjs`; the endpoint spellings for "user by Twitter subject/username" are UNVERIFIED until this runs.

What to run once both are set: `node worker/spike1.mjs <x-numeric-id> <handle>` (to be written when the secret exists) → prints the pre-made wallet; then sign in with that X account on `/app/settings` and compare the "TweetSend wallet" line.

## Spike 2 — poll mentions, confirm `in_reply_to_user_id` + field spelling — NOT RUN LIVE

The parser is written against the documented shape and unit-tested (`worker/worker.test.mjs`, both `referenced_tweets` and `referenced_posts` accepted). Needs `X_BEARER_TOKEN` in the env and a test reply to the bot account. Run: `node worker/index.mjs --once --dry` — reads mentions, writes intents, posts nothing.

The OAuth 1.0a signer reproduces the worked example in X's docs byte for byte (`hCtSmYh+iHYCEqBWrE7C7hYmtUk=`), so the reply call is expected to authenticate; UNVERIFIED against the live API until the bot account's access token + secret exist.
