const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true, index: true },
  firstName: { type: String, required: true, trim: true, maxlength: 100 },
  lastName: { type: String, trim: true, maxlength: 100, default: '' },
  username: { type: String, trim: true, maxlength: 100, default: '' },
  photoUrl: { type: String, trim: true, maxlength: 2048, default: '' },
  balance: { type: Number, min: 0, default: 0 },
  reservedBalance: { type: Number, min: 0, default: 0 },
  referralCode: { type: String, required: true, unique: true, index: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referralCount: { type: Number, min: 0, default: 0 },
  isActive: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now }
}, { timestamps: true });

userSchema.index({ firstName: 'text', lastName: 'text', username: 'text', telegramId: 'text' });

module.exports = mongoose.model('User', userSchema);
