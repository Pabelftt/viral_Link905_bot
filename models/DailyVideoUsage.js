const mongoose = require('mongoose');

const dailyVideoUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dayKey: { type: String, required: true },
  count: { type: Number, min: 0, default: 0 },
  taskCounts: { type: Map, of: Number, default: {} }
}, { timestamps: true });

dailyVideoUsageSchema.index({ userId: 1, dayKey: 1 }, { unique: true });
module.exports = mongoose.model('DailyVideoUsage', dailyVideoUsageSchema);
