const dotenv = require('dotenv');

dotenv.config();

const required = ['MONGODB_URI', 'SESSION_SECRET'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

if (process.env.NODE_ENV === 'production') {
  const productionRequired = ['BOT_TOKEN', 'BOT_USERNAME', 'WEB_APP_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'TELEGRAM_WEBHOOK_SECRET'];
  const missingProduction = productionRequired.filter((name) => !process.env[name]);
  if (missingProduction.length) {
    throw new Error(`Missing required production environment variables: ${missingProduction.join(', ')}`);
  }
  if ((process.env.SESSION_SECRET || '').length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET || '')) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must contain only letters, numbers, underscores, and hyphens.');
  }
}

const positiveNumber = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

module.exports = Object.freeze({
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI,
  botToken: process.env.BOT_TOKEN || '',
  botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, ''),
  webAppUrl: process.env.WEB_APP_URL || 'http://localhost:5000',
  videoEmbedServerUrl: process.env.VIDEO_EMBED_SERVER_URL || '',
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  botWebhookPath: process.env.BOT_WEBHOOK_PATH || '/telegram/webhook',
  minWithdrawAmount: positiveNumber('MIN_WITHDRAW_AMOUNT', 100),
  dailyVideoLimit: positiveNumber('DAILY_VIDEO_LIMIT', 50),
  requiredReferrals: positiveNumber('WITHDRAW_REQUIRED_REFERRALS', 0),
  requiredUnlocks: positiveNumber('WITHDRAW_REQUIRED_UNLOCKS', 0),
  requiredTasks: positiveNumber('WITHDRAW_REQUIRED_TASKS', 0),
  taskCompletionDelaySeconds: positiveNumber('TASK_COMPLETION_DELAY_SECONDS', 15),
  isProduction: process.env.NODE_ENV === 'production'
});
