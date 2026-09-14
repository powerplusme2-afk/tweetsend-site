# TweetSend — open tasks (14 Sep 2026, 23:05 IST)

Status words: DONE = verified live · BUILT = code live, not yet proven end to end · OPEN = not started · YOU = needs the client.

| # | Task | Status | Proof / what is missing |
|---|------|--------|-------------------------|
| 1 | Bot replies to `@tweetsendcc $5` and to bare `@tweetsendcc` (reply to the person you pay) | DONE | @jackipaj 17:14Z → reply 17:17Z with `…/pay/4e3b66hrn4?a=5`; parse tests 10/10 |
| 2 | Bot runs on its own (no hand-run) | DONE | Vercel Workflow clock: tick every 5 min, first tick 17:31:50Z; GitHub cron replaced (0 runs in 5 h) |
| 3 | Reply within seconds ("instant") | BUILT | X webhook is broken on X's side; stream relay (`worker/relay.mjs`) ready. Needs one always-on host: repo public + `X_BEARER_TOKEN` secret (YOU), or any box |
| 4 | "Whole screen goes blue" on Send | DONE | scrim was navy `#000243cc` → black 55 % + blur (commit 729e0fb) |
| 5 | Site links to https://x.com/tweetsendcc | DONE | landing (2 links) + app sidebar "@tweetsendcc on X ↗" |
| 6 | Sign in with X on tweetsend.com/app | YOU | jack reached "Confirm in your wallet", so login works for him; your own try still pending |
| 7 | One real mainnet payment through the pay page | YOU | jack stopped at the wallet confirm; no paid intent yet |
| 8 | Regenerate the X keys + OAuth 2.0 client secret pasted into chat; re-enter in Vercel and Privy | YOU | security hygiene |
| 9 | Delete Vercel project `tweetsend-vivid` (no domains left) | OPEN | cosmetic |
| 10 | `app.tweetsend.com` CNAME (optional) | OPEN | only apex + www exist |
| 11 | Workflow event budget: 5-min clock ≈ 43 k of Hobby's 50 k events/month | WATCH | check Vercel → Observability → Workflows around the 25th |
