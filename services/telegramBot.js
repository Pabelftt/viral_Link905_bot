const { Telegraf, Markup } = require('telegraf');
const env = require('../config/env');
const crypto = require('crypto');

const bot = env.botToken ? new Telegraf(env.botToken) : null;

if (bot) {
  bot.start(async (ctx) => {
    const startParam = ctx.startPayload || '';
    const webAppUrl = new URL(env.webAppUrl);
    if (/^ref_\d{1,20}$/.test(startParam)) webAppUrl.searchParams.set('startapp', startParam);
    await ctx.reply('Open LinkHub to explore content and rewards.', Markup.inlineKeyboard([
      Markup.button.webApp('Open Mini App', webAppUrl.toString())
    ]));
  });
  bot.catch((error) => console.error('Telegram bot error:', error));
}

async function launchBot(app) {
  if (!bot) {
    console.warn('Telegram bot is disabled because BOT_TOKEN is not configured.');
    return;
  }
  if (env.isProduction) {
    const webhookPath = `${env.botWebhookPath}/${env.telegramWebhookSecret}`;
    await bot.telegram.setWebhook(`${env.webAppUrl.replace(/\/$/, '')}${webhookPath}`, { secret_token: env.telegramWebhookSecret });
  } else {
    await bot.launch();
  }
  const Broadcast = require('../models/Broadcast');
  const { processBroadcast } = require('./broadcastService');
  const queued = await Broadcast.find({ status: 'queued' }).select('_id').lean();
  for (const broadcast of queued) {
    processBroadcast(broadcast._id).catch((error) => console.error('Unable to resume broadcast:', error));
  }
}

function registerWebhookRoute(app) {
  if (!env.isProduction || !bot) return;
  const webhookPath = `${env.botWebhookPath}/${env.telegramWebhookSecret}`;
  app.post(webhookPath, async (req, res, next) => {
    try {
      const supplied = req.get('x-telegram-bot-api-secret-token') || '';
      const expected = env.telegramWebhookSecret;
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return res.sendStatus(401);
      }
      await bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { bot, launchBot, registerWebhookRoute };
