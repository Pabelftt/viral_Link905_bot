const mongoose = require('mongoose');

const videoRewardProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  linkIndex: { type: Number, min: 0, default: 0 },
  startedAt: { type: Date, default: null },
  lastClaimedAt: { type: Date, default: null },
  totalClaims: { type: Number, min: 0, default: 0 }
}, { timestamps: true });

videoRewardProgressSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('VideoRewardProgress', videoRewardProgressSchema);
