const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const earningEntrySchema = new mongoose.Schema({
  type: { type: String, enum: ['registration', 'first_purchase', 'purchase', 'bounty'], required: true },
  amount: { type: Number, required: true },
  referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['pending_payout', 'paid', 'forfeited'], default: 'pending_payout' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    lowercase: true,
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false,
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    unique: true,
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
  },
  age: {
    type: Number,
    required: [true, 'Age is required'],
    min: 1,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },

  // ── Course System Fields ──────────────────────────────────────────
  // Buyer lifecycle: registered → buyer → member
  buyerStatus: {
    type: String,
    enum: ['registered', 'buyer', 'member'],
    default: 'registered',
  },

  // Identity for watermarking — stored, never shown on videos
  watermarkName: { type: String, default: '' },
  watermarkIdNumber: { type: String, default: '' },

  // CCP for payouts
  ccpNumber: { type: String, default: '' },

  // Block flag (set when leak verified)
  isBlocked: { type: Boolean, default: false },

  // Referral system
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referralLinkType: { type: String, enum: ['organic', 'granted'], default: 'organic' },

  // Earnings ledger
  earnings: [earningEntrySchema],

  // Attribution tracking
  registrationBonusPaid: { type: Boolean, default: false }, // one-time $2 per referrer
  referredPurchaseCount: { type: Number, default: 0 }, // eligible purchases count

  // Q&A credits
  qaCredits: {
    text: { type: Number, default: 0 },
    video: { type: Number, default: 0 },
  },

  // ── Course Progress & Activity Tracking ───────────────────────────
  courseProgress: [{
    lessonId: { type: Number, required: true },
    watchedSeconds: { type: Number, default: 0 },
    isCompleted: { type: Boolean, default: false },
    lastWatchedAt: { type: Date, default: Date.now }
  }],

  lastLoginAt: { type: Date, default: null },
  lastActiveAt: { type: Date, default: null },

}, { timestamps: true });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Auto-generate referral code on first save
userSchema.pre('save', function () {
  if (!this.referralCode) {
    this.referralCode = crypto.randomBytes(6).toString('hex').toUpperCase();
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Virtual: total pending payout amount
userSchema.virtual('pendingPayout').get(function () {
  return this.earnings
    .filter((e) => e.status === 'pending_payout')
    .reduce((sum, e) => sum + e.amount, 0);
});

// Virtual: total earned ever
userSchema.virtual('totalEarned').get(function () {
  return this.earnings
    .filter((e) => e.status !== 'forfeited')
    .reduce((sum, e) => sum + e.amount, 0);
});

module.exports = mongoose.model('User', userSchema);
