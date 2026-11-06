const User = require('../models/User');
const TaskCompletion = require('../models/TaskCompletion');
const ActivityLog = require('../models/ActivityLog');
const { withMongoTransaction } = require('../utils/mongoTransaction');

async function approveTaskCompletion(completionId, actorType = 'system') {
  return withMongoTransaction(async (session) => {
    const completion = await TaskCompletion.findOneAndUpdate(
      { _id: completionId, status: 'pending' },
      { $set: { status: 'completed', completedAt: new Date() } },
      { new: true, session }
    );
    if (!completion) throw Object.assign(new Error('This task request is no longer pending.'), { status: 409 });

    const updatedUser = await User.updateOne({ _id: completion.userId }, { $inc: { balance: completion.reward } }, { session });
    if (!updatedUser.matchedCount) throw Object.assign(new Error('Task owner was not found while crediting the reward.'), { status: 404 });

    await ActivityLog.create([{
      actorId: null,
      actorType,
      action: 'task_reward_issued',
      targetType: 'taskCompletion',
      targetId: String(completion._id),
      amount: completion.reward,
      details: { userId: String(completion.userId), taskId: String(completion.taskId) }
    }], { session });
    return completion;
  });
}

module.exports = { approveTaskCompletion };
