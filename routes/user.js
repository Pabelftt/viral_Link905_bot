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
const Setting = require('../models/Setting');
const VideoRewardProgress = require('../models/VideoRewardProgress');
const AnalyticsDaily = require('../models/AnalyticsDaily');
const env = require('../config/env');
const { requireUser } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');
const { verifyTelegramInitData } = require('../services/telegramAuth');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const {
  CONTENT_TASK_COUNT,
  CONTENT_UNLOCK_DURATION_MS,
  CONTENT_UNLOCK_REWARD_AMOUNT,
  getContentTaskLinks
} = require('../services/contentTasks');
const { getCachedContentList } = require('../services/contentListCache');
const { getTaskStartedAt, getTaskClaimState } = require('../services/contentTaskClaim');
const { VIDEO_REWARD_AMOUNT, VIDEO_WATCH_SECONDS, getVideoRewardLinks } = require('../services/dailyVideoReward');
const { loadWithdrawalStatus } = require('../services/withdrawalRequirements');
const { loadTopIncome, loadTopReferrals } = require('../services/leaderboard');
const { ANALYTICS_EVENT_TYPES, getAnalyticsPage } = require('../services/analytics');
const { normalizeContentRecord } = require('../services/contentData');

const router = express.Router();
const CONTENT_PAGE_SIZE = 20;
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
  }).select('contentId completedSlots unlockExpiresAt').lean();
  const legacyUnlocks = records.filter((record) => record.completedSlots?.length === CONTENT_TASK_COUNT && !record.unlockExpiresAt);
  if (legacyUnlocks.length) {
    const now = new Date();
    await ContentTaskProgress.bulkWrite(legacyUnlocks.map((record) => {
      record.unlockExpiresAt = new Date(now.getTime() + CONTENT_UNLOCK_DURATION_MS);
      record.unlockedAt = now;
      record.unlockCount = 1;
      return {
        updateOne: {
          filter: { _id: record._id, unlockExpiresAt: null, completedSlots: { $size: CONTENT_TASK_COUNT } },
          update: { $set: { unlockedAt: now, unlockExpiresAt: record.unlockExpiresAt, unlockCount: 1 } }
        }
      };
    }));
  }
  return contents.map((content) => {
    const progress = records.find((record) => String(record.contentId) === String(content._id));
    const unlocked = progress?.unlockExpiresAt > new Date();
    const completedCount = progress?.completedSlots?.length || 0;
    const completed = unlocked ? completedCount : progress?.unlockExpiresAt ? 0 : completedCount;
    return {
      ...content,
      taskProgress: { completed, total: CONTENT_TASK_COUNT, unlockExpiresAt: unlocked ? progress.unlockExpiresAt : null },
      isUnlocked: Boolean(unlocked && completed >= CONTENT_TASK_COUNT)
    };
  });
}

async function loadCurrentContentProgress(userId, contentId) {
  const projection = 'startedSlots taskStartedAt completedSlots unlockedAt unlockExpiresAt unlockCount';
  let progress = await ContentTaskProgress.findOne({ userId, contentId }).select(projection).lean();
  if (progress?.startedSlots?.length) {
    const missingStartTimes = progress.startedSlots.filter((slot) => !getTaskStartedAt(progress, slot));
    if (missingStartTimes.length) {
      const now = new Date();
      await ContentTaskProgress.updateOne(
        { _id: progress._id },
        { $min: Object.fromEntries(missingStartTimes.map((slot) => [`taskStartedAt.${slot}`, now])) }
      );
      progress = await ContentTaskProgress.findById(progress._id).select(projection).lean();
    }
  }
  if (progress?.completedSlots?.length === CONTENT_TASK_COUNT && !progress.unlockExpiresAt) {
    const unlockedAt = new Date();
    progress = await ContentTaskProgress.findOneAndUpdate(
      { _id: progress._id, completedSlots: { $size: CONTENT_TASK_COUNT }, unlockExpiresAt: null },
      { $set: { unlockedAt, unlockExpiresAt: new Date(unlockedAt.getTime() + CONTENT_UNLOCK_DURATION_MS), unlockCount: 1 } },
      { new: true }
    ).select(projection).lean() || progress;
  }
  if (progress?.unlockExpiresAt && progress.unlockExpiresAt <= new Date()) {
    progress = await ContentTaskProgress.findOneAndUpdate(
      { _id: progress._id, unlockExpiresAt: { $lte: new Date() } },
      { $set: { startedSlots: [], taskStartedAt: {}, completedSlots: [], unlockedAt: null, unlockExpiresAt: null } },
      { new: true }
    ).select(projection).lean() || await ContentTaskProgress.findById(progress._id).select(projection).lean();
  }
  return progress;
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
  await loadCurrentContentProgress(user._id, content._id);

  const slot = req.params.slot;
  let progress;
  try {
    progress = await ContentTaskProgress.findOneAndUpdate(
      { userId: user._id, contentId: content._id },
      {
        $addToSet: { startedSlots: slot },
        $min: { [`taskStartedAt.${slot}`]: new Date() },
        $setOnInsert: { userId: user._id, contentId: content._id }
      },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    progress = await ContentTaskProgress.findOne({ userId: user._id, contentId: content._id }).select('startedSlots taskStartedAt completedSlots').lean();
  }
  if (progress?.completedSlots.includes(slot)) return res.status(409).json({ error: 'This task is already completed.' });
  const startedAt = getTaskStartedAt(progress, slot);
  if (!startedAt) throw new Error('Unable to save the task start time.');
  if (!progress?.startedSlots.includes(slot)) {
    await ActivityLog.create({
      actorId: user._id, actorType: 'user', action: 'content_task_started',
      targetType: 'content', targetId: String(content._id), details: { slot: slot + 1 }
    });
  }
  const claimState = getTaskClaimState(startedAt);
  res.json({
    ok: true,
    taskLink: getContentTaskLinks(content)[slot],
    claimAvailableAt: claimState.claimAvailableAt,
    serverNow: Date.now()
  });
}));

router.post('/api/contents/:id/tasks/:slot/claim', requireUser, requireCsrf, verificationLimiter, [
  param('id').isMongoId(),
  param('slot').isInt({ min: 0, max: CONTENT_TASK_COUNT - 1 }).toInt()
], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const content = normalizeContentRecord(await Content.findOne({ _id: req.params.id, isActive: true })
    .select('_id videoUrl +video_url').lean());
  if (!content) return res.status(404).json({ error: 'Content not found.' });

  const slot = req.params.slot;
  const currentProgress = await loadCurrentContentProgress(user._id, content._id);
  if (currentProgress?.startedSlots.includes(slot)) {
    const claimState = getTaskClaimState(getTaskStartedAt(currentProgress, slot));
    if (!claimState.canClaim) {
      return res.status(429).json({
        error: 'Please wait one minute after starting this task before claiming it.',
        remainingSeconds: claimState.remainingSeconds,
        claimAvailableAt: claimState.claimAvailableAt,
        serverNow: Date.now()
      });
    }
  }
  const claim = await withMongoTransaction(async (session) => {
    const progress = await ContentTaskProgress.findOneAndUpdate(
      {
        userId: user._id,
        contentId: content._id,
        startedSlots: slot,
        completedSlots: { $ne: slot }
      },
      { $addToSet: { completedSlots: slot } },
      { new: true, runValidators: true, session }
    );
    if (!progress) {
      const alreadyCompleted = await ContentTaskProgress.exists({
        userId: user._id,
        contentId: content._id,
        completedSlots: slot
      }).session(session);
      return { error: alreadyCompleted ? 'This task is already completed.' : 'Start this task before claiming it.', status: alreadyCompleted ? 409 : 400 };
    }

    await ActivityLog.create([{
      actorId: user._id, actorType: 'user', action: 'content_task_claimed',
      targetType: 'content', targetId: String(content._id), details: { slot: slot + 1 }
    }], { session });

    let unlockExpiresAt = null;
    let balance = null;
    if (progress.completedSlots.length === CONTENT_TASK_COUNT) {
      const unlockedAt = new Date();
      unlockExpiresAt = new Date(unlockedAt.getTime() + CONTENT_UNLOCK_DURATION_MS);
      const unlocked = await ContentTaskProgress.findOneAndUpdate(
        { _id: progress._id, completedSlots: { $size: CONTENT_TASK_COUNT }, unlockExpiresAt: null },
        { $set: { unlockedAt, unlockExpiresAt }, $inc: { unlockCount: 1 } },
        { new: true, session }
      );
      if (!unlocked) throw Object.assign(new Error('Unable to unlock this content. Please refresh and try again.'), { status: 409 });
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id, isActive: true, isSuspended: false },
        { $inc: { balance: CONTENT_UNLOCK_REWARD_AMOUNT } },
        { new: true, session }
      ).select('balance').lean();
      if (!updatedUser) throw Object.assign(new Error('Your account is unavailable.'), { status: 403 });
      balance = updatedUser.balance;
      await ActivityLog.create([{
        actorId: user._id, actorType: 'user', action: 'content_unlock_rewarded',
        targetType: 'content', targetId: String(content._id),
        amount: CONTENT_UNLOCK_REWARD_AMOUNT,
        details: { unlockCount: unlocked.unlockCount }
      }], { session });
    }
    return { completed: progress.completedSlots.length, unlockExpiresAt, balance };
  });
  if (claim.error) return res.status(claim.status).json({ error: claim.error });
  res.json({
    ok: true,
    completed: claim.completed,
    total: CONTENT_TASK_COUNT,
    ...(claim.unlockExpiresAt ? {
      videoUrl: content.videoUrl,
      unlockExpiresAt: claim.unlockExpiresAt,
      serverNow: Date.now(),
      unlockReward: CONTENT_UNLOCK_REWARD_AMOUNT,
      balance: claim.balance
    } : {})
  });
}));

router.get('/api/video-reward/status', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const progress = await VideoRewardProgress.findOne({ userId: user._id }).select('startedAt totalClaims').lean();
  const claimAvailableAt = progress?.startedAt ? new Date(progress.startedAt.getTime() + VIDEO_WATCH_SECONDS * 1000) : null;
  const remainingSeconds = claimAvailableAt ? Math.max(0, Math.ceil((claimAvailableAt - Date.now()) / 1000)) : 0;
  res.json({ active: Boolean(progress?.startedAt), remainingSeconds, reward: VIDEO_REWARD_AMOUNT, totalClaims: progress?.totalClaims || 0 });
}));

router.post('/api/video-reward/start', requireUser, requireCsrf, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const setting = await Setting.findOne({ key: 'dailyVideoLinks' }).select('value').lean();
  const links = getVideoRewardLinks(setting?.value);
  const now = new Date();
  let progress;
  try {
    progress = await VideoRewardProgress.findOneAndUpdate(
      { userId: user._id, $or: [{ startedAt: null }, { startedAt: { $exists: false } }] },
      { $set: { startedAt: now }, $setOnInsert: { userId: user._id } },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    return res.status(409).json({ error: 'Your video reward is already in progress.' });
  }
  const linkIndex = progress.linkIndex % links.length;
  await ActivityLog.create({
    actorId: user._id, actorType: 'user', action: 'video_reward_started',
    targetType: 'videoReward', targetId: String(linkIndex + 1), details: { linkIndex }
  });
  res.status(201).json({ ok: true, taskLink: links[linkIndex], remainingSeconds: VIDEO_WATCH_SECONDS, reward: VIDEO_REWARD_AMOUNT });
}));

router.post('/api/video-reward/claim', requireUser, requireCsrf, verificationLimiter, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const existing = await VideoRewardProgress.findOne({ userId: user._id }).select('startedAt').lean();
  if (!existing?.startedAt) return res.status(400).json({ error: 'Start watching before claiming this reward.' });
  const claimAt = new Date(existing.startedAt.getTime() + VIDEO_WATCH_SECONDS * 1000);
  if (claimAt > new Date()) {
    return res.status(400).json({
      error: 'Please finish watching the full one-minute video before claiming.',
      remainingSeconds: Math.ceil((claimAt - Date.now()) / 1000)
    });
  }

  const claimedAt = new Date();
  const progress = await withMongoTransaction(async (session) => {
    const claimed = await VideoRewardProgress.findOneAndUpdate(
      { userId: user._id, startedAt: { $eq: existing.startedAt, $lte: claimedAt } },
      { $set: { startedAt: null, lastClaimedAt: claimedAt }, $inc: { linkIndex: 1, totalClaims: 1 } },
      { new: true, session }
    );
    if (!claimed) throw Object.assign(new Error('This reward was already claimed or restarted.'), { status: 409 });
    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, isActive: true, isSuspended: false },
      { $inc: { balance: VIDEO_REWARD_AMOUNT } },
      { new: true, session }
    ).select('balance').lean();
    if (!updatedUser) throw Object.assign(new Error('Your account is unavailable.'), { status: 403 });
    await ActivityLog.create([{
      actorId: user._id, actorType: 'user', action: 'video_reward_claimed',
      targetType: 'videoReward', targetId: String(claimed.totalClaims),
      amount: VIDEO_REWARD_AMOUNT, details: { totalClaims: claimed.totalClaims }
    }], { session });
    return { totalClaims: claimed.totalClaims, balance: updatedUser.balance };
  });
  res.json({ ok: true, reward: VIDEO_REWARD_AMOUNT, totalClaims: progress.totalClaims, balance: progress.balance });
}));

router.get('/api/me', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  res.json({ id: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username, photoUrl: user.photoUrl, balance: user.balance, referralCount: user.referralCount });
}));

router.post('/api/user/presence', requireUser, requireCsrf, asyncRoute(async (req, res) => {
  const updated = await User.findOneAndUpdate(
    { _id: req.session.userId, isActive: true, isSuspended: false },
    { $set: { lastActiveAt: new Date() } },
    { new: true }
  ).select('_id').lean();
  if (!updated) return res.status(403).json({ error: 'This account is unavailable.' });
  res.json({ ok: true });
}));

router.post('/api/analytics/event', requireUser, requireCsrf, [
  body('sessionId').isString().matches(/^[a-f\d]{32}$/i),
  body('type').isIn(ANALYTICS_EVENT_TYPES),
  body('path').isString().custom((value, { req }) => {
    const page = getAnalyticsPage(value);
    if (!page) throw new Error('Unsupported analytics page.');
    req.body.path = page.path;
    req.body.contentId = page.contentId;
    return true;
  }),
  body('durationSeconds').optional().isInt({ min: 0, max: 3600 }).toInt()
], validationError, asyncRoute(async (req, res) => {
  const user = await User.findById(req.session.userId).select('isActive isSuspended').lean();
  if (!user || !user.isActive || user.isSuspended) return res.status(403).json({ error: 'This account is unavailable.' });
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const increment = req.body.type === 'app_open' ? { appOpens: 1 }
    : req.body.type === 'page_view' ? { pageViews: 1 }
      : { durationSeconds: Number(req.body.durationSeconds || 0) };
  await AnalyticsDaily.updateOne({
    dayStart,
    userId: req.session.userId,
    sessionId: req.body.sessionId,
    path: req.body.path,
    contentId: req.body.contentId
  }, {
    $inc: increment,
    $set: { lastActiveAt: now },
    $setOnInsert: { contentId: req.body.contentId }
  }, { upsert: true, runValidators: true });
  res.json({ ok: true });
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
  const contentListKey = JSON.stringify(['api', req.query.q || '', req.query.sort || 'latest', page]);
  const { contents, total } = await getCachedContentList(contentListKey, async () => {
    const [pageContents, count] = await Promise.all([
      Content.find(filter).select('-videoUrl -video_url -taskLinks -task_links')
        .sort(sort).skip((page - 1) * CONTENT_PAGE_SIZE).limit(CONTENT_PAGE_SIZE).lean(),
      Content.countDocuments(filter)
    ]);
    return { contents: pageContents, total: count };
  });
  const user = await loadCurrentUser(req);
  res.json({ contents: await addContentProgress(contents.map(normalizeContentRecord), user._id), page, hasMore: page * CONTENT_PAGE_SIZE < total });
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
  const [pending, requirements] = await Promise.all([
    Withdrawal.exists({ userId: user._id, status: 'pending' }),
    loadWithdrawalStatus(user._id, user.referralCount)
  ]);
  if (pending) return res.status(409).json({ error: 'You already have a pending withdrawal request.' });
  if (!requirements.canWithdraw) {
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
    getCachedContentList('home:latest', () => Content.find({ isActive: true })
      .select('-videoUrl -video_url -taskLinks -task_links').sort({ createdAt: -1 }).limit(CONTENT_PAGE_SIZE + 1).lean()),
    Setting.findOne({ key: 'promoBanner' }).lean()
  ]);
  const hasMoreContents = contents.length > CONTENT_PAGE_SIZE;
  const firstPage = contents.slice(0, CONTENT_PAGE_SIZE).map(normalizeContentRecord);
  const contentCards = user ? await addContentProgress(firstPage, user._id) : firstPage;
  res.render('user/home', { title: 'LinkHub', user, contents: contentCards, hasMoreContents, banner: banner?.value || '' });
}));

router.get('/earn', requireUser, asyncRoute(async (req, res) => res.render('user/earn', { title: 'Earn & Tasks', user: await loadCurrentUser(req) })));

router.get('/refer', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const [referrals, claims] = await Promise.all([
    Referral.find({ referrerId: user._id }).populate('referredUserId', 'firstName username joinedAt').sort({ createdAt: -1 }).limit(20).lean(),
    MilestoneClaim.find({ userId: user._id }).select('milestone').lean()
  ]);
  const referralUrl = env.botUsername ? `https://t.me/${env.botUsername}?start=ref_${user.telegramId}` : '';
  res.render('user/refer', { title: 'Refer & Earn', user, referrals, milestones, claimedMilestones: claims.map((item) => item.milestone), referralUrl });
}));

router.get('/leaderboard', requireUser, [
  query('type').optional().isIn(['income', 'referrals'])
], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const type = req.query.type === 'referrals' ? 'referrals' : 'income';
  const rankings = type === 'referrals' ? await loadTopReferrals() : await loadTopIncome();
  res.render('user/leaderboard', { title: 'Leaderboard', user, type, rankings });
}));

router.get('/profile', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const [withdrawals, requirements] = await Promise.all([
    Withdrawal.find({ userId: user._id }).sort({ requestedAt: -1 }).limit(10).lean(),
    loadWithdrawalStatus(user._id, user.referralCount)
  ]);
  res.render('user/profile', { title: 'Your Profile', user, withdrawals, minWithdrawAmount: env.minWithdrawAmount, requirements });
}));

router.get('/privacy', requireUser, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  res.render('user/privacy', { title: 'Privacy & analytics', user });
}));

router.get('/content/:id/watch', requireUser, [param('id').isMongoId()], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const [content, progress] = await Promise.all([
    Content.findOne({ _id: req.params.id, isActive: true }).select('+video_url').lean(),
    ContentTaskProgress.findOne({
      userId: user._id,
      contentId: req.params.id,
      completedSlots: { $size: CONTENT_TASK_COUNT },
      unlockExpiresAt: { $gt: new Date() }
    }).select('unlockExpiresAt').lean()
  ]);
  if (!content) return res.status(404).render('errors/404', { title: 'Content not found' });
  if (!progress) return res.redirect(`/content/${req.params.id}`);
  const videoUrl = normalizeContentRecord(content).videoUrl;
  if (!videoUrl) return res.status(404).render('errors/404', { title: 'Video unavailable' });
  return res.redirect(videoUrl);
}));

router.get('/content/:id', requireUser, [param('id').isMongoId()], validationError, asyncRoute(async (req, res) => {
  const user = await loadCurrentUser(req);
  const content = normalizeContentRecord(await Content.findOneAndUpdate(
    { _id: req.params.id, isActive: true },
    { $inc: { totalViews: 1 } },
    { new: true }
  ).select('+video_url').lean());
  if (!content) return res.status(404).render('errors/404', { title: 'Content not found' });
  const progress = await loadCurrentContentProgress(user._id, content._id);
  const startedSlots = new Set(progress?.startedSlots || []);
  const completedSlots = new Set(progress?.completedSlots || []);
  const serverNow = new Date();
  const tasks = getContentTaskLinks(content).map((taskLink, slot) => {
    const startedAt = getTaskStartedAt(progress, slot);
    const claimState = getTaskClaimState(startedAt, serverNow.getTime());
    return {
      slot,
      taskLink,
      started: startedSlots.has(slot),
      completed: completedSlots.has(slot),
      claimAvailableAt: claimState.claimAvailableAt,
      claimReady: claimState.canClaim,
      remainingSeconds: claimState.remainingSeconds
    };
  });
  const allDone = completedSlots.size === CONTENT_TASK_COUNT && progress?.unlockExpiresAt > serverNow;
  const unlockExpiresAt = allDone ? progress.unlockExpiresAt : null;
  res.render('user/content', { title: content.title, user, content, tasks, allDone, completedTaskCount: completedSlots.size, unlockExpiresAt, serverNow });
}));

router.locals = { milestones };

module.exports = router;
