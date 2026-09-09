const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Course title is required'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  price: {
    type: Number,
    default: 0,
    min: 0,
  },
  imageUrl: {
    type: String,
    default: '',
  },
  isPublished: {
    type: Boolean,
    default: false,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lessons: [
    {
      id: { type: Number, required: true },
      title: { type: String, required: true },
      outcome: { type: String, default: '' },
      bunnyVideoId: { type: String, default: '' },
      durationSeconds: { type: Number, default: 0 },
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);
