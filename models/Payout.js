const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ccpNumber: { type: String, required: true },
  amountUSD: { type: Number, required: true },

  // Earnings entries included in this payout
  earningIds: [{ type: mongoose.Schema.Types.ObjectId }],

  status: {
    type: String,
    enum: ['awaiting', 'paid', 'rejected'],
    default: 'awaiting',
  },

  rejectionReason: { type: String, default: '' },

  // Whether a phone confirmation call was required and completed
  callRequired:   { type: Boolean, default: false },
  callCompleted:  { type: Boolean, default: false },

  adminNote: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Payout', payoutSchema);
