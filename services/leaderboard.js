const User = require('../models/User');
const TaskCompletion = require('../models/TaskCompletion');
const MilestoneClaim = require('../models/MilestoneClaim');
const VideoRewardProgress = require('../models/VideoRewardProgress');
const ContentTaskProgress = require('../models/ContentTaskProgress');
const ActivityLog = require('../models/ActivityLog');
const { VIDEO_REWARD_AMOUNT } = require('./dailyVideoReward');
const { CONTENT_UNLOCK_REWARD_AMOUNT } = require('./contentTasks');

async function loadTopIncome(limit = 50) {
  const [taskRewards, referralRewards, videoRewards, contentRewards, adminCredits] = await Promise.all([
    TaskCompletion.aggregate([
      { $match: { status: 'completed', reward: { $gt: 0 } } },
      { $group: { _id: '$userId', amount: { $sum: '$reward' } } }
    ]),
    MilestoneClaim.aggregate([{ $group: { _id: '$userId', amount: { $sum: '$reward' } } }]),
    VideoRewardProgress.aggregate([
      { $match: { totalClaims: { $gt: 0 } } },
      { $project: { userId: 1, amount: { $multiply: ['$totalClaims', VIDEO_REWARD_AMOUNT] } } },
      { $group: { _id: '$userId', amount: { $sum: '$amount' } } }
    ]),
    ContentTaskProgress.aggregate([
      { $match: { unlockCount: { $gt: 0 } } },
      { $project: { userId: 1, amount: { $multiply: ['$unlockCount', CONTENT_UNLOCK_REWARD_AMOUNT] } } },
      { $group: { _id: '$userId', amount: { $sum: '$amount' } } }
    ]),
    ActivityLog.aggregate([
      { $match: { action: 'admin_balance_credit', amount: { $gt: 0 }, actorId: { $ne: null } } },
      { $group: { _id: '$targetId', amount: { $sum: '$amount' } } }
    ])
  ]);
  const totals = new Map();
  for (const reward of [...taskRewards, ...referralRewards, ...videoRewards, ...contentRewards]) {
    const userId = String(reward._id);
    totals.set(userId, (totals.get(userId) || 0) + reward.amount);
  }
  for (const credit of adminCredits) {
    const userId = String(credit._id);
    totals.set(userId, (totals.get(userId) || 0) + credit.amount);
  }
  const ranked = [...totals].filter(([, amount]) => amount > 0).sort((left, right) => right[1] - left[1]).slice(0, limit);
  const users = await User.find({
    _id: { $in: ranked.map(([userId]) => userId) },
    isActive: true,
    isSuspended: false
  }).select('firstName lastName username').lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  return ranked
    .map(([userId, amount]) => ({ user: usersById.get(userId), amount }))
    .filter((entry) => entry.user);
}

async function loadTopReferrals(limit = 50) {
  const users = await User.find({ isActive: true, isSuspended: false, referralCount: { $gt: 0 } })
    .sort({ referralCount: -1, joinedAt: 1 })
    .limit(limit)
    .select('firstName lastName username referralCount')
    .lean();
  return users.map((user) => ({ user, amount: user.referralCount }));
}

module.exports = { loadTopIncome, loadTopReferrals };
