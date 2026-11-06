const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const env = require('../config/env');
const { verifyAdminPassword } = require('../services/adminPassword');
const User = require('../models/User');
const Content = require('../models/Content');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const Withdrawal = require('../models/Withdrawal');
const Referral = require('../models/Referral');
const Broadcast = require('../models/Broadcast');
const BroadcastDelivery = require('../models/BroadcastDelivery');
const ActivityLog = require('../models/ActivityLog');
const Setting = require('../models/Setting');
const { requireAdmin } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');
const { approveTaskCompletion } = require('../services/rewardService');
const { createBroadcast } = require('../services/broadcastService');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { CONTENT_TASK_COUNT, DEFAULT_CONTENT_TASK_LINK } = require('../services/contentTasks');

const router = express.Router();
const loginLimiter = require('express-rate-limit').rateLimit({
  windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait and try again.' }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = Object.assign(new Error(errors.array()[0].msg), { status: 400 });
    return next(error);
  }
  next();
}

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function cleanUrl(value, optional = true) {
  const raw = String(value || '').trim();
  if (!raw && optional) return '';
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('Enter a valid URL.'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error('Only safe HTTP/HTTPS URLs are allowed.'), { status: 400 });
  }
  return url.toString();
}

async function removeBroadcast(id) {
  const broadcast = await Broadcast.findOneAndUpdate(
    { _id: id, status: { $in: ['queued', 'completed', 'failed'] } },
    { $set: { status: 'failed' } },
    { new: true }
  );
  if (!broadcast) throw Object.assign(new Error('A broadcast already being sent cannot be deleted.'), { status: 409 });
  await BroadcastDelivery.deleteMany({ broadcastId: broadcast._id });
  await Broadcast.deleteOne({ _id: broadcast._id });
  await ActivityLog.create({ actorType: 'admin', action: 'broadcast_deleted', targetType: 'broadcast', targetId: String(broadcast._id) });
}

function contentTaskLinks(body) {
  return Array.from({ length: CONTENT_TASK_COUNT }, (_, index) => cleanUrl(body[`taskLink${index + 1}`]));
}

router.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin login', error: '' });
});

router.post('/admin/login', loginLimiter, requireCsrf, [
  body('username').isString().trim().isLength({ min: 1, max: 100 }),
  body('password').isString().isLength({ min: 1, max: 200 })
], validate, asyncRoute(async (req, res) => {
  const usernameMatches = req.body.username === env.adminUsername;
  const passwordMatches = await verifyAdminPassword(req.body.password, env.adminPasswordHash);
  if (!usernameMatches || !passwordMatches) {
    return res.status(401).render('admin/login', { title: 'Admin login', error: 'Invalid username or password.' });
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.isAdmin = true;
  req.session.adminUsername = env.adminUsername;
  req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');
  res.redirect('/admin');
}));

router.use('/admin', (req, res, next) => {
  if (req.path === '/login') return next();
  requireAdmin(req, res, next);
});
router.use('/admin', (req, res, next) => {
  res.locals.adminUsername = req.session.adminUsername || env.adminUsername;
  next();
});
router.use('/admin', (req, res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requireCsrf(req, res, next));

router.post('/admin/logout', asyncRoute(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
  res.clearCookie('arohi.sid', { httpOnly: true, secure: env.isProduction, sameSite: 'lax' });
  res.redirect('/admin/login');
}));

router.get('/admin', asyncRoute(async (req, res) => {
  const [
    totalUsers, activeUsers, suspendedUsers, totalContents, totalCompletions, rewardTotal,
    pendingWithdrawals, approvedWithdrawals, totalReferrals, activities, recentWithdrawals
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true, isSuspended: false, lastActiveAt: { $gte: new Date(Date.now() - 30 * 86400000) } }),
    User.countDocuments({ isSuspended: true }),
    Content.countDocuments(),
    TaskCompletion.countDocuments({ status: 'completed' }),
    TaskCompletion.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, sum: { $sum: '$reward' } } }]),
    Withdrawal.countDocuments({ status: 'pending' }),
    Withdrawal.countDocuments({ status: 'approved' }),
    Referral.countDocuments(),
    ActivityLog.find().sort({ createdAt: -1 }).limit(10).populate('actorId', 'firstName username').lean(),
    Withdrawal.find().sort({ requestedAt: -1 }).limit(8).populate('userId', 'firstName telegramId').lean()
  ]);
  res.render('admin/dashboard', {
    title: 'Dashboard', stats: { totalUsers, activeUsers, suspendedUsers, totalContents, totalCompletions, rewardTotal: rewardTotal[0]?.sum || 0, pendingWithdrawals, approvedWithdrawals, totalReferrals },
    activities, recentWithdrawals
  });
}));

router.get('/admin/users', asyncRoute(async (req, res) => {
  const search = String(req.query.q || '').slice(0, 100);
  const filter = {};
  if (search) filter.$or = ['firstName', 'lastName', 'username', 'telegramId'].map((field) => ({ [field]: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
  if (req.query.status === 'suspended') filter.isSuspended = true;
  if (req.query.status === 'active') filter.isSuspended = false;
  const users = await User.find(filter).sort({ joinedAt: -1 }).limit(100).lean();
  res.render('admin/section', { title: 'Users', section: 'users', items: users, search, status: req.query.status || '', csrfToken: req.session.csrfToken });
}));

router.get('/admin/users/:id', [param('id').isMongoId()], validate, asyncRoute(async (req, res) => {
  const user = await User.findById(req.params.id).lean();
  if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
  const [referrals, completions, withdrawals] = await Promise.all([
    Referral.find({ $or: [{ referrerId: user._id }, { referredUserId: user._id }] }).populate('referrerId referredUserId', 'firstName telegramId').sort({ createdAt: -1 }).limit(50).lean(),
    TaskCompletion.find({ userId: user._id }).populate('taskId', 'title reward').sort({ createdAt: -1 }).limit(50).lean(),
    Withdrawal.find({ userId: user._id }).sort({ requestedAt: -1 }).limit(50).lean()
  ]);
  res.render('admin/user-details', { title: 'User details', user, referrals, completions, withdrawals, csrfToken: req.session.csrfToken });
}));

router.post('/admin/users/:id/balance', [param('id').isMongoId(), body('amount').isFloat().toFloat(), body('reason').optional().isString().isLength({ max: 200 })], validate, asyncRoute(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount === 0) throw Object.assign(new Error('Enter a non-zero amount.'), { status: 400 });
  await withMongoTransaction(async (session) => {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, ...(amount < 0 ? { balance: { $gte: Math.abs(amount) } } : {}) },
      { $inc: { balance: amount } },
      { new: true, session }
    );
    if (!user) throw Object.assign(new Error('User not found or balance would become negative.'), { status: 400 });
    await ActivityLog.create([{
      actorType: 'admin', action: amount > 0 ? 'admin_balance_credit' : 'admin_balance_debit',
      targetType: 'user', targetId: String(user._id), amount,
      details: { reason: String(req.body.reason || '').slice(0, 200) }
    }], { session });
    return user;
  });
  res.redirect('/admin/users');
}));

router.post('/admin/users/:id/status', [param('id').isMongoId(), body('isSuspended').isBoolean()], validate, asyncRoute(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { isSuspended: bool(req.body.isSuspended) } });
  if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
  await ActivityLog.create({ actorType: 'admin', action: user.isSuspended ? 'user_suspended' : 'user_unsuspended', targetType: 'user', targetId: String(user._id) });
  res.redirect('/admin/users');
}));

router.get('/admin/contents', asyncRoute(async (req, res) => {
  const items = await Content.find().sort({ createdAt: -1 }).limit(100).lean();
  res.render('admin/section', { title: 'Viral links', section: 'contents', items, csrfToken: req.session.csrfToken });
}));

router.get('/admin/content-tasks', asyncRoute(async (req, res) => {
  const contents = await Content.find().sort({ createdAt: -1 }).limit(100).lean();
  res.render('admin/content-tasks', { title: 'Content task links', contents, csrfToken: req.session.csrfToken, defaultTaskLink: DEFAULT_CONTENT_TASK_LINK });
}));

router.post('/admin/content-tasks/:id', [param('id').isMongoId()], validate, asyncRoute(async (req, res) => {
  const taskLinks = contentTaskLinks(req.body);
  const content = await Content.findByIdAndUpdate(req.params.id, { $set: { taskLinks } }, { new: true, runValidators: true });
  if (!content) throw Object.assign(new Error('Content not found.'), { status: 404 });
  await ActivityLog.create({
    actorType: 'admin', action: 'content_task_links_updated',
    targetType: 'content', targetId: String(content._id)
  });
  res.redirect('/admin/content-tasks');
}));

router.post('/admin/contents/bulk', [
  body('ids').custom((value) => Array.isArray(value) || typeof value === 'string'),
  body('action').isIn(['activate', 'deactivate', 'trending', 'delete'])
], validate, asyncRoute(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids];
  if (!ids.length || ids.some((id) => !require('mongoose').isValidObjectId(id))) throw Object.assign(new Error('Select valid content records.'), { status: 400 });
  if (req.body.action === 'delete') await Content.deleteMany({ _id: { $in: ids } });
  else {
    const update = req.body.action === 'trending' ? { isTrending: true } : { isActive: req.body.action === 'activate' };
    await Content.updateMany({ _id: { $in: ids } }, { $set: update });
  }
  await ActivityLog.create({ actorType: 'admin', action: `content_bulk_${req.body.action}`, targetType: 'content', details: { count: ids.length } });
  res.redirect('/admin/contents');
}));

router.post('/admin/contents', [
  body('title').trim().isLength({ min: 1, max: 180 }),
  body('date').optional({ values: 'falsy' }).isISO8601(),
  body('totalViews').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  body('requiredTaskCount').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt()
], validate, asyncRoute(async (req, res) => {
  await Content.create({
    title: req.body.title,
    imageUrl: cleanUrl(req.body.imageUrl),
    videoUrl: cleanUrl(req.body.videoUrl),
    date: req.body.date ? new Date(req.body.date) : new Date(),
    totalViews: Number(req.body.totalViews || 0),
    requiredTaskCount: CONTENT_TASK_COUNT,
    isActive: bool(req.body.isActive),
    isTrending: bool(req.body.isTrending)
  });
  res.redirect('/admin/contents');
}));

router.post('/admin/contents/:id', [param('id').isMongoId(), body('title').optional().trim().isLength({ min: 1, max: 180 }), body('totalViews').optional({ values: 'falsy' }).isInt({ min: 0 }), body('requiredTaskCount').optional({ values: 'falsy' }).isInt({ min: 0 }), body('date').optional({ values: 'falsy' }).isISO8601()], validate, asyncRoute(async (req, res) => {
  const action = req.body.action;
  if (action === 'delete') await Content.findByIdAndDelete(req.params.id);
  else {
    const updates = {};
    for (const key of ['isActive', 'isTrending']) if (req.body[key] !== undefined) updates[key] = bool(req.body[key]);
    if (req.body.title) updates.title = req.body.title;
    if (req.body.imageUrl !== undefined) updates.imageUrl = cleanUrl(req.body.imageUrl);
    if (req.body.videoUrl !== undefined) updates.videoUrl = cleanUrl(req.body.videoUrl);
    if (req.body.totalViews !== undefined) updates.totalViews = Number(req.body.totalViews);
    if (req.body.date) updates.date = new Date(req.body.date);
    if (!Object.keys(updates).length) throw Object.assign(new Error('No content changes were submitted.'), { status: 400 });
    const updated = await Content.findByIdAndUpdate(req.params.id, { $set: updates }, { runValidators: true });
    if (!updated) throw Object.assign(new Error('Content not found.'), { status: 404 });
  }
  res.redirect('/admin/contents');
}));

router.get('/admin/tasks', asyncRoute(async (req, res) => {
  const [items, contents, pendingCompletions] = await Promise.all([
    Task.find().populate('selectedContentIds', 'title').sort({ createdAt: -1 }).limit(100).lean(),
    Content.find({ isActive: true }).select('title').sort({ title: 1 }).lean(),
    TaskCompletion.find({ status: 'pending' }).populate('userId', 'firstName telegramId').populate('taskId', 'title reward').sort({ createdAt: 1 }).limit(100).lean()
  ]);
  res.render('admin/section', { title: 'Tasks', section: 'tasks', items, contents, pendingCompletions, csrfToken: req.session.csrfToken });
}));

router.put('/admin/tasks/:id', [
  param('id').isMongoId(),
  body('title').optional().trim().isLength({ min: 1, max: 180 }),
  body('type').optional().isIn(['partner', 'verification', 'daily-video', 'content-unlock']),
  body('reward').optional().isFloat({ min: 0 }).toFloat()
], validate, asyncRoute(async (req, res) => {
  const updates = {};
  for (const key of ['title', 'type', 'verificationCode']) if (req.body[key] !== undefined) updates[key] = req.body[key];
  if (req.body.reward !== undefined) updates.reward = Number(req.body.reward);
  if (req.body.taskLink !== undefined) updates.taskLink = cleanUrl(req.body.taskLink);
  if (req.body.imageUrl !== undefined) updates.imageUrl = cleanUrl(req.body.imageUrl);
  if (req.body.isActive !== undefined) updates.isActive = bool(req.body.isActive);
  const task = await Task.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
  if (!task) throw Object.assign(new Error('Task not found.'), { status: 404 });
  res.json({ ok: true, task });
}));

router.post('/admin/tasks', [
  body('title').trim().isLength({ min: 1, max: 180 }),
  body('type').isIn(['partner', 'verification', 'daily-video', 'content-unlock']),
  body('reward').isFloat({ min: 0 }).toFloat(),
  body('dailyLimit').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  body('selectedContentIds').optional().custom((value) => Array.isArray(value) || typeof value === 'string')
], validate, asyncRoute(async (req, res) => {
  const selectedIds = (Array.isArray(req.body.selectedContentIds) ? req.body.selectedContentIds : req.body.selectedContentIds ? [req.body.selectedContentIds] : []);
  if (req.body.applyMode === 'selected' && (!selectedIds.length || selectedIds.some((id) => !require('mongoose').isValidObjectId(id)))) {
    throw Object.assign(new Error('Select at least one valid content.'), { status: 400 });
  }
  await Task.create({
    title: req.body.title, type: req.body.type, reward: Number(req.body.reward),
    taskLink: cleanUrl(req.body.taskLink),
    verificationCode: req.body.verificationCode || '',
    imageUrl: cleanUrl(req.body.imageUrl),
    appliesToAllContents: req.body.applyMode !== 'selected',
    selectedContentIds: req.body.applyMode === 'selected' ? selectedIds : [],
    dailyLimit: Number(req.body.dailyLimit || 0),
    isActive: bool(req.body.isActive)
  });
  res.redirect('/admin/tasks');
}));

router.post('/admin/tasks/:id', [param('id').isMongoId()], validate, asyncRoute(async (req, res) => {
  if (req.body.action === 'delete') await Task.findByIdAndDelete(req.params.id);
  else {
    const task = await Task.findById(req.params.id);
    if (!task) throw Object.assign(new Error('Task not found.'), { status: 404 });
    if (req.body.title !== undefined) task.title = String(req.body.title).trim().slice(0, 180);
    if (req.body.type !== undefined) {
      if (!['partner', 'verification', 'daily-video', 'content-unlock'].includes(req.body.type)) throw Object.assign(new Error('Choose a valid task category.'), { status: 400 });
      task.type = req.body.type;
    }
    if (req.body.reward !== undefined) {
      const reward = Number(req.body.reward);
      if (!Number.isFinite(reward) || reward < 0) throw Object.assign(new Error('Enter a valid task reward.'), { status: 400 });
      task.reward = reward;
    }
    if (req.body.taskLink !== undefined) task.taskLink = cleanUrl(req.body.taskLink);
    if (req.body.imageUrl !== undefined) task.imageUrl = cleanUrl(req.body.imageUrl);
    if (req.body.verificationCode !== undefined) task.verificationCode = String(req.body.verificationCode).slice(0, 100);
    if (req.body.isActive !== undefined) task.isActive = bool(req.body.isActive);
    if (req.body.dailyLimit !== undefined) {
      const dailyLimit = Number(req.body.dailyLimit);
      if (!Number.isInteger(dailyLimit) || dailyLimit < 0) throw Object.assign(new Error('Enter a valid daily limit.'), { status: 400 });
      task.dailyLimit = dailyLimit;
    }
    if (req.body.appliesToAllContents !== undefined) task.appliesToAllContents = bool(req.body.appliesToAllContents);
    if (req.body.selectedContentIds !== undefined || req.body.hasSelectedContentIds) {
      const ids = Array.isArray(req.body.selectedContentIds) ? req.body.selectedContentIds : [req.body.selectedContentIds];
      if (req.body.selectedContentIds === undefined) ids.length = 0;
      if (ids.some((id) => !require('mongoose').isValidObjectId(id))) throw Object.assign(new Error('Choose valid content records.'), { status: 400 });
      task.selectedContentIds = ids;
    }
    await task.save();
  }
  res.redirect('/admin/tasks');
}));

router.post('/admin/task-completions/:id', [param('id').isMongoId()], validate, asyncRoute(async (req, res) => {
  if (req.body.action === 'approve') await approveTaskCompletion(req.params.id, 'admin');
  else if (req.body.action === 'reject') {
    await withMongoTransaction(async (session) => {
      const completion = await TaskCompletion.findOneAndUpdate(
        { _id: req.params.id, status: 'pending' },
        { $set: { status: 'rejected' } },
        { new: true, session }
      );
      if (!completion) throw Object.assign(new Error('Task request is no longer pending.'), { status: 409 });
      await ActivityLog.create([{
        actorType: 'admin', action: 'task_completion_rejected',
        targetType: 'taskCompletion', targetId: String(completion._id)
      }], { session });
    });
  }
  res.redirect('/admin/tasks');
}));

router.get('/admin/withdrawals', asyncRoute(async (req, res) => {
  const filter = {};
  if (['pending', 'approved', 'rejected'].includes(req.query.status)) filter.status = req.query.status;
  if (['bKash', 'Nagad', 'Rocket'].includes(req.query.method)) filter.paymentMethod = req.query.method;
  const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : null;
  const dateTo = req.query.dateTo ? new Date(req.query.dateTo) : null;
  if ((req.query.dateFrom && (!dateFrom || Number.isNaN(dateFrom.getTime()))) || (req.query.dateTo && (!dateTo || Number.isNaN(dateTo.getTime())))) {
    throw Object.assign(new Error('Enter valid withdrawal dates.'), { status: 400 });
  }
  if ((dateFrom && !Number.isNaN(dateFrom.getTime())) || (dateTo && !Number.isNaN(dateTo.getTime()))) {
    filter.requestedAt = {};
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.requestedAt.$gte = dateFrom;
    if (dateTo && !Number.isNaN(dateTo.getTime())) {
      dateTo.setHours(23, 59, 59, 999);
      filter.requestedAt.$lte = dateTo;
    }
  }
  const items = await Withdrawal.find(filter).populate('userId', 'firstName username telegramId').sort({ requestedAt: -1 }).limit(100).lean();
  res.render('admin/section', { title: 'Withdrawals', section: 'withdrawals', items, status: req.query.status || '', method: req.query.method || '', dateFrom: req.query.dateFrom || '', dateTo: req.query.dateTo || '', csrfToken: req.session.csrfToken });
}));

router.post('/admin/withdrawals/:id', [param('id').isMongoId(), body('action').isIn(['approve', 'reject']), body('adminNote').optional().isString().isLength({ max: 500 })], validate, asyncRoute(async (req, res) => {
  const status = req.body.action === 'approve' ? 'approved' : 'rejected';
  await withMongoTransaction(async (session) => {
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { $set: { status, adminNote: String(req.body.adminNote || '').slice(0, 500), processedAt: new Date() } },
      { new: true, session }
    );
    if (!withdrawal) throw Object.assign(new Error('Withdrawal request is no longer pending.'), { status: 409 });
    const balanceChange = status === 'rejected'
      ? { $inc: { balance: withdrawal.amount, reservedBalance: -withdrawal.amount } }
      : { $inc: { reservedBalance: -withdrawal.amount } };
    const balanceUpdate = await User.updateOne({ _id: withdrawal.userId, reservedBalance: { $gte: withdrawal.amount } }, balanceChange, { session });
    if (!balanceUpdate.modifiedCount) throw Object.assign(new Error('Reserved withdrawal balance is inconsistent; no changes were applied.'), { status: 409 });
    await ActivityLog.create([{
      actorType: 'admin', action: `withdrawal_${status}`, targetType: 'withdrawal',
      targetId: String(withdrawal._id), amount: withdrawal.amount, details: { note: withdrawal.adminNote }
    }], { session });
  });
  res.redirect('/admin/withdrawals');
}));

router.get('/admin/broadcasts', asyncRoute(async (req, res) => {
  const [items, users, pendingIds, referralIds, contents, tasks] = await Promise.all([
    Broadcast.find().populate('relatedContentId', 'title').populate('relatedTaskId', 'title').sort({ createdAt: -1 }).limit(50).lean(),
    User.find().select('firstName username telegramId balance isSuspended lastActiveAt').sort({ joinedAt: -1 }).limit(500).lean(),
    Withdrawal.distinct('userId', { status: 'pending' }),
    Referral.distinct('referrerId'),
    Content.find({ isActive: true }).select('title').sort({ title: 1 }).lean(),
    Task.find({ isActive: true }).select('title').sort({ title: 1 }).lean()
  ]);
  const pendingSet = new Set(pendingIds.map(String));
  const referralSet = new Set(referralIds.map(String));
  res.render('admin/section', { title: 'Broadcasts', section: 'broadcasts', items, users, pendingSet, referralSet, contents, tasks, csrfToken: req.session.csrfToken });
}));

router.post('/admin/broadcasts', [
  body('title').trim().isLength({ min: 1, max: 180 }),
  body('body').isString().isLength({ min: 1, max: 4000 }),
  body('recipientIds').optional().custom((value) => Array.isArray(value) || typeof value === 'string'),
  body('excludedRecipientIds').optional().custom((value) => Array.isArray(value) || typeof value === 'string'),
  body('recipientMode').optional().isIn(['manual', 'filter']),
  body('recipientFilter').optional().isIn(['all', 'active', 'balance', 'pending', 'referrals', 'non-suspended']),
  body('recipientSearch').optional().isString().isLength({ max: 100 }),
  body('relatedContentId').optional({ values: 'falsy' }).isMongoId(),
  body('relatedTaskId').optional({ values: 'falsy' }).isMongoId()
], validate, asyncRoute(async (req, res) => {
  const recipientIds = Array.isArray(req.body.recipientIds) ? req.body.recipientIds : req.body.recipientIds ? [req.body.recipientIds] : [];
  const excludedRecipientIds = Array.isArray(req.body.excludedRecipientIds) ? req.body.excludedRecipientIds : req.body.excludedRecipientIds ? [req.body.excludedRecipientIds] : [];
  const recipientMode = req.body.recipientMode === 'filter' ? 'filter' : 'manual';
  if (recipientMode === 'manual' && !recipientIds.length) throw Object.assign(new Error('Select at least one recipient.'), { status: 400 });
  if ([...recipientIds, ...excludedRecipientIds].some((id) => !require('mongoose').isValidObjectId(id))) throw Object.assign(new Error('One or more selected recipients are invalid.'), { status: 400 });
  const { recipientCount } = await createBroadcast({
    title: req.body.title, body: req.body.body, imageUrl: cleanUrl(req.body.imageUrl),
    buttonText: String(req.body.buttonText || '').slice(0, 60), buttonUrl: cleanUrl(req.body.buttonUrl),
    relatedContentId: req.body.relatedContentId || null, relatedTaskId: req.body.relatedTaskId || null,
    recipientFilter: req.body.recipientFilter || 'all', recipientSearch: String(req.body.recipientSearch || '').slice(0, 100),
    recipientMode, recipientIds, excludedRecipientIds
  });
  await ActivityLog.create({ actorType: 'admin', action: 'broadcast_created', targetType: 'broadcast', details: { recipientCount } });
  res.redirect('/admin/broadcasts');
}));

router.put('/admin/broadcasts/:id', [
  param('id').isMongoId(),
  body('title').trim().isLength({ min: 1, max: 180 }),
  body('body').isString().isLength({ min: 1, max: 4000 }),
  body('buttonText').optional().isString().isLength({ max: 60 }),
  body('relatedContentId').optional({ values: 'falsy' }).isMongoId(),
  body('relatedTaskId').optional({ values: 'falsy' }).isMongoId()
], validate, asyncRoute(async (req, res) => {
  const broadcast = await Broadcast.findOneAndUpdate(
    { _id: req.params.id, status: 'queued', sentCount: 0, failedCount: 0 },
    { $set: {
      title: req.body.title,
      body: req.body.body,
      imageUrl: cleanUrl(req.body.imageUrl),
      buttonText: String(req.body.buttonText || '').slice(0, 60),
      buttonUrl: cleanUrl(req.body.buttonUrl),
      relatedContentId: req.body.relatedContentId || null,
      relatedTaskId: req.body.relatedTaskId || null
    } },
    { new: true, runValidators: true }
  );
  if (!broadcast) throw Object.assign(new Error('Only broadcasts that have not started can be edited.'), { status: 409 });
  await ActivityLog.create({ actorType: 'admin', action: 'broadcast_updated', targetType: 'broadcast', targetId: String(broadcast._id) });
  res.json({ ok: true, broadcast });
}));

router.delete('/admin/broadcasts/:id', [param('id').isMongoId()], validate, asyncRoute(async (req, res) => {
  await removeBroadcast(req.params.id);
  res.json({ ok: true });
}));

router.post('/admin/broadcasts/:id/delete', [param('id').isMongoId()], validate, asyncRoute(async (req, res) => {
  await removeBroadcast(req.params.id);
  res.redirect('/admin/broadcasts');
}));

router.get('/admin/settings', asyncRoute(async (req, res) => {
  const banner = await Setting.findOne({ key: 'promoBanner' }).lean();
  res.render('admin/section', { title: 'Settings', section: 'settings', items: [], banner: banner?.value || '', csrfToken: req.session.csrfToken });
}));

router.post('/admin/settings', [body('banner').optional().isString().isLength({ max: 500 })], validate, asyncRoute(async (req, res) => {
  await Setting.updateOne({ key: 'promoBanner' }, { $set: { value: String(req.body.banner || '').slice(0, 500) } }, { upsert: true });
  await ActivityLog.create({ actorType: 'admin', action: 'promo_banner_updated', targetType: 'setting', targetId: 'promoBanner' });
  res.redirect('/admin/settings');
}));

module.exports = router;
