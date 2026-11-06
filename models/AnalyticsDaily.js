const mongoose = require('mongoose');

const analyticsDailySchema = new mongoose.Schema({
  dayStart: { type: Date, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', default: null },
  sessionId: { type: String, required: true, maxlength: 32 },
  path: { type: String, required: true, maxlength: 100 },
  appOpens: { type: Number, min: 0, default: 0 },
  pageViews: { type: Number, min: 0, default: 0 },
  durationSeconds: { type: Number, min: 0, default: 0 },
  lastActiveAt: { type: Date, required: true }
}, { versionKey: false });

analyticsDailySchema.index({ dayStart: 1, userId: 1, sessionId: 1, path: 1, contentId: 1 }, { unique: true });
analyticsDailySchema.index({ dayStart: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
analyticsDailySchema.index({ dayStart: 1, path: 1 });
analyticsDailySchema.index({ dayStart: 1, sessionId: 1 });
analyticsDailySchema.index({ dayStart: 1, contentId: 1 });

module.exports = mongoose.model('AnalyticsDaily', analyticsDailySchema);
