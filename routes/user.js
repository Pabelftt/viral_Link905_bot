const express = require('express');
const crypto = require('crypto');
const { body, param, query, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const User = require('../models/User');
const Content = require('../models/Content');
const ContentTaskProgress = require('../models/ContentTaskProgress');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const Withdrawal = require('../models/Withdrawal');
const Referral = require('../models/Referral');
const MilestoneClaim = require('../models/MilestoneClaim');
const ActivityLog = require('../models/ActivityLog');
const DailyVideoUsage = require('../models/DailyVideoUsage');
const env = require('../config/env');
const { requireUser } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');
const { verifyTelegramInitData } = require('../services/telegramAuth');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { CONTENT_TASK_COUNT, getContentTaskLinks } = require('../services/contentTasks');

const router = express.Router();
const verificationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please try again later.' }
});
const milestones = [
  { count: 5, reward: 10 }, { count: 10, reward: 25 }, { count: 25, reward: 75 },
  { count: 50, reward: 150 }, { count: 100, reward: 500 }, { count: 250, reward: 1000 }, { count: 500, reward: 2500 }
];

function validationError(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function loadCurrentUser(req) {
  const user = await User.findById(req.session.userId);
  if (!user || user.isSuspended || !user.isActive) {
    req.session.destroy(() => {});
    throw Object.assign(new Error('This account is unavailable.'), { status: 403 });
  }
  user.lastActiveAt = new Date();
  await user.save();
  return user;
}

async function addContentProgress(contents, userId) {
  if (!contents.length) return contents;
  const records = await ContentTaskProgress.find({
    userId,
    contentId: { $in: contents.map((content) => content._id) }
  }).select('contentId completedSlots').lean();
  return contents.map((content) => {
    const progress = records.find((record) => String(record.contentId) === String(content._id));
    const completed = progress?.completedSlots.length || 0;
    return {
      ...content,
      taskProgress: { completed, total: CONTENT_TASK_COUNT },
      isUnlocked: completed >= CONTENT_TASK_COUNT
    };
  });
}

router.post('/api/telegram/auth', asyncRoute(async (req, res) => {
  const verified = verifyTelegramInitData(req.body.initData);
  const telegram = verified.user;
  const telegramId = String(telegram.id);
  let user = await User.findOne({ telegramId });

  if (!user) {
    let referrer = null;
    const referralMatch = verified.startParam.match(/^ref_(\d{1,20})$/);
    if (referralMatch && referralMatch[1] !== telegramId) {
      referrer = await User.findOne({ telegramId: referralMatch[1], isSuspended: false });
    }
    const newUser = {
      telegramId,
      firstName: telegram.first_name,
      lastName: telegram.last_name || '',
      username: telegram.username || '',
      photoUrl: telegram.photo_url || '',
      referralCode: crypto.randomBytes(8).toString('hex'),
      referredBy: referrer?._id || null
    };
    try {
      if (referrer) {
        user = await withMongoTransaction(async (session) => {
          const [createdUser] = await User.create([newUser], { session });
          await Referral.create([{ referrerId: referrer._id, referredUserId: createdUser._id }], { session });
          await User.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } }, { session });
          await ActivityLog.create([{ actorId: createdUser._id, actorType: 'user', action: 'referral_registered', targetType: 'user', targetId: String(referrer._id) }], { session });
          return createdUser;
        });
      } else user = await User.create(newUser);
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ telegramId });
      if (!user) throw error;
    }
  } else {
    user.firstName = telegram.first_name;
    user.lastName = telegram.last_name || '';
    user.username = telegram.username || '';
    user.photoUrl = telegram.photo_url || '';
    user.lastActiveAt = new Date();
    await user.save();
  }
  if (user.isSuspended || !user.isActive) throw Object.assign(new Error('This account is unavailable.'), { status: 403 });

  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user._id.toString();
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.json({ ok: true, csrfToken: req.session.csrfToken, redirect: '/' });
}));

router.post('/api/contents/:id/tasks/:slot/start', requireUser, requireCsrf, [
  param('id').isMongoId(),
  param('slot').isInt({ min: 0, max: CONTENT_TASK_COUNT - 1 }).toInt()
], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const content = await Content.findOne({ _id: req.params.id, isActive: true }).select('taskLinks');
  if (!content) return res.status(404).json({ error: 'Content not found.' });

  const slot = req.params.slot;
  let progress;
  try {
    progress = await ContentTaskProgress.findOneAndUpdate(
      { userId: user._id, contentId: content._id },
      { $addToSet: { startedSlots: slot }, $setOnInsert: { userId: user._id, contentId: content._id } },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    progress = await ContentTaskProgress.findOne({ userId: user._id, contentId: content._id }).select('startedSlots completedSlots').lean();
  }
  if (progress?.completedSlots.includes(slot)) return res.status(409).json({ error: 'This task is already completed.' });
  if (!progress?.startedSlots.includes(slot)) {
    await ActivityLog.create({
      actorId: user._id, actorType: 'user', action: 'content_task_started',
      targetType: 'content', targetId: String(content._id), details: { slot: slot + 1 }
    });
  }
  res.json({ ok: true, taskLink: getContentTaskLinks(content)[slot] });
}));

router.post('/api/contents/:id/tasks/:slot/claim', requireUser, requireCsrf, verificationLimiter, [
  param('id').isMongoId(),
  param('slot').isInt({ min: 0, max: CONTENT_TASK_COUNT - 1 }).toInt()
], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const content = await Content.findOne({ _id: req.params.id, isActive: true }).select('videoUrl');
  if (!content) return res.status(404).json({ error: 'Content not found.' });

  const slot = req.params.slot;
  const progress = await ContentTaskProgress.findOneAndUpdate(
    {
      userId: user._id,
      contentId: content._id,
      startedSlots: slot,
      completedSlots: { $ne: slot }
    },
    { $addToSet: { completedSlots: slot } },
    { new: true, runValidators: true }
  );
  if (!progress) {
    const existing = await ContentTaskProgress.exists({ userId: user._id, contentId: content._id, completedSlots: slot });
    return res.status(existing ? 409 : 400).json({
      error: existing ? 'This task is already completed.' : 'Start this task before claiming it.'
    });
  }
  await ActivityLog.create({
    actorId: user._id, actorType: 'user', action: 'content_task_claimed',
    targetType: 'content', targetId: String(content._id), details: { slot: slot + 1 }
  });
  res.json({
    ok: true,
    completed: progress.completedSlots.length,
    total: CONTENT_TASK_COUNT,
    ...(progress.completedSlots.length === CONTENT_TASK_COUNT ? { videoUrl: content.videoUrl } : {})
  });
}));

router.get('/api/me', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  res.json({ id: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username, photoUrl: user.photoUrl, balance: user.balance, referralCount: user.referralCount });
}));

router.get('/api/contents', requireUser, [
  query('q').optional().isString().isLength({ max: 100 }),
  query('sort').optional().isIn(['latest', 'views', 'trending']),
  query('page').optional().isInt({ min: 1, max: 10000 })
], validationError, asyncRoute(async (req, res) => {
  const page = Number(req.query.page || 1);
  const filter = { isActive: true };
  if (req.query.q) filter.title = { $regex: req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const sort = req.query.sort === 'views' ? { totalViews: -1 } : req.query.sort === 'trending' ? { isTrending: -1, createdAt: -1 } : { createdAt: -1 };
  const [contents, total] = await Promise.all([
    Content.find(filter).sort(sort).skip((page - 1) * 12).limit(12).lean(),
    Content.countDocuments(filter)
  ]);
  const user = await loadCurrentUser(req);
  res.json({ contents: await addContentProgress(contents, user._id), page, hasMore: page * 12 < total });
}));

router.get('/api/tasks', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const tasks = await Task.find({
    isActive: true,
    type: { $ne: 'content-unlock' },
    $or: [{ appliesToAllContents: true }, { type: 'daily-video' }]
  }).sort({ createdAt: -1 }).lean();
  const [completions, dailyUsage] = await Promise.all([
    TaskCompletion.find({ userId: user._id }).select('taskId status dayKey startedAt').lean(),
    DailyVideoUsage.findOne({ userId: user._id, dayKey: new Date().toISOString().slice(0, 10) }).select('count').lean()
  ]);
  const dailyTask = tasks.find((task) => task.type === 'daily-video');
  res.json({
    tasks: tasks.map((task) => {
      const currentDay = new Date().toISOString().slice(0, 10);
      const completion = completions.find((entry) => String(entry.taskId) === String(task._id) && (task.type !== 'daily-video' || entry.dayKey === currentDay));
      return { ...task, completion: completion ? { status: completion.status, startedAt: completion.startedAt } : null };
    }),
    dailyLimit: dailyTask?.dailyLimit ? Math.min(env.dailyVideoLimit, dailyTask.dailyLimit) : env.dailyVideoLimit,
    dailyCount: dailyUsage?.count || 0
  });
}));

router.post('/api/tasks/:id/start', requireUser, requireCsrf, [
  param('id').isMongoId(),
  body('contentId').optional({ values: 'falsy' }).isMongoId()
], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const task = await Task.findOne({ _id: req.params.id, isActive: true });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const requestedContentId = req.body.contentId || null;
  const perContent = task.type !== 'daily-video' && (task.type === 'content-unlock' || !task.appliesToAllContents);
  if (perContent && !requestedContentId) return res.status(400).json({ error: 'Choose the content this task unlocks.' });
  if (requestedContentId) {
    const content = await Content.findOne({ _id: requestedContentId, isActive: true }).select('_id');
    if (!content) return res.status(404).json({ error: 'Content not found.' });
    if (!task.appliesToAllContents && !task.selectedContentIds.some((id) => String(id) === requestedContentId)) {
      return res.status(400).json({ error: 'This task is not available for that content.' });
    }
  }
  const contentId = perContent ? requestedContentId : null;
  const dayKey = task.type === 'daily-video' ? new Date().toISOString().slice(0, 10) : null;
  if (dayKey) {
    const completion = await withMongoTransaction(async (session) => {
      const existing = await TaskCompletion.findOne({ userId: user._id, taskId: task._id, dayKey }).session(session);
      if (existing && ['pending', 'completed'].includes(existing.status)) {
        throw Object.assign(new Error(`Task is already ${existing.status}.`), { status: 409 });
      }
      if (existing?.status === 'started') return existing;

      let usage = await DailyVideoUsage.findOne({ userId: user._id, dayKey }).session(session);
      if (!usage) {
        usage = new DailyVideoUsage({ userId: user._id, dayKey, count: 0, taskCounts: new Map() });
      }
      const perTaskCount = usage.taskCounts.get(String(task._id)) || 0;
      const perTaskLimit = task.dailyLimit || env.dailyVideoLimit;
      if (usage.count >= env.dailyVideoLimit || perTaskCount >= perTaskLimit) {
        throw Object.assign(new Error('You reached today’s video reward limit.'), { status: 429 });
      }
      usage.count += 1;
      usage.taskCounts.set(String(task._id), perTaskCount + 1);
      await usage.save({ session });

      let created;
      if (existing) {
        existing.status = 'started';
        existing.startedAt = new Date();
        existing.reward = task.reward;
        created = await existing.save({ session });
      } else {
        [created] = await TaskCompletion.create([{
          userId: user._id, taskId: task._id, contentId: null, dayKey, reward: task.reward, status: 'started'
        }], { session });
      }
      await ActivityLog.create([{
        actorId: user._id, actorType: 'user', action: 'task_started',
        targetType: 'task', targetId: String(task._id)
      }], { session });
      return created;
    });
    return res.status(201).json({ ok: true, completionId: completion.id, taskLink: task.taskLink, type: task.type });
  }
  const existing = await TaskCompletion.findOne({
    userId: user._id,
    taskId: task._id,
    ...(dayKey ? { dayKey } : { contentId })
  }).sort({ createdAt: -1 });
  if (existing && ['pending', 'completed'].includes(existing.status)) return res.status(409).json({ error: `Task is already ${existing.status}.` });
  let completion;
  if (existing) {
    existing.status = 'started';
    existing.startedAt = new Date();
    existing.reward = task.reward;
    completion = await existing.save();
  } else {
    try {
      completion = await TaskCompletion.create({ userId: user._id, taskId: task._id, contentId, dayKey, reward: task.reward, status: 'started' });
    } catch (error) {
      if (error.code !== 11000) throw error;
      return res.status(409).json({ error: 'This task has already been started.' });
    }
  }
  await ActivityLog.create({ actorId: user._id, actorType: 'user', action: 'task_started', targetType: 'task', targetId: String(task._id) });
  res.status(201).json({ ok: true, completionId: completion.id, taskLink: task.taskLink, type: task.type });
}));

router.post('/api/tasks/:id/verify', requireUser, requireCsrf, verificationLimiter, [
  param('id').isMongoId(),
  body('code').optional().isString().isLength({ max: 100 }),
  body('contentId').optional({ values: 'falsy' }).isMongoId()
], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const task = await Task.findOne({ _id: req.params.id, isActive: true });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const dayKey = task.type === 'daily-video' ? new Date().toISOString().slice(0, 10) : null;
  const perContent = task.type !== 'daily-video' && (task.type === 'content-unlock' || !task.appliesToAllContents);
  const contentId = perContent ? req.body.contentId || null : null;
  if (perContent && !contentId) return res.status(400).json({ error: 'Choose the content this task unlocks.' });
  const completion = await TaskCompletion.findOne({
    userId: user._id, taskId: task._id, status: 'started',
    ...(dayKey ? { dayKey } : { contentId })
  }).sort({ createdAt: -1 });
  if (!completion) return res.status(409).json({ error: 'Start this task before submitting it.' });
  const elapsed = (Date.now() - completion.startedAt.getTime()) / 1000;
  if (elapsed < env.taskCompletionDelaySeconds) {
    return res.status(400).json({ error: `Please wait ${Math.ceil(env.taskCompletionDelaySeconds - elapsed)} more seconds before submitting.` });
  }
  if (task.type === 'verification') {
    const supplied = String(req.body.code || '').trim();
    if (!task.verificationCode || supplied !== task.verificationCode) return res.status(400).json({ error: 'The verification code is incorrect.' });
    completion.status = 'pending';
  } else {
    completion.status = 'pending';
  }
  await completion.save();
  await ActivityLog.create({ actorId: user._id, actorType: 'user', action: 'task_submitted', targetType: 'taskCompletion', targetId: String(completion._id) });
  res.json({ ok: true, status: completion.status, message: 'Your completion was submitted for review.' });
}));

router.get('/api/withdrawals', requireUser, [query('page').optional().isInt({ min: 1, max: 10000 })], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const page = Math.max(1, Number(req.query.page || 1));
  const items = await Withdrawal.find({ userId: user._id }).sort({ requestedAt: -1 }).skip((page - 1) * 10).limit(10).lean();
  res.json({
    withdrawals: items.map((item) => ({ ...item, walletNumber: `${item.walletNumber.slice(0, 3)}••••${item.walletNumber.slice(-2)}` })),
    hasMore: items.length === 10
  });
}));

router.post('/api/withdrawals', requireUser, requireCsrf, [
  body('paymentMethod').isIn(['bKash', 'Nagad', 'Rocket']),
  body('walletNumber').matches(/^(?:\+?88)?01[3-9]\d{8}$/),
  body('amount').isFloat({ min: env.minWithdrawAmount, max: 10000000 }).toFloat()
], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const [pending, completedTaskCount, unlockedCount] = await Promise.all([
    Withdrawal.exists({ userId: user._id, status: 'pending' }),
    TaskCompletion.countDocuments({ userId: user._id, status: 'completed' }),
    TaskCompletion.distinct('contentId', { userId: user._id, status: 'completed', contentId: { $ne: null } }).then((ids) => ids.length)
  ]);
  if (pending) return res.status(409).json({ error: 'You already have a pending withdrawal request.' });
  if (user.referralCount < env.requiredReferrals || completedTaskCount < env.requiredTasks || unlockedCount < env.requiredUnlocks) {
    return res.status(400).json({ error: 'Complete the withdrawal requirements before requesting a payout.' });
  }
  const amount = Number(req.body.amount);
  let withdrawal;
  try {
    withdrawal = await withMongoTransaction(async (session) => {
      const debited = await User.updateOne(
        { _id: user._id, balance: { $gte: amount } },
        { $inc: { balance: -amount, reservedBalance: amount } },
        { session }
      );
      if (!debited.modifiedCount) throw Object.assign(new Error('Your available balance is not enough.'), { status: 400 });
      const [created] = await Withdrawal.create([{
        userId: user._id, paymentMethod: req.body.paymentMethod, walletNumber: req.body.walletNumber, amount
      }], { session });
      await ActivityLog.create([{
        actorId: user._id, actorType: 'user', action: 'withdrawal_requested',
        targetType: 'withdrawal', targetId: String(created._id), amount
      }], { session });
      return created;
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'You already have a pending withdrawal request.' });
    throw error;
  }
  res.status(201).json({ ok: true, message: 'Withdrawal request submitted.' });
}));

router.post('/api/referral/claim/:id', requireUser, requireCsrf, [param('id').isInt({ min: 0, max: 6 })], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const milestone = milestones[Number(req.params.id)];
  if (!milestone || user.referralCount < milestone.count) return res.status(400).json({ error: 'Referral milestone not reached.' });
  try {
    await withMongoTransaction(async (session) => {
      await MilestoneClaim.create([{ userId: user._id, milestone: milestone.count, reward: milestone.reward }], { session });
      await User.updateOne({ _id: user._id }, { $inc: { balance: milestone.reward } }, { session });
      await ActivityLog.create([{
        actorId: user._id, actorType: 'user', action: 'referral_milestone_claimed',
        targetType: 'milestone', targetId: String(milestone.count), amount: milestone.reward
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'This milestone has already been claimed.' });
    throw error;
  }
  res.json({ ok: true, reward: milestone.reward });
}));

router.get('/', asyncRoute(async (req, res) => {
  const user = req.session.userId ? await User.findById(req.session.userId) : null;
  const [contents, banner] = await Promise.all([
    Content.find({ isActive: true }).sort({ isTrending: -1, createdAt: -1 }).limit(12).lean(),
    require('../models/Setting').findOne({ key: 'promoBanner' }).lean()
  ]);
  const contentCards = user ? await addContentProgress(contents, user._id) : contents;
  res.render('user/home', { title: 'LinkHub', user, contents: contentCards, banner: banner?.value || '' });
}));

router.get('/earn', requireUser, asyncRoute(async (req, res) => res.render('user/earn', { title: 'Earn & Tasks', user: await loadCurrentUser(req), dailyLimit: env.dailyVideoLimit })));

router.get('/refer', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const [referrals, claims] = await Promise.all([
    Referral.find({ referrerId: user._id }).populate('referredUserId', 'firstName username joinedAt').sort({ createdAt: -1 }).limit(20).lean(),
    MilestoneClaim.find({ userId: user._id }).select('milestone').lean()
  ]);
  const referralUrl = env.botUsername ? `https://t.me/${env.botUsername}?start=ref_${user.telegramId}` : '';
  res.render('user/refer', { title: 'Refer & Earn', user, referrals, milestones, claimedMilestones: claims.map((item) => item.milestone), referralUrl });
}));

router.get('/profile', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const [withdrawals, completedTasks, unlockedContents] = await Promise.all([
    Withdrawal.find({ userId: user._id }).sort({ requestedAt: -1 }).limit(10).lean(),
    TaskCompletion.countDocuments({ userId: user._id, status: 'completed' }),
    TaskCompletion.distinct('contentId', { userId: user._id, status: 'completed', contentId: { $ne: null } }).then((ids) => ids.length)
  ]);
  res.render('user/profile', { title: 'Your Profile', user, withdrawals, minWithdrawAmount: env.minWithdrawAmount, requirements: { referrals: env.requiredReferrals, tasks: env.requiredTasks, unlocks: env.requiredUnlocks, completedTasks, unlockedContents } });
}));

router.get('/content/:id', requireUser, [param('id').isMongoId()], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const content = await Content.findOneAndUpdate({ _id: req.params.id, isActive: true }, { $inc: { totalViews: 1 } }, { new: true }).lean();
  if (!content) return res.status(404).render('errors/404', { title: 'Content not found' });
  const progress = await ContentTaskProgress.findOne({ userId: user._id, contentId: content._id }).select('startedSlots completedSlots').lean();
  const startedSlots = new Set(progress?.startedSlots || []);
  const completedSlots = new Set(progress?.completedSlots || []);
  const tasks = getContentTaskLinks(content).map((taskLink, slot) => ({
    slot,
    taskLink,
    started: startedSlots.has(slot),
    completed: completedSlots.has(slot)
  }));
  const allDone = completedSlots.size === CONTENT_TASK_COUNT;
  res.render('user/content', { title: content.title, user, content, tasks, allDone, completedTaskCount: completedSlots.size });
}));

router.locals = { milestones };

module.exports = router;
