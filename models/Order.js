const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  // Step 1 — Contact details (lead capture)
  fullName: { type: String, required: true, trim: true },
  phone:    { type: String, required: true, trim: true },
  address:  { type: String, required: true, trim: true },

  // Step 2 — Identity details (optional, for watermark)
  watermarkIdNumber: { type: String, default: '' },
  idConsentGiven:    { type: Boolean, default: false },

  // Payment
  paymentMethod: {
    type: String,
    enum: ['ccp_baridimob', 'redotpay_usdt'],
    default: 'ccp_baridimob',
  },
  receiptUrl:  { type: String, default: '' },
  senderNote:  { type: String, default: '' },
  amountUSD:   { type: Number, default: 6 },

  // Lifecycle
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'awaiting_payment', 'paid', 'delivered', 'expired', 'cancelled'],
    default: 'pending',
  },

  // Linkage
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // bound at delivery
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who referred

  // Admin notes
  adminNote: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
