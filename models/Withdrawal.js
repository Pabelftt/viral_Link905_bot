const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  paymentMethod: { type: String, enum: ['bKash', 'Nagad', 'Rocket'], required: true },
  walletNumber: { type: String, required: true, trim: true, maxlength: 30 },
  amount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  adminNote: { type: String, trim: true, maxlength: 500, default: '' },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null }
}, { timestamps: true });

withdrawalSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
module.exports = mongoose.model('Withdrawal', withdrawalSchema);
