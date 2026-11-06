const mongoose = require('mongoose');

const broadcastDeliverySchema = new mongoose.Schema({
  broadcastId: { type: mongoose.Schema.Types.ObjectId, ref: 'Broadcast', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  telegramId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  error: { type: String, maxlength: 500, default: '' },
  deliveredAt: { type: Date, default: null }
}, { timestamps: true });

broadcastDeliverySchema.index({ broadcastId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.model('BroadcastDelivery', broadcastDeliverySchema);
