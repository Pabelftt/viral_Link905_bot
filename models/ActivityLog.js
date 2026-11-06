const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorType: { type: String, enum: ['user', 'admin', 'system'], default: 'system' },
  action: { type: String, required: true, maxlength: 100 },
  targetType: { type: String, maxlength: 100, default: '' },
  targetId: { type: String, maxlength: 100, default: '' },
  amount: { type: Number, default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
