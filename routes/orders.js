const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const Order = require('../models/Order');
const User = require('../models/User');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

// Receipt uploads configuration
const receiptsDir = path.join(__dirname, '../public/uploads/receipts');
if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, receiptsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const cleanId = req.params.id ? String(req.params.id).replace(/[^a-zA-Z0-9]/g, '') : 'order';
    const randomHex = crypto.randomBytes(6).toString('hex');
    cb(null, `receipt-${cleanId}-${Date.now()}-${randomHex}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPG, PNG, WEBP) are allowed as receipt proof.'), false);
  }
};

const uploadReceipt = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30MB limit
    fieldSize: 30 * 1024 * 1024, // 30MB limit
    files: 1,
  },
});

// ── Helper: trigger referral bonuses after a purchase is confirmed ──
async function handleReferralOnPurchase(order) {
  if (!order.referrer) return;

  const referrer = await User.findById(order.referrer);
  if (!referrer || referrer.isBlocked) return;

  const amount = 1;
  const type = 'purchase';

  referrer.earnings.push({
    type,
    amount,
    referredUser: order.user,
    status: 'pending_payout',
  });
  referrer.referredPurchaseCount += 1;
  await referrer.save();
}

// ── CHECK REFERRAL CODE & DISCOUNT ──────────────────────────────
// GET /api/orders/check-referral/:code
router.get('/check-referral/:code', optionalAuth, async (req, res) => {
  try {
    const raw = (req.params.code || '').trim().toUpperCase();
    if (!raw) return res.json({ valid: false });
    const referrerUser = await User.findOne({ referralCode: raw }).select('fullName username referralCode phone');
    if (referrerUser) {
      if (req.user && (referrerUser._id.equals(req.user._id) || referrerUser.referralCode === req.user.referralCode)) {
        return res.json({
          valid: false,
          isSelfReferral: true,
          message: 'لا يمكنك استخدام كود الإحالة الخاص بك (الإحالة الذاتية غير مسموحة).'
        });
      }
      return res.json({
        valid: true,
        referrerName: referrerUser.fullName || referrerUser.username || 'عضو مميز',
        discountUSD: 1,
        finalPriceUSD: 5,
        finalPriceDZD: 1250,
      });
    }
    return res.json({ valid: false });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── STEP 1: Submit contact details (public or authenticated) ──────
// POST /api/orders/step1
router.post('/step1', optionalAuth, async (req, res) => {
  try {
    const { fullName, phone, address, referralCode, orderId } = req.body;

    if (!fullName || !phone || !address) {
      return res.status(400).json({ message: 'Name, phone, and address are required.' });
    }

    const cleanFullName = String(fullName || '').slice(0, 100).trim();
    const cleanAddress = String(address || '').slice(0, 200).trim();
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!/^0[567]\d{8}$/.test(cleanPhone)) {
      return res.status(400).json({
        message: 'رقم الهاتف غير صالح. يجب أن يبدأ بـ 05 أو 06 أو 07 ويتكون من 10 أرقام (مثال: 0542781636).'
      });
    }

    // Block logged-in users who already own the course from placing another order on their account
    if (req.user && ['buyer', 'member'].includes(req.user.buyerStatus)) {
      return res.status(400).json({
        message: 'أنت مسجل الدخول وتمتلك الدورة بالفعل في حسابك. لا يمكنك إرسال طلب شراء جديد لحسابك نفسه. إذا كنت تريد شراء الدورة لشخص آخر، يرجى تسجيل الخروج أولاً.'
      });
    }

    // Resolve referrer if a referral code was supplied
    let referrer = null;
    let amountUSD = 6;
    if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
      const cleanRef = referralCode.trim().toUpperCase();
      const potentialReferrer = await User.findOne({ referralCode: cleanRef });
      
      const isSelf = potentialReferrer && (
        (req.user && potentialReferrer._id.equals(req.user._id)) ||
        (req.user && potentialReferrer.referralCode === req.user.referralCode) ||
        (potentialReferrer.phone && phone && potentialReferrer.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''))
      );

      if (potentialReferrer && !isSelf) {
        referrer = potentialReferrer;
        amountUSD = 5; // $1 referral discount applied ($5 instead of $6)
        // Handle one-time $2 registration bonus (first registration per referrer)
        if (!referrer.registrationBonusPaid && !referrer.isBlocked) {
          referrer.earnings.push({
            type: 'registration',
            amount: 2,
            status: 'pending_payout',
          });
          referrer.registrationBonusPaid = true;
          await referrer.save();
        }
      }
    }

    // If an existing in-progress order ID is provided (e.g. going back to step 1 and editing)
    if (orderId) {
      const order = await Order.findById(orderId);
      if (order && ['pending', 'awaiting_payment', 'confirmed'].includes(order.status)) {
        order.fullName = cleanFullName;
        order.phone = cleanPhone;
        order.address = cleanAddress;
        if (referrer) {
          order.referrer = referrer._id;
          order.amountUSD = 5;
        }
        if (req.user && !order.user) {
          order.user = req.user._id;
        }
        await order.save();
        return res.json({
          message: 'Order updated.',
          orderId: order._id,
          amountUSD: order.amountUSD,
          discountApplied: order.amountUSD === 5,
        });
      }
    }

    // In-progress order check: if an active in-progress order exists for this phone, update it
    const existing = await Order.findOne({ 
      phone: cleanPhone, 
      status: { $in: ['pending', 'awaiting_payment', 'confirmed'] } 
    }).sort({ createdAt: -1 });

    if (existing) {
      existing.fullName = cleanFullName;
      existing.address = cleanAddress;
      if (referrer) {
        existing.referrer = referrer._id;
        existing.amountUSD = 5;
      }
      if (req.user && !existing.user) {
        existing.user = req.user._id;
      }
      await existing.save();
      return res.json({
        message: 'Order updated. We will call you soon.',
        orderId: existing._id,
        amountUSD: existing.amountUSD,
        discountApplied: existing.amountUSD === 5,
      });
    }

    const order = await Order.create({
      fullName: cleanFullName,
      phone: cleanPhone,
      address: cleanAddress,
      user: req.user ? req.user._id : null,
      referrer: referrer ? referrer._id : null,
      amountUSD,
    });

    res.status(201).json({
      message: 'Order created. We will call you to confirm.',
      orderId: order._id,
      amountUSD: order.amountUSD,
      discountApplied: order.amountUSD === 5,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ── STEP 2: Add identity / watermark details ──────────────────────
// PUT /api/orders/:id/step2
router.put('/:id/step2', optionalAuth, async (req, res) => {
  try {
    const { watermarkIdNumber, idConsentGiven } = req.body;

    if (!watermarkIdNumber || !idConsentGiven) {
      return res.status(400).json({ message: 'Identity number and consent are required.' });
    }

    const cleanWatermarkId = String(watermarkIdNumber || '').slice(0, 50).trim();

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (['expired', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ message: 'This order is no longer active.' });
    }

    order.watermarkIdNumber = cleanWatermarkId;
    order.idConsentGiven = true;
    if (req.user && !order.user) {
      order.user = req.user._id;
    }
    await order.save();

    // If logged-in user hasn't saved watermark info yet, save it to their profile
    if (req.user && !req.user.watermarkIdNumber) {
      req.user.watermarkIdNumber = watermarkIdNumber;
      if (!req.user.watermarkName) {
        req.user.watermarkName = order.fullName || req.user.fullName;
      }
      await req.user.save();
    }

    res.json({ message: 'Identity details saved.', orderId: order._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── STEP 3: Upload receipt (file upload with validation or JSON fallback) ─
// PUT /api/orders/:id/receipt
router.put('/:id/receipt', optionalAuth, (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    uploadReceipt.single('receipt')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'Receipt image size must be less than 10MB.' });
        }
        return res.status(400).json({ message: err.message });
      } else if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const body = req.body || {};
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!['pending', 'confirmed', 'awaiting_payment', 'paid'].includes(order.status)) {
      return res.status(409).json({ message: 'Order must be active before uploading receipt.' });
    }

    if (!req.file && !body.receiptUrl) {
      return res.status(400).json({ message: 'Please upload a receipt image.' });
    }

    if (req.file) {
      order.receiptUrl = `/uploads/receipts/${req.file.filename}`;
    } else if (body.receiptUrl) {
      order.receiptUrl = body.receiptUrl;
    }

    const { paymentMethod, senderNote, transactionRef } = body;
    if (paymentMethod && ['ccp_baridimob', 'redotpay_usdt'].includes(paymentMethod)) {
      order.paymentMethod = paymentMethod;
    }

    const note = senderNote || transactionRef;
    if (note !== undefined) {
      order.senderNote = String(note).slice(0, 500);
    }

    order.status = 'awaiting_payment';
    if (req.user && !order.user) {
      order.user = req.user._id;
    }
    await order.save();

    res.json({
      message: 'Receipt uploaded. Awaiting admin verification.',
      orderId: order._id,
      receiptUrl: order.receiptUrl,
      paymentMethod: order.paymentMethod,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/orders — list all orders (admin) ─────────────────────
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'fullName email phone username')
      .populate('referrer', 'fullName referralCode username')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/orders/my — user's own order status ──────────────────
router.get('/my', protect, async (req, res) => {
  try {
    const cleanPhone = req.user.phone ? String(req.user.phone).replace(/\s+/g, '') : '';
    const phoneFilter = cleanPhone ? [
      { phone: req.user.phone },
      { phone: cleanPhone },
      { phone: cleanPhone.replace(/^\+213/, '0') },
      { phone: cleanPhone.replace(/^0/, '+213') },
    ] : [];

    // Prioritize paid or delivered order so user's course access is never shadowed
    let order = await Order.findOne({
      $or: [
        { user: req.user._id },
        ...phoneFilter,
      ],
      status: { $in: ['paid', 'delivered'] }
    }).sort({ createdAt: -1 });

    if (!order) {
      order = await Order.findOne({
        $or: [
          { user: req.user._id },
          ...phoneFilter,
        ]
      }).sort({ createdAt: -1 });
    }

    res.json(order || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/orders/:id — single order (public / admin) ──────────
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'fullName email')
      .populate('referrer', 'fullName referralCode');
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/orders/:id/status — admin transitions order ──────────
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const allowed = ['confirmed', 'awaiting_payment', 'paid', 'delivered', 'expired', 'cancelled'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }

    const order = await Order.findById(req.params.id).populate('referrer');
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const prev = order.status;
    order.status = status;
    if (adminNote) order.adminNote = adminNote;

    // Paid or Delivered: bind the order to a user account and activate buyer status & course access
    if (['paid', 'delivered'].includes(status)) {
      // Find buyer by linked user first, then by phone
      let buyer = null;
      if (order.user) {
        buyer = await User.findById(order.user);
      }
      if (!buyer && order.phone) {
        const cleanPhone = String(order.phone).replace(/\s+/g, '');
        buyer = await User.findOne({
          $or: [
            { phone: order.phone },
            { phone: cleanPhone },
            { phone: cleanPhone.replace(/^\+213/, '0') },
            { phone: cleanPhone.replace(/^0/, '+213') },
          ]
        });
      }

      if (buyer) {
        order.user = buyer._id;
        if (buyer.buyerStatus === 'registered') {
          buyer.buyerStatus = 'buyer';
        }
        if (!buyer.watermarkName) buyer.watermarkName = order.fullName;
        if (!buyer.watermarkIdNumber && order.watermarkIdNumber) {
          buyer.watermarkIdNumber = order.watermarkIdNumber;
        }
        if (!buyer.qaCredits || (buyer.qaCredits.text === 0 && buyer.qaCredits.video === 0)) {
          buyer.qaCredits = { text: 2, video: 1 };
        }
        await buyer.save();
      }

      // Credit purchase bonuses to referrer once when entering paid or delivered
      if (order.referrer && !['paid', 'delivered'].includes(prev)) {
        await handleReferralOnPurchase({ ...order.toObject(), user: order.user });
      }
    }

    // Transitioning OUT of paid or delivered (e.g. reverted to awaiting_payment, confirmed, or cancelled)
    if (!['paid', 'delivered'].includes(status) && ['paid', 'delivered'].includes(prev)) {
      let buyer = null;
      if (order.user) {
        buyer = await User.findById(order.user);
      }
      if (!buyer && order.phone) {
        const cleanPhone = String(order.phone).replace(/\s+/g, '');
        buyer = await User.findOne({
          $or: [
            { phone: order.phone },
            { phone: cleanPhone },
            { phone: cleanPhone.replace(/^\+213/, '0') },
            { phone: cleanPhone.replace(/^0/, '+213') },
          ]
        });
      }

      if (buyer && buyer.role !== 'admin') {
        // Check if user has ANY other order that is paid or delivered
        const otherPaidOrder = await Order.findOne({
          _id: { $ne: order._id },
          $or: [
            { user: buyer._id },
            { phone: buyer.phone }
          ],
          status: { $in: ['paid', 'delivered'] }
        });

        if (!otherPaidOrder) {
          buyer.buyerStatus = 'registered';
          await buyer.save();
        }
      }

      // Revert referrer purchase count & mark pending earning as forfeited
      if (order.referrer) {
        const referrer = await User.findById(order.referrer);
        if (referrer) {
          referrer.referredPurchaseCount = Math.max(0, (referrer.referredPurchaseCount || 1) - 1);
          const pendingEarning = referrer.earnings.find(
            (e) => e.type === 'purchase' && e.status === 'pending_payout' && String(e.referredUser) === String(order.user || buyer?._id)
          );
          if (pendingEarning) {
            pendingEarning.status = 'forfeited';
          }
          await referrer.save();
        }
      }
    }

    await order.save();
    res.json({ message: `Order status updated to "${status}".`, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
