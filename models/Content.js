const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  imageUrl: { type: String, trim: true, default: '' },
  videoUrl: { type: String, trim: true, default: '' },
  video_url: { type: String, trim: true, default: undefined, select: false },
  taskLinks: { type: [String], default: () => [] },
  date: { type: Date, default: Date.now },
  totalViews: { type: Number, min: 0, default: 0 },
  requiredTaskCount: { type: Number, min: 0, default: 5 },
  isActive: { type: Boolean, default: true, index: true },
  isTrending: { type: Boolean, default: false, index: true },
  seedKey: { type: String, unique: true, sparse: true }
}, { timestamps: true });

module.exports = mongoose.model('Content', contentSchema);
