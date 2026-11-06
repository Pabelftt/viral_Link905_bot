const Broadcast = require('../models/Broadcast');
const BroadcastDelivery = require('../models/BroadcastDelivery');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const Referral = require('../models/Referral');
const { bot } = require('./telegramBot');

async function createBroadcast({ title, body, imageUrl, buttonText, buttonUrl, relatedContentId, relatedTaskId, recipientFilter, recipientMode, recipientSearch, recipientIds, excludedRecipientIds }) {
  const manualSelection = recipientMode !== 'filter';
  if (manualSelection && (!Array.isArray(recipientIds) || recipientIds.length === 0)) {
    throw Object.assign(new Error('Select at least one recipient.'), { status: 400 });
  }
  const filter = recipientFilter || 'all';
  if (!['all', 'active', 'balance', 'pending', 'referrals', 'non-suspended'].includes(filter)) {
    throw Object.assign(new Error('Choose a valid recipient filter.'), { status: 400 });
  }
  const query = { isSuspended: false };
  if (manualSelection) query._id = { $in: [...new Set(recipientIds.map(String))] };
  if (filter === 'active') {
    query.isActive = true;
    query.lastActiveAt = { $gte: new Date(Date.now() - 30 * 86400000) };
  } else if (filter === 'balance') query.balance = { $gt: 0 };
  else if (filter === 'pending' || filter === 'referrals') {
    const filterIds = await (filter === 'pending' ? Withdrawal.distinct('userId', { status: 'pending' }) : Referral.distinct('referrerId'));
    const currentIds = query._id?.$in;
    query._id = { $in: currentIds ? currentIds.filter((id) => filterIds.some((filterId) => String(filterId) === String(id))) : filterIds };
  }
  if (recipientMode === 'filter' && Array.isArray(excludedRecipientIds) && excludedRecipientIds.length) {
    query._id = { ...(query._id || {}), $nin: [...new Set(excludedRecipientIds)] };
  }
  if (recipientSearch) {
    const safeSearch = recipientSearch.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = ['firstName', 'lastName', 'username', 'telegramId'].map((field) => ({ [field]: { $regex: safeSearch, $options: 'i' } }));
  }
  const count = await User.countDocuments(query);
  if (!count) throw Object.assign(new Error('The selected filter has no eligible recipients.'), { status: 400 });
  if (!bot) throw Object.assign(new Error('Telegram bot is not configured.'), { status: 503 });

  const broadcast = await Broadcast.create({
    title, body, imageUrl, buttonText, buttonUrl, relatedContentId: relatedContentId || null, relatedTaskId: relatedTaskId || null,
    recipientFilter: filter, pendingCount: 0, status: 'queued'
  });
  try {
    let batch = [];
    for await (const user of User.find(query).select('_id telegramId').lean().cursor({ batchSize: 500 })) {
      batch.push({ broadcastId: broadcast._id, userId: user._id, telegramId: user.telegramId });
      if (batch.length === 500) {
        await BroadcastDelivery.insertMany(batch);
        await Broadcast.updateOne({ _id: broadcast._id }, { $inc: { pendingCount: batch.length } });
        batch = [];
      }
    }
    if (batch.length) {
      await BroadcastDelivery.insertMany(batch);
      await Broadcast.updateOne({ _id: broadcast._id }, { $inc: { pendingCount: batch.length } });
    }
  } catch (error) {
    await BroadcastDelivery.deleteMany({ broadcastId: broadcast._id });
    await Broadcast.deleteOne({ _id: broadcast._id });
    throw error;
  }
  processBroadcast(broadcast._id).catch((error) => console.error('Broadcast processing failed:', error));
  return { broadcast, recipientCount: count };
}

async function processBroadcast(id) {
  const broadcast = await Broadcast.findOneAndUpdate({ _id: id, status: 'queued' }, { $set: { status: 'sending' } }, { new: true });
  if (!broadcast) return;
  for await (const delivery of BroadcastDelivery.find({ broadcastId: id, status: 'pending' }).cursor({ batchSize: 200 })) {
    try {
      const options = {};
      if (broadcast.buttonText && broadcast.buttonUrl) {
        options.reply_markup = { inline_keyboard: [[{ text: broadcast.buttonText, url: broadcast.buttonUrl }]] };
      }
      if (broadcast.imageUrl) {
        await bot.telegram.sendPhoto(delivery.telegramId, broadcast.imageUrl, { caption: broadcast.title });
        await bot.telegram.sendMessage(delivery.telegramId, broadcast.body, options);
      } else {
        const message = `${broadcast.title}\n\n${broadcast.body}`;
        if (message.length <= 4096) await bot.telegram.sendMessage(delivery.telegramId, message, options);
        else {
          await bot.telegram.sendMessage(delivery.telegramId, broadcast.title);
          await bot.telegram.sendMessage(delivery.telegramId, broadcast.body, options);
        }
      }
      const updated = await BroadcastDelivery.updateOne({ _id: delivery._id, status: 'pending' }, { $set: { status: 'sent', deliveredAt: new Date() } });
      if (updated.modifiedCount) await Broadcast.updateOne({ _id: id }, { $inc: { sentCount: 1, pendingCount: -1 } });
    } catch (error) {
      const safeError = String(error.description || error.message || 'Telegram delivery failed').slice(0, 500);
      const updated = await BroadcastDelivery.updateOne({ _id: delivery._id, status: 'pending' }, { $set: { status: 'failed', error: safeError } });
      if (updated.modifiedCount) await Broadcast.updateOne({ _id: id }, { $inc: { failedCount: 1, pendingCount: -1 } });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await Broadcast.updateOne({ _id: id, status: 'sending' }, { $set: { status: 'completed' } });
}

module.exports = { createBroadcast, processBroadcast };
