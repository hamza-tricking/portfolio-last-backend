const mongoose = require('mongoose');

const qaRequestSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:         { type: String, enum: ['text', 'video'], required: true },
  questionText: { type: String, required: true },

  // Response
  responseText:     { type: String, default: '' },
  responseVideoUrl: { type: String, default: '' },

  status: {
    type: String,
    enum: ['open', 'answered'],
    default: 'open',
  },

  // Payment — free credits consumed, or paid via CCP
  usedFreeCredit: { type: Boolean, default: false },
  isPaid:         { type: Boolean, default: false },
  receiptUrl:     { type: String, default: '' },
  priceUSD:       { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('QaRequest', qaRequestSchema);
