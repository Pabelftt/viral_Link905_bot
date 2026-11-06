const mongoose = require('mongoose');

const milestoneClaimSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  milestone: { type: Number, required: true },
  reward: { type: Number, required: true, min: 0 },
  claimedAt: { type: Date, default: Date.now }
});

milestoneClaimSchema.index({ userId: 1, milestone: 1 }, { unique: true });
module.exports = mongoose.model('MilestoneClaim', milestoneClaimSchema);
