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

Neon Postgres was installed on Vercel later the same day (`DATABASE_URL` on Production); `/api/*` and `/pay/:id` read and write for real now.

## Spike 2 — poll mentions, confirm `in_reply_to_user_id` + field spelling — HALF RUN

Done 14 Sep 2026 (evening), all on the live site with the client's keys in Vercel:
- `GET /api/config?probe=1` → X bearer `200` (profile lookup), bot access token `200` (`/users/me` = **@tweetsendcc**), Privy secret accepted (`404` on an unknown subject).
- First live tick `GET /api/tick?dry=1` → `{"bot":"tweetsendcc","since":null,"mentions":0,"announced":0,"expired":0}` — the mentions call authenticates and returns an empty page (nobody has mentioned the bot yet).
- Heartbeat: `.github/workflows/tick.yml` calls `/api/tick` every 5 minutes with `TICK_TOKEN` (repo secret + Vercel env). Vercel Hobby crons run once a day, so GitHub is the scheduler. Note 14 Sep 2026: the schedule had not fired once in its first hour (only manual runs) — GitHub cron is best-effort.
- Instant path (14 Sep 2026): X Activity API webhook `https://tweetsend.com/api/x/webhook` (id 2099513597781057537, CRC valid; the earlier .vercel.app hook was replaced — X allows one webhook per app) + `post.mention.create` subscription 2099523730560995328 on @tweetsendcc, installed by the `x webhook` workflow (`gh workflow run hooks.yml -f action=install|status|uninstall`). The subscription must be created as the bot account (OAuth 1.0a) — app-only bearer gets `OauthAccessTokenRequired`. Each mention is claimed once in `seen_mentions`, so webhook and poll never both answer. First real webhook delivery NOT yet observed — needs a real `@tweetsendcc $5` reply; `status` shows the last 5 deliveries.

NOT RUN: a real mention. Next: from any X account, reply `@tweetsendcc $5` under someone else's tweet, then `GET /api/tick?dry=1` must show one result with `intent` and `walletMade`, and `wouldPost` carrying the pay link. That also runs spike 1's pre-generate for real. The reply call (`POST /2/tweets`) stays UNVERIFIED until the first non-dry tick.

## 14 Sep 2026, evening — the webhook never fires; the stream does

- First real mention (tweet 2099529610295972245, @onemavik → @perplexity_ai, "$5") at 16:04:01Z: X pushed nothing to the webhook. A hand-run poll answered it at 16:05:23Z (reply 2099529954656497775, intent epnkf3encs).
- Two self-mentions from the bot (`hooks ping`) at 16:25Z and 16:28Z: zero webhook POSTs, not even a rejected one (rejects are now logged as `webhook-reject`). Both posts deleted (`unping`).
- `POST /2/webhooks/replay` refuses our hook ("WebhookIdInvalid … not associated with app ID") — replay is not for this tier.
- X developer forum, thread 273644: the same `post.mention.create` subscription delivers over `GET /2/activity/stream` in ~4 s but never POSTs to the webhook, since 2026-08-09. Matches exactly.
- `hooks stream-probe` from Vercel: `{"opened":true,"seconds":25,"events":0}` — the read token may hold the stream (headers take ~15 s to arrive; a 12 s probe times out). First connect after a subscription change → 503 ProvisioningSubscription for about a minute.
- GitHub cron: 0 scheduled runs of tick.yml between 12:50Z and 16:40Z (5 dispatches only). The bot answers nothing on its own right now. Cron expression changed to re-register; relay.mjs also ticks every 5 min.
- Built: shared/stream.mjs (line splitter + reconnecting reader), worker/index.mjs --stream, worker/relay.mjs (needs X_BEARER_TOKEN + TICK_TOKEN only; forwards events to /api/x/event), .github/workflows/relay.yml (self-renewing 350-min job; private repo = 2 000 free minutes a month ≈ 1.4 days, public = uncapped).
- Not yet proven: an event flowing stream → relay → /api/x/event → reply. Needs the relay running somewhere with the read token.

## 14 Sep 2026, 23:00 IST — the clock is a Vercel Workflow

- `src/workflows/poller.ts`: tick → sleep 5 min → repeat, lease in worker_state, hand-over to a new run daily. `/api/poller` start|stop|status; `poller.yml` is the button.
- First run stayed `pending` forever: with a local `vercel build` the Astro integration only emits the Vercel queue-triggered functions when `VERCEL_DEPLOYMENT_ID` is set. Build with `VERCEL_DEPLOYMENT_ID=local npx vercel build --prod --yes` → `.vercel/output/functions/.well-known/workflow/v1/{flow,step}.func` with `experimentalTriggers`. Then the first tick ran 1.8 s after start (17:31:50Z).
- Budget: Hobby 50 000 workflow events/month; ~5 per tick+sleep → 5-min cadence ≈ 43 000. Do not go faster on Hobby.
- Stale run wrun_01M2GF9CN3XQ40VZ55WJE6XHQC (old deployment) never started; cancelled/ignored.
