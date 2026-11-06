const TaskCompletion = require('../models/TaskCompletion');
const Task = require('../models/Task');
const ContentTaskProgress = require('../models/ContentTaskProgress');
const VideoRewardProgress = require('../models/VideoRewardProgress');

const WITHDRAWAL_REQUIREMENTS = Object.freeze({ referrals: 10, tasks: 15, unlocks: 20 });

function getWithdrawalStatus(referralCount, completedTasks, unlockedContents) {
  return {
    ...WITHDRAWAL_REQUIREMENTS,
    referralCount,
    completedTasks,
    unlockedContents,
    canWithdraw: referralCount >= WITHDRAWAL_REQUIREMENTS.referrals
      && completedTasks >= WITHDRAWAL_REQUIREMENTS.tasks
      && unlockedContents >= WITHDRAWAL_REQUIREMENTS.unlocks
  };
}

async function loadWithdrawalStatus(userId, referralCount) {
  const [approvedTasks, claimedVideoRewards, legacyUnlockTaskIds, unlockedContentIds] = await Promise.all([
    TaskCompletion.countDocuments({ userId, status: 'completed' }),
    VideoRewardProgress.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: '$totalClaims' } } }
    ]),
    Task.distinct('_id', { type: 'content-unlock' }),
    ContentTaskProgress.distinct('contentId', { userId, unlockCount: { $gt: 0 } })
  ]);
  const legacyUnlockedContentIds = legacyUnlockTaskIds.length
    ? await TaskCompletion.distinct('contentId', { userId, status: 'completed', taskId: { $in: legacyUnlockTaskIds }, contentId: { $ne: null } })
    : [];
  const unlockedContents = new Set([...legacyUnlockedContentIds, ...unlockedContentIds].map(String)).size;
  const completedTasks = approvedTasks + (claimedVideoRewards[0]?.total || 0);
  return getWithdrawalStatus(referralCount, completedTasks, unlockedContents);
}

module.exports = { WITHDRAWAL_REQUIREMENTS, getWithdrawalStatus, loadWithdrawalStatus };
