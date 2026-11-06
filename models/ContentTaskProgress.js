const mongoose = require('mongoose');

const contentTaskProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', required: true },
  startedSlots: [{ type: Number, min: 0, max: 4 }],
  completedSlots: [{ type: Number, min: 0, max: 4 }]
}, { timestamps: true });

contentTaskProgressSchema.index({ userId: 1, contentId: 1 }, { unique: true });

module.exports = mongoose.model('ContentTaskProgress', contentTaskProgressSchema);
