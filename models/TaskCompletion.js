const mongoose = require('mongoose');

const taskCompletionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', default: null },
  dayKey: { type: String, default: null },
  status: { type: String, enum: ['started', 'pending', 'completed', 'rejected'], default: 'started' },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  reward: { type: Number, min: 0, default: 0 }
}, { timestamps: true });

taskCompletionSchema.index({ userId: 1, taskId: 1, contentId: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model('TaskCompletion', taskCompletionSchema);
