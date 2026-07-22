const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true,
  },
  body: {
    type: String,
    required: [true, 'Message body is required'],
  },
  read: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
