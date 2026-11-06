# Arohi Mim Viral Link

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

Generate the admin password hash in an interactive terminal:

```powershell
npm run create-admin-hash
```

Paste the printed bcrypt hash into `ADMIN_PASSWORD_HASH` and configure `ADMIN_USERNAME`. Do not put an unhashed admin password in `.env`.

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

`npm start` starts the production server. The seed command idempotently inserts twenty generic starter content records using `seedKey`; the referenced prompt did not include its promised JSON array, so these are clearly named placeholders, not user-provided content. Replace or extend `starterContents` in `scripts/seedContents.js` with the intended records. Existing seeded rows are preserved by `$setOnInsert`.

## Admin

- Open `/admin/login`.
- Admin access uses the configured username and bcrypt password hash, an HTTP-only session cookie, Mongo-backed session storage, and rate-limited login.
- Admin state-changing forms require a session CSRF token. User sessions are created only after Telegram WebApp verification.
- Manage links, task definitions, user balances and suspension, task reviews, withdrawals, broadcasts and the home banner from the dashboard.

## Deployment and security

- Use HTTPS, a managed MongoDB deployment, a unique secret per environment, and production `NODE_ENV`.
- Restrict database network access and rotate bot/session/webhook secrets if exposed.
- Configure MongoDB backups and monitor application and delivery logs.
- Use a MongoDB replica set for atomic financial operations and test backup/restore procedures before launch.
- Withdrawal requests reserve funds immediately; rejecting a request releases the reserved amount. Approvals do not debit the user's balance a second time.
- Task submissions are pending until an administrator approves them; this avoids trusting client-side claims for external partner actions. Verification codes are checked server-side.
- Broadcast delivery is rate-paced and records each send result. Failed sends are retained in the delivery log for admin review.
- Configure `VIDEO_EMBED_SERVER_URL` only to a trusted embed service and use HTTPS.
- All monetary actions and task/referral/withdrawal changes are recorded in `activityLogs`.

## Configuration

See `.env.example` for supported environment variables. `MIN_WITHDRAW_AMOUNT`, `DAILY_VIDEO_LIMIT`, and the optional `WITHDRAW_REQUIRED_*` values are validated at startup. The Telegram theme is preferred in the Mini App; outside Telegram, the browser's `prefers-color-scheme` controls the theme. Font Awesome is served locally from the installed package.

## Notes

The shared brief referenced screenshots and a 20-item JSON array, but neither was included with the attached text. The implementation therefore follows the written design description and uses placeholder seed entries until the source data is supplied.
