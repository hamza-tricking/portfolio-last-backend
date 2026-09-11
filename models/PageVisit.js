const mongoose = require('mongoose');

const pageVisitSchema = new mongoose.Schema({
  // ── Identity ────────────────────────────────────────────────────
  sessionId:   { type: String, required: true, unique: true, index: true },
  visitorId:   { type: String, index: true },   // persistent anonymous ID from localStorage
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  isRegistered:{ type: Boolean, default: false },
  buyerStatus: { type: String, default: null },  // 'registered'|'buyer'|'member' if logged in

  // ── Page ────────────────────────────────────────────────────────
  page:        { type: String, enum: ['home', 'courses'], required: true, index: true },

  // ── Timing ──────────────────────────────────────────────────────
  enteredAt:     { type: Date, default: Date.now, index: true },
  exitedAt:      { type: Date, default: null },
  timeOnPageSec: { type: Number, default: null },
  scrollDepthPct:{ type: Number, default: null },  // 0-100

  // ── Origin ──────────────────────────────────────────────────────
  referrer:       { type: String, default: '' },
  referrerDomain: { type: String, default: 'Direct' }, // 'Instagram', 'Google', 'TikTok', 'WhatsApp', 'Direct', etc.
  refCode:        { type: String, default: null },      // ?ref= param

  // ── Device ──────────────────────────────────────────────────────
  deviceType:   { type: String, enum: ['mobile', 'tablet', 'desktop'], default: 'desktop' },
  browser:      { type: String, default: '' },
  os:           { type: String, default: '' },
  screenWidth:  { type: Number, default: null },
  screenHeight: { type: Number, default: null },
  language:     { type: String, default: '' },

  // ── Network ─────────────────────────────────────────────────────
  ip:      { type: String, default: '' },   // first 3 octets only
  country: { type: String, default: '' },   // from Accept-Language

  // ── Conversion (courses page) ────────────────────────────────────
  startedOrder:    { type: Boolean, default: false }, // submitted step 1 form
  convertedToOrder:{ type: Boolean, default: false }, // completed payment upload
  orderId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
}, { timestamps: true });

// Index to speed up admin dashboard queries
pageVisitSchema.index({ page: 1, enteredAt: -1 });
pageVisitSchema.index({ visitorId: 1, enteredAt: -1 });

module.exports = mongoose.model('PageVisit', pageVisitSchema);
