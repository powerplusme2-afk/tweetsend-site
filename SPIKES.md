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

## Spike 1 — Privy pre-made wallet for an X id, then sign in → same wallet — HALF RUN

Done 14 Sep 2026 (later the same day):
- Privy app `cmtwzyj3t013t0ci9h4wew655` now reports `twitter_oauth: true` (client switched it on with the X app's OAuth 2.0 Client ID).
- Live https://tweetsend-site.vercel.app/app: banner gone, "Sign in with X" → Privy sheet lists Email / Twitter / wallet → Twitter sends the browser to `https://x.com/i/oauth2/authorize` with `redirect_uri=https://auth.privy.io/api/v1/oauth/callback`, `scope=users.read tweet.read`. X rendered its "Authorize app" page (asks to log in). No console errors.

NOT RUN — needs a person with an X account and the app secret:
1. Log in on that X page and authorize. If X then says the callback is not allowed, add `https://auth.privy.io/api/v1/oauth/callback` under User authentication settings in the X developer portal.
2. `PRIVY_APP_SECRET` in the env, then `node worker/spike1.mjs <x-numeric-id> [handle]` (exit 2 without input/secret, 3 if Privy refuses) → prints the pre-made wallet; sign in with that X account on `/app/settings` and compare the "TweetSend wallet" line. The "user by Twitter subject/username" endpoint spellings in `shared/privy.mjs` are UNVERIFIED until this runs.

Note: on the live site the first sign-in will end at "database is not connected" until Neon is installed (terms acceptance pending, see README).

## Spike 2 — poll mentions, confirm `in_reply_to_user_id` + field spelling — HALF RUN

Done 14 Sep 2026 (evening), all on the live site with the client's keys in Vercel:
- `GET /api/config?probe=1` → X bearer `200` (profile lookup), bot access token `200` (`/users/me` = **@tweetsendcc**), Privy secret accepted (`404` on an unknown subject).
- First live tick `GET /api/tick?dry=1` → `{"bot":"tweetsendcc","since":null,"mentions":0,"announced":0,"expired":0}` — the mentions call authenticates and returns an empty page (nobody has mentioned the bot yet).
- Heartbeat: `.github/workflows/tick.yml` calls `/api/tick` every 5 minutes with `TICK_TOKEN` (repo secret + Vercel env). Vercel Hobby crons run once a day, so GitHub is the scheduler.

NOT RUN: a real mention. Next: from any X account, reply `@tweetsendcc $5` under someone else's tweet, then `GET /api/tick?dry=1` must show one result with `intent` and `walletMade`, and `wouldPost` carrying the pay link. That also runs spike 1's pre-generate for real. The reply call (`POST /2/tweets`) stays UNVERIFIED until the first non-dry tick.
