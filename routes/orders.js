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
    fileSize: 10 * 1024 * 1024, // 10MB limit
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

// ── STEP 1: Submit contact details (public or authenticated) ──────
// POST /api/orders/step1
router.post('/step1', optionalAuth, async (req, res) => {
  try {
    const { fullName, phone, address, referralCode, orderId } = req.body;

    if (!fullName || !phone || !address) {
      return res.status(400).json({ message: 'Name, phone, and address are required.' });
    }

    // If an existing in-progress order ID is provided (e.g. going back to step 1 and editing)
    if (orderId) {
      const order = await Order.findById(orderId);
      if (order && ['pending', 'awaiting_payment', 'confirmed'].includes(order.status)) {
        order.fullName = fullName;
        order.phone = phone;
        order.address = address;
        if (req.user && !order.user) {
          order.user = req.user._id;
        }
        await order.save();
        return res.json({ message: 'Order updated.', orderId: order._id });
      }
    }

    // In-progress order check: if an active in-progress order exists for this phone, update it
    const existing = await Order.findOne({ 
      phone, 
      status: { $in: ['pending', 'awaiting_payment', 'confirmed'] } 
    }).sort({ createdAt: -1 });

    if (existing) {
      existing.fullName = fullName;
      existing.address = address;
      if (req.user && !existing.user) {
        existing.user = req.user._id;
      }
      await existing.save();
      return res.json({
        message: 'Order updated. We will call you soon.',
        orderId: existing._id,
      });
    }

    // Resolve referrer if a referral code was supplied
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
      if (referrer) {
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

    const order = await Order.create({
      fullName,
      phone,
      address,
      user: req.user ? req.user._id : null,
      referrer: referrer ? referrer._id : null,
    });

    res.status(201).json({ message: 'Order created. We will call you to confirm.', orderId: order._id });
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

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (['expired', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ message: 'This order is no longer active.' });
    }

    order.watermarkIdNumber = watermarkIdNumber;
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
      .populate('user', 'fullName email phone')
      .populate('referrer', 'fullName referralCode')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/orders/my — user's own order status ──────────────────
router.get('/my', protect, async (req, res) => {
  try {
    const order = await Order.findOne({ user: req.user._id }).sort({ createdAt: -1 });
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
