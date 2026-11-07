# LinkHub

A server-rendered Telegram Mini App for viral content, tasks, referrals, rewards, withdrawals and admin-managed broadcasts. The app uses Express, EJS, MongoDB/Mongoose and Telegraf; it does not use a client-side framework.

## Requirements

- Node.js 20+
- MongoDB configured as a replica set (required for atomic financial operations)
- A Telegram bot created with BotFather
- HTTPS and a public URL for production Mini App and webhook use

## Install

```powershell
npm install
Copy-Item .env.example .env
```

Set `MONGODB_URI`, `SESSION_SECRET`, bot settings and admin settings in `.env`. Keep `.env` private; it is ignored by Git. For local MongoDB, start `mongod` with `--replSet rs0`, then run `rs.initiate()` once in `mongosh`; the example URI expects that replica set. Generate a long random session secret, for example with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` in `.env` or Render's environment settings. Despite the legacy variable name, the value may be a plain-text password. A bcrypt hash is also accepted; generate one in an interactive terminal if preferred:

```powershell
npm run create-admin-hash
```

For better security, use a unique, strong password and keep all credentials private. The login endpoint is rate-limited.

## Telegram setup

1. Create a bot with BotFather and set `BOT_TOKEN` and `BOT_USERNAME`.
2. Set `WEB_APP_URL` to the HTTPS Mini App URL.
3. Configure the bot's Mini App/menu button in BotFather to open that URL.
4. For local development, run the app and expose it with an HTTPS tunnel; set `WEB_APP_URL` to its public HTTPS URL. The bot uses long polling outside production.
5. In production, set `NODE_ENV=production` and a long random `TELEGRAM_WEBHOOK_SECRET`. The app registers the webhook at `BOT_WEBHOOK_PATH/<secret>` and verifies Telegram `initData` on the server before creating a user session.

Telegram user fields are only accepted from valid, unexpired `initData`. A regular browser can view the landing page but cannot authenticate as a Telegram user.

## Run and seed

```powershell
npm run dev
npm run seed
```

`npm start` starts the production server. `npm run seed` inserts or updates the twenty LinkHub content records in `scripts/seedContents.js`, keyed by `seedKey`, and can be safely rerun. Seeded records include their title, image/video URL, date, and view count.

## Admin

- Open `/admin/login`.
- Admin access uses the configured username and password, an HTTP-only session cookie, Mongo-backed session storage, and rate-limited login.
- Admin state-changing forms require a session CSRF token. User sessions are created only after Telegram WebApp verification.
- Manage links, task definitions, user balances and suspension, task reviews, withdrawals, broadcasts and the home banner from the dashboard.
- Set up to five per-content task destinations from **Content task links**. Blank fields use the configured default link. Users can start and claim each task, and the task count is saved per user and content.
- Import titles, images and videos directly from the p9x9 catalog on **Viral links**. The searchable picker fills the add-content form and shows an image/video preview before saving. The catalog is cached in-process for 10 minutes (with stale-data fallback), so repeated searches do not keep loading the upstream server.
- A per-content task can only be claimed after its server-recorded 60-second start delay. The countdown survives reloads; the server rejects early claim attempts.
- Configure multiple rotating video reward destinations from **Video reward links**. Users can claim ৳20 after the 60-second countdown; an empty list uses the default destination.
- The user Mini App uses client-side navigation for internal pages, so opening a content card or switching user sections does not reload the document.
- Home and paginated content lists use a bounded, 10-second in-process cache. User task/unlock progress is always loaded separately, and admin content changes clear the cache.
- First-party analytics are available at **Admin → Analytics**: app opens, unique visitors, page views, session and page time, daily trends, top content, and per-user page engagement. The Mini App sends page events and visible-time updates; reports stream to the admin dashboard over Server-Sent Events and refresh every 15 seconds. Analytics are retained for 180 days. Content URLs are normalized to page paths; content references are stored internally for reporting. Analytics do not store IP addresses, device fingerprints, or query strings. Users can review the collection and retention details at `/privacy`.
- Content unlocks remain available for one hour, after which all five tasks must be completed again. The home feed initially shows 20 newest links and loads more as the user scrolls.
- Each new content unlock credits ৳50 atomically. Use the **Leaderboard** tab to see lifetime top income or referral rankings.
- Withdrawals require 10 referrals, 15 completed tasks, and 20 distinct content unlocks. The server enforces all three thresholds.

## Deployment and security

- Use HTTPS, a managed MongoDB deployment, a unique secret per environment, and production `NODE_ENV`.
- On Render, create a **Web Service** from this repository and select **Docker** as the runtime. Render supplies `PORT`; the app listens on that port automatically. Set the required environment variables listed in `.env.example` in the Render dashboard and set `WEB_APP_URL` to the final HTTPS Render URL. `VIDEO_EMBED_SERVER_URL` is optional; if omitted, the app still starts but unlocked videos are not embedded. Never upload `.env`.
- Use a MongoDB replica-set connection string that allows connections from Render. After deployment, configure the Telegram bot's Mini App URL to match `WEB_APP_URL`.
- Restrict database network access and rotate bot/session/webhook secrets if exposed.
- Configure MongoDB backups and monitor application and delivery logs.
- Use a MongoDB replica set for atomic financial operations and test backup/restore procedures before launch.
- Withdrawal requests reserve funds immediately; rejecting a request releases the reserved amount. Approvals do not debit the user's balance a second time.
- Task submissions are pending until an administrator approves them; this avoids trusting client-side claims for external partner actions. Verification codes are checked server-side.
- Broadcast delivery is rate-paced and records each send result. Failed sends are retained in the delivery log for admin review.
- If configured, set `VIDEO_EMBED_SERVER_URL` only to a trusted embed service and use HTTPS. Leaving it unset disables embedded videos without preventing startup.
- All monetary actions and task/referral/withdrawal changes are recorded in `activityLogs`.

## Configuration

See `.env.example` for supported environment variables. `MIN_WITHDRAW_AMOUNT` and `DAILY_VIDEO_LIMIT` are validated at startup. Withdrawal thresholds are fixed at 10 referrals, 15 completed tasks, and 20 distinct content unlocks. The Telegram theme is preferred in the Mini App; outside Telegram, the browser's `prefers-color-scheme` controls the theme. Font Awesome is served locally from the installed package.

## Notes

The starter content entries use the URLs and sample video IDs provided for the project. Replace sample video URLs with real content links before publishing them to users.
