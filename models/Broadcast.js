const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  body: { type: String, required: true, maxlength: 4000 },
  imageUrl: { type: String, trim: true, default: '' },
  buttonText: { type: String, trim: true, maxlength: 60, default: '' },
  buttonUrl: { type: String, trim: true, default: '' },
  relatedContentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', default: null },
  relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  recipientFilter: { type: String, default: 'all' },
  status: { type: String, enum: ['queued', 'sending', 'completed', 'failed'], default: 'queued', index: true },
  pendingCount: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  createdBy: { type: String, default: 'admin' }
}, { timestamps: true });

module.exports = mongoose.model('Broadcast', broadcastSchema);
