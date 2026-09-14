# TweetSend — build plan

Source: client narrative doc (Google Doc `1xKZWYpK8d7B675-Uq_UYgPdq_En0AuwiN0LoUMEADXE`), read 12 Sep 2026.
Research facts below were checked against docs.x.com and docs.privy.io on 12 Sep 2026. Anything not confirmed is marked UNVERIFIED.

One line: reply `@TweetSend $25` under someone's tweet and they get $25 — to a wallet that is theirs the moment they sign in with X.

---

## 1. What the tech allows (checked, not assumed)

### X API — the bot can exist, on pay-per-use only

| Fact | Value | Why it matters |
|---|---|---|
| Access tiers | Free, Basic ($200), Pro ($5k) are all gone (closed Feb–Sep 2026). Only **Pay-Per-Use** (prepaid credits, no minimum) is self-serve | No subscription. Budget is per action |
| Reading our own mentions | **$0.001 per mention returned**; empty polls free; 300 calls / 15 min | Polling every 60 s is fine and nearly free |
| Posting a reply | **$0.010** per reply to someone who mentioned us; **$0.200 if the reply contains a URL** | The confirmation-link reply is 20× dearer. Decision in §7 |
| Reply limits | 100 / 15 min per bot account, 10,000 / day per app | Enough for MVP |
| Who we may reply to | Only accounts that @mentioned us ("summoned"). We may @mention the tweet author inside that reply because they're in the thread | We reply under the sender's reply, never under the original tweet |
| Parent tweet author | The mention is a reply, so it carries `in_reply_to_user_id`; expand it to get the author's id + handle | No second API call. Field spelling is mid-rename in X docs (`referenced_tweets` vs `referenced_posts`) — test live, UNVERIFIED which one the API accepts today |
| Bot account rules | Must carry the **"Automated" profile label** with a human managing account; bio must say who runs it; one automated reply per interaction; replies must be templated (AI-written replies need X's written approval) | Bot copy is fixed strings, never generated |
| Webhooks | X Activity API exists (`post.mention.create`) but bills $0.005/event vs $0.001 for polling | Poll. Webhooks are a later optimisation |
| Auth for the bot | OAuth 1.0a keys from the console, or OAuth 2.0 user token with `offline.access` (refresh every 2 h) | Use OAuth 1.0a for the bot's own posting — simplest |
| Sign in with X for users | Handled by Privy, not by us. Own X app credentials recommended for production (confidential client, callback `https://auth.privy.io/api/v1/oauth/callback`) | One X developer app serves both the bot and login |

### Privy — X login and "wallet before sign-up" are built in

| Fact | Value |
|---|---|
| Sign in with X | Stock login method. Returns `subject` (X user id), `username`, `name`, `profilePictureUrl` |
| Pre-generated wallets | `POST /v1/users` with `linked_accounts:[{type:'twitter_oauth', subject, username, name}]` and `wallets:[{chain_type:'ethereum'}]`. Docs: "You can even send assets to the wallet before the user logs in." When that X account signs in, the wallet is already theirs |
| What we must know first | The recipient's **X numeric user id** (`subject`) — which the mentions poll gives us. That Privy's `subject` equals X's numeric id is the single most important assumption: **spike #1**, UNVERIFIED until run |
| Gas sponsorship | Not on Robinhood Chain mainnet (Privy lists only its testnet). Recipients' pre-made wallets hold no ETH, so every send carries a dust ETH drip for the recipient's gas |
| Server wallets + policies | Available (policy engine: allowlists, max amounts). Not needed for MVP with direct transfers |
| Pricing | Free to 500 monthly active users; $299/mo to 2,499. A pre-made wallet that never signs in is not an active user (inference from Privy's MAU definition, UNVERIFIED) |
| No escrow product | Privy has no "claimable transfer" feature. Their documented pattern for paying non-users is exactly the pre-generated wallet |

### Decision: Robinhood Chain + USDG (client rule, 13 Sep 2026)

| | Robinhood Chain 4663 + USDG (chosen) | What it costs us vs another chain |
|---|---|---|
| Recipient moving funds out | Needs ETH for gas; Privy sponsors gas only on Robinhood **testnet**, not mainnet | A dust ETH drip (≈ 0.0002 ETH ≈ $0.50) rides along with every send |
| Sender wallets holding the asset | Robinhood Chain wallets hold USDG; anyone else bridges first | Bridge links in the pay page for senders with nothing on 4663 |
| Explorer | robinhoodchain.blockscout.com (source-verified, tx links) | — |
| Reuse from Stockpilot | Privy config, chain constants, `wallet.ts` transfers, Blockscout links — all already verified on 4663 | Nothing new to verify on the chain side |

Client rule (13 Sep 2026): every platform is built on Robinhood Chain. So: USDG on chain 4663. Consequence: Privy does not sponsor gas on Robinhood mainnet, so every pre-made recipient wallet is funded with a small ETH drip at claim time (≈ 0.0002 ETH ≈ $0.50, paid by the sender as part of the send, or by a Stakepad/TweetSend gas wallet — decision B2). The sender pays USDG + a dust ETH transfer in the same confirmation. Testnet 46630 exists for proving the flow.

---

## 2. Architecture

```
X (replies)  ──poll 60s──▶  Worker (Node, always on)  ──▶  Postgres (Neon)
                                  │  parse "$25", resolve author,
                                  │  pre-make recipient wallet (Privy API),
                                  │  create intent, post templated reply
                                  ▼
Sender ──link──▶  Web app (Astro on Vercel, Privy React island)
                     /pay/:id   sign in with X → connect/embedded wallet
                                → send USDG on Robinhood Chain to recipient wallet
                                → POST tx hash → server verifies receipt
                     /app       activity, claims, send-by-handle, settings
Recipient ──▶  /claim  sign in with X → wallet already holds the USDG
```

| Part | Choice | Reason |
|---|---|---|
| Site + app | Astro, React island for Privy, same shell as Stockpilot (UI bar per Rulepad `app.css`) | Team already runs this stack; Stockpilot's Privy bridge is reusable |
| Hosting | Vercel (site + API routes via Astro server endpoints) | Same as Stockpilot |
| Worker | One small always-on Node process (Railway or Fly, ~$5/mo) | Vercel crons can't run every minute on Hobby; a bot needs a steady loop |
| Database | Neon Postgres (free tier) | Intents must survive restarts; the worker and the web app share it |
| Auth | Privy: Sign in with X + wallets (external or embedded). API routes verify the Privy access token | No password system, no own OAuth code |
| Settlement | Direct USDG transfer on Robinhood Chain from sender wallet to recipient's Privy wallet, plus a dust ETH transfer for the recipient's gas. No contract | Zero custody by us, nothing to audit, the money is the recipient's from block one |
| Status truth | Chain. Server verifies the `Transfer` log (to = recipient wallet, amount ≥ intent) before marking paid; a reconciler re-checks pending intents | Same rule as Stockpilot: the wallet is the truth |

### Data

| Table | Columns |
|---|---|
| `users` | privy_id, x_id, x_handle, x_name, avatar_url, wallet, created_at, last_login_at |
| `intents` | id (short, unguessable), sender_x_id, sender_handle, recipient_x_id, recipient_handle, recipient_wallet, amount_usd, asset (USDG), chain (4663), status, source (x/site), trigger_tweet_id, parent_tweet_id, bot_reply_id, tx_hash, created_at, paid_at, claimed_at, expires_at |
| `events` | intent_id, kind, detail, at — every status change and every bot reply, for the activity feed and for debugging |

### Intent status

| Status | Meaning | Set by |
|---|---|---|
| `pending` | Bot detected the command; nobody has paid yet | Worker |
| `paid` | USDG confirmed in the recipient's wallet | Web app posts tx → server verifies receipt; reconciler double-checks |
| `claimed` | Recipient has signed in with X at least once since payment | Web app on login |
| `expired` | Unpaid for 24 h (sender never confirmed) | Reconciler |
| `refunded` | Not possible in MVP — direct transfers can't be pulled back. Phase 2 escrow contract adds it | — |

The narrative doc lists "expired" and "refunded" as bot statuses. With direct transfers, "expired" means only "sender never paid". Refunds need an escrow contract (phase 2). Flag to Jack.

---

## 3. Flows (what each person sees)

### A. Send from X

| Step | Who | What happens | Screen / message |
|---|---|---|---|
| 1 | Sender | Replies under any tweet: `@TweetSend $25` | X |
| 2 | Worker (≤60 s) | Reads the mention, parses amount, reads `in_reply_to_user_id` → recipient. Rejects: no amount, amount < $1 or > $500 (open decision C), self-payment, replies to the bot's own posts | — |
| 3 | Worker | If recipient unknown to us: creates Privy user + wallet for that X id. Writes intent `pending` | — |
| 4 | Bot | Replies to the sender's reply: **"Ready — confirm your $25 to @bob at tweetsend.xyz/p/k7f3q"** (open decision B: with link $0.20, without $0.01) | X |
| 5 | Sender | Opens link → `/pay/k7f3q`: recipient card (avatar, @handle), amount, asset, network, "Sign in with X" | Web |
| 6 | Sender | Signs in with X. Must be the same X account that wrote the reply — otherwise "This send belongs to @alice. Sign in as @alice." | Web |
| 7 | Sender | Chooses wallet: connected (MetaMask, Coinbase, Rainbow) or TweetSend balance (embedded). Sees USDG balance. Button: **Send $25** | Web |
| 8 | Sender | Wallet asks to confirm. Page shows "Sending…" then "Sent. @bob can claim it by signing in with X." with Blockscout link | Web |
| 9 | Server | Verifies receipt → `paid` | — |
| 10 | Bot | Replies once more under the sender's reply: **"$25 sent to @bob."** or, if @bob has never signed in: **"$25 is waiting for @bob — claim it by signing in with X at TweetSend."** | X |

### B. Claim

| Step | Who | What happens |
|---|---|---|
| 1 | Recipient | Sees the bot's reply (they're @mentioned, so it's in their notifications). Opens tweetsend.xyz |
| 2 | Recipient | "Sign in with X". Privy matches the X id to the pre-made wallet |
| 3 | Recipient | Lands on `/app/claims`: "$25 from @alice — in your TweetSend wallet" with the balance. Status → `claimed` |
| 4 | Recipient | Can leave it there (it's a real wallet, theirs), send it to another wallet (the ETH drip covers the gas), or send it onward to another handle |

### C. Send from the site (fallback, no tweet)

`/app/send`: handle field with live lookup (avatar + name from X via our worker's cached user lookup, $0.01 per fresh lookup), amount, wallet choice, **Send**. Same intent pipeline, `source = site`, no bot reply.

### D. Activity

`/app`: one list, newest first. Each row: direction (sent/received), counterpart @handle with avatar, amount, status pill, time, Blockscout link. Filters: All · Sent · Received · Pending · Waiting to be claimed.

### E. Settings

`/app/settings`: X account (handle, id, "managed by Privy"), wallets (embedded address + any linked external), default wallet for sending, network/asset (Robinhood Chain · USDG, fixed in MVP), notifications (bot replies on/off — off means no second reply after payment), sign out, export activity CSV.

---

## 4. Screens (app)

Shell: same inset floating header bar as Rulepad/Stockpilot. Left nav: Activity · Send · Claims · Settings. Top right: X avatar + handle, wallet balance in USDG.

| Route | Purpose | Empty state |
|---|---|---|
| `/app` | Activity | "Nothing yet. Reply `@TweetSend $5` under any tweet to send your first payment." with a small tweet mock |
| `/app/send` | Send by handle | Form is the page |
| `/app/claims` | Payments waiting for the signed-in X account | "Nothing waiting for @you." |
| `/app/settings` | Account, wallets, defaults | — |
| `/pay/:id` | Confirmation link from the bot (public URL, requires sign-in to pay) | "This link has expired" / "Already paid" states |
| `/app/login` | Single button: Sign in with X | — |

Every amount is USDG to 2 decimals. Every completed payment shows a tx hash linking to Blockscout. Wallet addresses are shown short with a copy button, never as the primary identity — the @handle is.

---

## 5. Site content (marketing pages)

### Home

- Eyebrow: Payments on X
- H1: **Send crypto directly under a tweet.**
- Sub: No wallet address. No copy-paste. Reply `@TweetSend` and an amount, and the money goes to the person who wrote the tweet.
- CTAs: **Sign in with X** · See how it works
- Hero visual: a real-looking X thread — @bob's tweet, @alice's reply `@TweetSend $25`, the bot's reply "Ready — confirm your $25 to @bob", then "$25 sent to @bob." Built as HTML, animated as a typed sequence (same craft as Stockpilot's composing sheet), never a screenshot.

**How it works** (three steps, in the order they happen)
1. Reply to their tweet — `@TweetSend $25`. That's the whole command.
2. Confirm — the bot answers with a link. Sign in with X, pick a wallet, approve.
3. They claim by being themselves — the recipient signs in with the same X account and the money is already in a wallet that's theirs.

**Why**
- Before: find wallet → copy address → open wallet → paste → check network → send.
- After: reply → `@TweetSend $amount` → confirm.
- "A handle you already know beats an address you can't remember."

**What it is / isn't**
- Not a wallet. Your USDG sits in a wallet you control (Privy embedded or your own).
- Not custody. TweetSend never holds your money; payments go straight to the recipient's wallet on Robinhood Chain.
- Not a guess. The bot pays the author of the tweet you replied to, resolved from X itself.

**Features** (the doc's nine, one line each): X-native · handle-based · automatic recipient · claim before you have an account · self-custodial wallet · verified claim · status replies · USDG on Robinhood Chain today, more later · full history.

**Footer**: Bot by @[company] · Automated account · Docs · Status · X

### /how-it-works
Longer version of the three steps with the exact bot messages, what the sender pays (network fee under a cent on Robinhood Chain), timing (bot answers within a minute), limits (min $1, max $500 per send in MVP — open decision C), and "what if I typo the amount" (nothing happens until you confirm on the site).

### /docs
Command grammar: `@TweetSend $25`, `@TweetSend 25`, `@TweetSend $25.50`. Ignored: anything without a number, amounts outside limits, replies to the bot itself. One send per reply.

### Bot messages (fixed strings, never generated)

| When | Text |
|---|---|
| Command detected | Ready — confirm your $25 to @bob: tweetsend.xyz/p/k7f3q |
| Paid, recipient has an account | $25 sent to @bob. |
| Paid, recipient has never signed in | $25 is waiting for @bob. Claim it by signing in with X at TweetSend. |
| No amount found | Tell me how much: reply with @TweetSend and an amount, like $10. |
| Over limit | Sends are $1–$500 for now. |
| Unpaid after 24 h | (no reply; link page shows "expired") |

---

## 6. Build order and verification

Jack's rule from Stockpilot applies: we test it ourselves, end to end, before he sees it.

| Week | Work | Proof it works |
|---|---|---|
| 1 — spikes | 1. X developer account on pay-per-use, bot account with Automated label, bio, managing account. 2. Privy app: X login on, own X credentials. 3. **Spike #1:** create a pre-made Privy user with a test X id, then sign in with that X account → same wallet appears. 4. **Spike #2:** poll mentions from a test account, confirm `in_reply_to_user_id` + expansion spelling. 5. **Spike #3:** USDG + dust-ETH transfer on Robinhood testnet 46630 from an external wallet to a pre-made wallet, then a transfer out paid by that drip | Each spike is a script in the repo with its real output pasted into `SPIKES.md` — wallet address, tx hashes on Blockscout, the raw X API response |
| 2 — app + site | Astro project, Privy bridge (from Stockpilot), DB schema, API routes, `/pay/:id`, `/app/*`, home + how-it-works + docs | `astro check` 0 errors; every route screenshot-verified in a real browser |
| 3 — worker + e2e | Poller, parser, intent creation, bot replies, receipt verification, reconciler, expiry | **E2E with two X accounts we control:** account A replies under account B's tweet, bot answers, A pays 1 USDG, B signs in and sees it, B sends it out. Tx hashes + screenshots in `E2E.md` |
| 4 — hardening | Rate-limit handling, credits alarm (X credits can go negative and block the API), duplicate-mention guard, idempotent intents, abuse limits (per-account daily cap), monitoring, then Jack's test | Repeat the E2E on the live domain |

### Running cost (MVP)

| Item | Cost |
|---|---|
| X pay-per-use | ~$0.001 per mention read + $0.01–0.20 per reply. 1,000 sends/month ≈ $2–$420 depending on decision B |
| Privy | $0 to 500 MAU |
| Vercel | existing plan |
| Neon Postgres | $0 |
| Worker (Railway/Fly) | ~$5/mo |
| Gas sponsorship credits (Privy) | prepaid; not available on Robinhood mainnet — see B2 |

---

## 7. Decisions Jack has to make

| # | Decision | Recommendation |
|---|---|---|
| A | Chain + asset | **Robinhood Chain 4663 + USDG** — fixed by client rule (13 Sep 2026). Every recipient wallet needs a small ETH drip to move funds; see B2 |
| B2 | Who pays the recipient's gas drip (≈ $0.50 in ETH) | Sender, bundled into the send (two transfers in one confirmation: USDG + dust ETH) |
| B | Bot reply with the pay link ($0.20 each) or without ($0.01; sender opens tweetsend.xyz and finds the send waiting under "Pending") | **With link** for MVP — the UX is the product. Revisit at volume |
| C | Limits | $1 min, $500 max per send, $2,000/day per sender for launch |
| D | Bot handle | Check `@TweetSend` availability on X now; fallback `@TweetSendApp` / `@tweetsend_pay`. Domain: tweetsend.xyz? |
| E | Refunds | Not in MVP (direct transfers). Phase 2: escrow contract with 7-day refund |
| F | Who runs the bot account | Needs a human "managing account" on X for the Automated label — Jack's or the company's |
| G | Fees | None in MVP. Later: flat $0.10 or 1%? |

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Privy `subject` ≠ X numeric id | Pre-made wallets never attach to the right person | Spike #1 in week 1, before anything else |
| X suspends the bot account or app | Product stops | Automated label, templated replies, reply only when summoned, regular-but-jittered polling, human managing account, no AI text |
| X field renames (`referenced_tweets` → `referenced_posts`) | Parser breaks | Use `in_reply_to_user_id`; test both spellings; pin to a live response saved in the repo |
| Sender pays the wrong intent / double pays | Money to the wrong wallet | `/pay/:id` locks to the sender's X id and shows the recipient's avatar + handle before the wallet prompt; intent is single-use |
| Recipient loses X account | Loses wallet access (Privy's own warning) | Settings prompts to link an external wallet after first claim |
| Credits run out | Bot goes silent | Auto-recharge + alert at 20% |
