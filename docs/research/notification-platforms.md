# Notification orchestration platform vs. building on Postmark

Research for [issue #2](https://github.com/jannes-bantje/cohort-005-project-fork/issues/2). Gathered 2026-11-14.

**Question.** Should Cadence's Notifications (in-app and email, to Students, Instructors, Platform Admins and Team Admins) run on a notification orchestration platform, or be built in-house on the existing Postmark integration (`app/lib/mailer.server.ts`)?

This file gives facts and trade-offs only. The choice is made on the map.

## How this was sourced

- **Knock** and **Novu** keep their documentation in public GitHub repos ([knocklabs/docs](https://github.com/knocklabs/docs), [novuhq/docs](https://github.com/novuhq/docs)). Those were read directly at `main` on 2026-11-14 and are cited by file path.
- **Courier, MagicBell, Postmark, SuprSend**, and all **pricing pages**, could not be fetched directly: the sandbox firewall blocks those domains. Their facts come from web searches restricted to each vendor's own domain, which quote the official page. These are marked **(search-quoted)**. Before relying on any price, check the live pricing page.
- Where a vendor's docs and its marketing pages disagree, that's noted.

## What Cadence has today

- `app/lib/mailer.server.ts` sends plain-text email through Postmark's `POST /email` API on the `outbound` (transactional) Message Stream from `Cadence <hello@cadence.dev>`. Without `POSTMARK_SERVER_TOKEN` it writes each email to `.outbox/` as JSON. It has no HTML body, custom headers, templates, or unsubscribe handling. Today its only callers are the refund flows (`courses.$slug.refund.ts`, `admin.refunds.tsx`).
- ADR 0006: everything lives in one SQLite file through Drizzle and `better-sqlite3`. It's synchronous, a single server process, and one writer. The app can't run on more than one machine.
- React Router 8 with SSR on (`react-router.config.ts`: `ssr: true`).
- There's no job runner, queue, or scheduler.
- Glossary: a **Notification** is shown in-app, by email, or both. Purchase and refund receipts are *not* Notifications. A **Nudge** is a Notification about something a Student *hasn't* done.

## Comparison at a glance

| Axis | Knock | Novu | Courier | MagicBell | In-house on Postmark |
|---|---|---|---|---|---|
| In-app feed, prebuilt React | Yes: `@knocklabs/react` feed, popover and inbox components | Yes: `@novu/react` `<Inbox />` with Bell, Notifications and Preferences parts | Yes: `@trycourier/courier-react` `<CourierInbox />`, popup and toasts (search-quoted) | Yes: React `Inbox` / `FloatingInbox` (search-quoted) | Build it (shadcn/Radix already in repo) |
| Real-time | Managed WebSocket service | Real-time (WebSocket `ws` service when self-hosted) | WebSocket after `listenForUpdates()` (search-quoted) | WebSocket (search-quoted) | SSE resource route or revalidation polling. A single process makes in-memory fan-out simple |
| Per-person preferences | Yes. Hosted preference center (no code), React preferences component, custom center | Yes. Workflow, per-workflow channel and global prefs; `<Preferences />`; "critical" workflows bypass | Yes. Hosted preference page, `<CourierPreferences />`, topics, REQUIRED topics (search-quoted) | Yes. Categories × channels (search-quoted) | Build: table plus settings page |
| Email unsubscribe | Built in for workflows marked "Commercial": adds headers and an unsubscribe URL | None by default. Add a `{{payload.unsubscribeEmail}}` link or your own link via the prefs API (search-quoted) | Topic unsubscribe link. Auto one-click headers **only with SendGrid**; with Postmark, you set them yourself (search-quoted) | Not verified | Build: signed link plus `List-Unsubscribe` headers via Postmark `Headers`, or use a Postmark Broadcast stream |
| Batching / digests | Batch step: window, batch key, render limit 10 items below Enterprise | Digest step: regular or scheduled. Max window 1 d Free / 7 d Pro / 30 d Team | Batch node (inactivity, max count, max wait) and scheduled digests (search-quoted) | No documented digest feature found | Build: a scheduler (none exists today) |
| Web push (browser) | Via FCM (web) or OneSignal | Via FCM, OneSignal, Pushpad, push webhook | Via OneSignal or FCM. "Courier Push" is in-app WebSocket only (search-quoted) | Native web push with VAPID keys (search-quoted) | Build: `web-push` + VAPID + service worker + subscriptions table |
| Bring your own Postmark | Yes. Postmark channel with your API key, delivery webhooks, per-environment | Yes. Postmark provider with your server token | Yes. Postmark integration with your token, MessageStream override (search-quoted) | **Unclear.** Docs list SES, Mailgun, SMTP, SendGrid only; marketing says Postmark (search-quoted) | Already in place |
| Billing unit | Message = 1 recipient × 1 channel (in-app + email = 2) | Workflow run (subscribers not billed) | Send = 1 recipient, any number of channels in one Send API call; journeys bill per Send node (search-quoted) | Delivery = per channel (search-quoted) | Postmark emails only |
| Self-host / open source | No. SaaS only (no self-host option found) | Yes. MIT core plus proprietary `enterprise/` packages; Community self-host via Docker | Enterprise only: "your own infrastructure or private cloud" (search-quoted) | No | n/a, it's ours |
| Fit with SSR + SQLite | Client-side components; sync users to Knock; signed user token in prod | No Remix quickstart (Remix ≈ React Router); HMAC `subscriberHash` in prod | Client-side components; JWT auth (search-quoted) | Client-side components | Native: same Drizzle schema, sync reads in loaders |

## Pricing (all checked 2026-11-14; verify on the live pages)

| Vendor | Free tier | First paid tier | Overage | Source |
|---|---|---|---|---|
| Knock | 10,000 messages/mo ("Free", formerly "Developer") | Starter **$250/mo**, 50,000 messages | $0.005/message | knock.app/pricing, knock.app/ai-instructions (search-quoted); plan gating from `knocklabs/docs` `content/manage-your-account/knock-plans.mdx` |
| Novu | 10,000 workflow runs/mo | Pro **$30/mo**, 30,000 runs; Team **$250/mo**, 250,000 runs | 2025 Pro launch said $0.0012/extra event; no current figure found | novu.co/pricing, docs.novu.co billing, Novu Pro changelog (search-quoted) |
| Courier | Developer: 10,000 sends/mo | Business: pay-as-you-go, no platform fee | $0.005/send, any channel | courier.com/pricing (search-quoted) |
| MagicBell | Builder: 1,000 deliveries/mo | Startup **$249/mo**, 50,000 deliveries | $0.0025/delivery | magicbell.com/pricing (search-quoted) |
| SuprSend (other contender) | 10,000 notifications/mo, branded feed | Essentials $100/mo; Business $250/mo, 50k (digest and preferences are **Business only**) | $2 / $5 per 1,000 | suprsend.com/pricing (search-quoted; page metadata ~2 years old, blog posts cite $110/$275) |
| Postmark (email for every option except possibly MagicBell) | 100 emails/mo | Basic **$15/mo**, 10,000 emails; 50,000 for $55; 125,000 for $115 | $1.80 / 1,000 on Basic at 10k | postmarkapp.com/pricing (search-quoted) |

### What gates on plan (facts that change the price)

- **Knock** (`knock-plans.mdx`): most features are on every plan. Enterprise-only: per-tenant preferences and branding, translations (i18n), **batch render limit above 10 items**, SAML SSO. Log retention: 30 days, or 90 days on Enterprise (`data-retention.mdx`). EU data residency is "expected by the end of 2026".
- **Novu** (`content/docs/platform/developer/limits.mdx`):

  | Limit | Free | Pro | Team |
  |---|---|---|---|
  | Digest/delay duration | 1 day | 7 days | 30 days |
  | Inbox feed retention | 30 days | 90 days | 90 days |
  | Activity feed retention | 1 day | 7 days | 90 days |
  | Workflows | 20 | 20 | 100 |
  | Team members | 3 | 3 | custom |

  Novu branding is removed only on paid plans. A **weekly digest needs Pro or above**.
- **Courier** (search-quoted): Business adds EU data residency. Test, undeliverable and preference-blocked sends are still billable.
- **MagicBell** (search-quoted): each channel is a delivery. Notifying 100 users in-app and 50 by email is 150 deliveries.

### Illustrative monthly cost

These are assumptions, not data. Each Student gets 8 Notifications a month, every Notification goes in-app **and** by email, and there's one trigger per recipient. Instructors and admins add little volume. Knock and MagicBell bill both channels (2 units per Notification). Courier bills 1 unit if sent as one multi-channel Send API call. Novu bills 1 run. Postmark email is extra for every platform option and for in-house.

| Active Students | Notifications | Knock | Novu | Courier | MagicBell | Postmark (email) |
|---|---|---|---|---|---|---|
| 1,000 | 8k | $250 (16k msgs > free 10k) | $0 (Free; 1-day digest cap) | $0 (Developer) | $249 (16k deliveries) | $15 |
| 5,000 | 40k | ~$400 (80k msgs) | $30 + overage, or $250 Team | ~$200 | ~$324 (80k deliveries) | $55 |
| 20,000 | 160k | ~$1,600 (320k msgs) | $250 (Team) | ~$800 | ~$924 (320k deliveries) | $115 + overage |

The in-house option pays only the Postmark column, plus engineering time.

## Per-option facts worth knowing

### Knock (`knocklabs/docs`)
- Postmark is a first-class email channel: API key, From address, delivery-status webhook, sandbox mode, per-environment config (`content/integrations/email/postmark.mdx`).
- The in-app feed is a managed real-time WebSocket service. React, React Native, iOS and Android SDKs ship prebuilt feed components (`content/in-app-ui/feeds/overview.mdx`).
- Production should enable "enhanced security mode": the client sends a **signed user token** that our server mints (`content/in-app-ui/security-and-authentication.mdx`).
- Batch step: a batch window per recipient, an optional batch key, and later triggers fold into the open batch as `activities` (`content/designing-workflows/batch-function.mdx`).
- The hosted preference center needs no code, but covers user default preferences only (`content/preferences/hosted-preference-center.mdx`).
- Commercial unsubscribe: mark a workflow "Commercial", and Knock adds unsubscribe headers and an unsubscribe URL variable (`content/preferences/commercial-unsubscribe.mdx`).
- Web push goes through FCM's web SDK token stored as channel data (`content/integrations/push/firebase.mdx`). The push overview is mobile-first (`content/integrations/push/overview.mdx`).

### Novu (`novuhq/docs`, `novuhq/novu`)
- Licence: `LICENSE-MIT` covers everything outside `enterprise/packages`, which is under a proprietary licence (`LICENSE-ENTERPRISE` in `novuhq/novu`).
- Community self-host (`content/docs/community/self-hosted-and-novu-cloud.mdx`): Email, In-app, Push and Digest channels, and the Inbox and Preferences components, all ✅. These are **not** included: more than 2 environments, built-in auth/SSO/RBAC, **max 1 team member**, removing Novu branding, Snooze, SOC 2/HIPAA.
- The self-host deployment runs six containers via Docker Compose: `redis`, `mongodb` (`mongo:8.0.17`), `api`, `worker`, `ws` and `dashboard` (Novu images at `3.19.0`), plus S3-compatible storage (localstack in the guide). Sources: `novuhq/novu` `docker/community/docker-compose.yml`; `content/docs/community/self-hosting-novu/deploy-with-docker.mdx`. That's two more data stores next to Cadence's single SQLite file, which ADR 0006 deliberately avoids.
- Postmark provider uses your server API token (`content/docs/platform/integrations/email/(providers)/postmark.mdx`).
- Preferences: workflow channel preferences, per-workflow subscriber preferences, global preferences, and "critical" workflows that ignore opt-outs (`content/docs/platform/concepts/preferences.mdx`).
- Inbox security in production: HMAC `subscriberHash` computed server-side (`content/docs/platform/inbox/prepare-for-production.mdx`).
- Has a Remix quickstart using `@novu/react` (`content/docs/platform/quickstart/remix.mdx`). Remix is now React Router, so that's the closest framework guide of any vendor.

### Courier (search-quoted from courier.com)
- Billing is per send attempt. One unit covers one recipient across several channels **if** they're in one `to` entry. Listing channels as separate entries bills each. In Journeys, each Send node is one channel, so in-app + email = 2 sends.
- One-click unsubscribe headers are emitted automatically **only for SendGrid**. With Postmark, Cadence would have to set them itself.
- Legacy Automations are being replaced by Journeys. The batch and digest docs straddle both.

### MagicBell (search-quoted from magicbell.com)
- The strongest native **web push** story (VAPID, no FCM/OneSignal needed).
- **Postmark isn't in the documented email channel list** (SES, Mailgun, SMTP, SendGrid). Marketing pages claim it. Unconfirmed.
- No documented digest/batching feature found.
- The free tier is small (1,000 deliveries).

### Postmark facts that matter for in-house *and* for every platform (search-quoted from postmarkapp.com)
- **Streams.** Transactional streams are for one-off, user-triggered email. Bulk/broadcast mail must go on a **Broadcast stream**, and sending it on transactional "can cause issues with deliverability".
- **Broadcast streams** require an unsubscribe link: Postmark appends one if missing and manages suppressions. Unsubscribes are **per stream**, so a Student who unsubscribes from broadcasts still gets transactional mail.
- **Transactional streams** don't require unsubscribe. Custom `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers go in the API's `Headers` array. If Postmark manages unsubscribes, you can't edit those headers.
- **Implication for Cadence.** Whether Nudges and digest emails count as transactional or broadcast mail decides which stream they go on, and therefore who owns unsubscribe. That question is the same whichever option is chosen, because every option except possibly MagicBell sends through Cadence's Postmark account.

## What building in-house would take (same feature set)

Each piece below is a fact about what's missing today, not an estimate.

1. **Schema** (Drizzle, `app/db/schema.ts`): `notifications` (recipient, type, payload, read/seen/archived timestamps), `notification_preferences` (user × notification type × channel), and later `push_subscriptions` and a `pending_digest_items` / job table. That means migrations and seeds (the `database-migrations` skill).
2. **Send pipeline**: one `notify(recipient, type, data)` that checks preferences, writes the in-app row, and calls `sendEmail`. `mailer.server.ts` needs HTML bodies, custom `Headers` (List-Unsubscribe), and probably a second Postmark stream.
3. **In-app feed UI**: a bell, popover, list, mark-read and mark-all-read, built with the existing Radix/shadcn kit. Server-rendered from loaders with sync SQLite reads.
4. **Real-time**: an SSE resource route with an in-process emitter (possible *because* ADR 0006 pins a single process), or just revalidation/polling.
5. **Preferences page and unsubscribe**: a settings route, signed one-click unsubscribe tokens, a `POST` endpoint for RFC 8058 one-click, and Postmark bounce/spam webhooks so we stop mailing suppressed addresses.
6. **Batching/digests and Nudges**: Cadence has **no scheduler**. Digests and Nudges both need something that runs on a timer: an in-process interval, cron hitting a route, or a SQLite-backed job table. Nudges fire on the *absence* of an event, so this need doesn't fully go away with a platform. Platforms offer delay + condition/cancel steps, but Cadence still has to send the triggers.
7. **Web push** (if wanted): VAPID keys, a service worker, a subscriptions table, the `web-push` npm package, and expired-endpoint cleanup.
8. **Templates, testing, observability**: platforms ship template editors, preview, per-message logs and delivery status. In-house, the `.outbox/` transport covers tests, but there are no logs or delivery tracking beyond Postmark's own dashboard.

## Trade-offs to weigh on the map

- **Data location.** Any platform becomes a second store of recipients, preferences and the in-app feed, outside `data.db`. Users must be synced to it. Reading preferences becomes an async network call, unlike the sync `better-sqlite3` reads ADR 0006 values. In-house keeps one store.
- **Self-hosting doesn't preserve the single-file model.** Novu Community needs MongoDB and Redis (plus S3-compatible storage) and is limited to 1 team member.
- **Cost shape.** Knock and MagicBell bill in-app and email separately, so a "both channels" Notification costs 2 units. Novu and Courier (single Send call) bill per recipient. Knock and MagicBell jump from $0 to ~$250 once free volume runs out. Novu has a $30 step.
- **Digest windows cost money on Novu** (weekly digest needs Pro). On Knock, digests showing more than 10 items need Enterprise.
- **Unsubscribe automation with Postmark** is best on Knock (Commercial workflows). Courier's automatic headers are SendGrid-only. Novu leaves it to us.
- **Web push.** MagicBell is native. The others route through FCM or OneSignal, which is one more vendor account.
- **What a platform still doesn't remove:** triggering from Cadence's own events, deciding Nudge conditions, Postmark stream classification, and auth glue (signed token or HMAC minted in a loader).

## Open questions for a human

1. Expected volume: active Students per month and Notifications per Student. The table above uses guesses, and the cost ranking flips with volume.
2. Are Nudges and digests transactional or broadcast mail under Postmark's rules? This decides stream and unsubscribe ownership in every option.
3. Is web push in scope for v1? If not, MagicBell's main advantage disappears.
4. Is a second data store outside `data.db` (vendor SaaS or self-hosted Mongo/Redis) acceptable given ADR 0006?
5. Is EU data residency needed? Courier Business offers it now. Knock says by end of 2026. Novu Cloud and MagicBell weren't checked.
