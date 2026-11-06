const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  type: { type: String, enum: ['partner', 'verification', 'daily-video', 'content-unlock'], required: true },
  reward: { type: Number, min: 0, required: true },
  taskLink: { type: String, trim: true, default: '' },
  verificationCode: { type: String, trim: true, default: '' },
  imageUrl: { type: String, trim: true, default: '' },
  appliesToAllContents: { type: Boolean, default: true },
  selectedContentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Content' }],
  dailyLimit: { type: Number, min: 0, default: 0 },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('Task', taskSchema);
