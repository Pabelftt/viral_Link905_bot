const mongoose = require('mongoose');

const contentTaskProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', required: true },
  startedSlots: [{ type: Number, min: 0, max: 4 }],
  taskStartedAt: { type: Map, of: Date, default: () => ({}) },
  completedSlots: [{ type: Number, min: 0, max: 4 }],
  unlockedAt: { type: Date, default: null },
  unlockExpiresAt: { type: Date, default: null },
  unlockCount: { type: Number, min: 0, default: 0 }
}, { timestamps: true });

contentTaskProgressSchema.index({ userId: 1, contentId: 1 }, { unique: true });

module.exports = mongoose.model('ContentTaskProgress', contentTaskProgressSchema);
