# TweetSend

Reply `@TweetSend $25` under a tweet → the bot replies with a pay link → the sender signs in with X and sends USDG on Robinhood Chain → the recipient signs in with X and the money is already in a wallet that is theirs. No contract, no custody.

Plan of record: `PLAN.md`. Spike results: `SPIKES.md`.

## Layout

| Path | What |
|---|---|
| `/` | Redirects to `/app` (astro.config.mjs) — the marketing site is a separate deployment |
| `src/pages/app/*` | Activity · Send · Claims · Settings · Login (static shells, data via `/api/*`) |
| `src/pages/pay/[id].astro` | The pay link the bot posts (server-rendered) |
| `src/pages/api/*` | `config`, `me`, `activity`, `intents`, `intents/:id`, `intents/:id/paid` |
| `src/server/*` | Privy token verification (JWKS, no secret needed), receipt verification on chain, handle → wallet resolution |
| `src/app/*` | Browser side: Privy bridge (X profile + tokens), chain config, transfers |
| `shared/*` | Plain ESM used by both the site and the worker: command grammar + bot strings, DB, Privy REST, X API, intents |
| `shared/bot.mjs` | One bot tick (poll mentions → intents → replies); `worker/index.mjs` loops it, `api/tick` runs it on Vercel |
| `.verify/e2e.mjs` | API end-to-end with a real testnet transfer |

## Run

```bash
npm install            # PUPPETEER_SKIP_DOWNLOAD=1 if Chromium cannot be fetched
npm test               # parser + X normaliser + OAuth signature: 7 tests
./node_modules/.bin/astro check
DEV_FAKE_AUTH=1 PUBLIC_CHAIN_ID=46630 ./node_modules/.bin/astro dev --port 4346
node .verify/e2e.mjs http://localhost:4346
```

With no `DATABASE_URL` the app uses PGlite (an in-process Postgres under `.data/pglite`). On Vercel `DATABASE_URL` must be set.

## Environment

See `.env.example`. Values are entered by the client in the Vercel project (web) and the worker host; nothing in this repo reads them from anywhere else and the app never displays them — `/api/config` reports only set / not set.

| Where | Variables |
|---|---|
| Web (Vercel) | `PUBLIC_PRIVY_APP_ID` (optional), `PUBLIC_CHAIN_ID`, `PUBLIC_SITE_URL`, `DATABASE_URL`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `X_BEARER_TOKEN` (for handle lookups) |
| Worker | all of the above plus `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `X_BOT_HANDLE` |

## Worker

```bash
node worker/index.mjs            # loop, every 60 s (+ jitter)
node worker/index.mjs --once     # one tick
node worker/index.mjs --once --dry   # read + write intents, post nothing
```

Runs anywhere Node 22+ runs (Railway / Fly, ~$5/mo). It exits with code 2 and a sentence if a key is missing. Without a host, `GET /api/tick` (header `authorization: Bearer $TICK_TOKEN`, `?dry=1` to post nothing) runs one tick on Vercel — any minute-cron pinger keeps the bot alive (Vercel Hobby crons run once a day, not enough).

## What the server checks before an intent is `paid`

The USDG transaction must have succeeded and emitted a `Transfer` from the chain's USDG contract to the recipient's wallet for at least the intent amount; the optional ETH drip must have gone to the same wallet; a hash can pay exactly one send. See `src/server/chain.ts`.
