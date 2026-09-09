const router = require('express').Router();
const Order = require('../models/Order');
const User = require('../models/User');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

// ── Helper: trigger referral bonuses after a purchase is confirmed ──
async function handleReferralOnPurchase(order) {
  if (!order.referrer) return;

  const referrer = await User.findById(order.referrer);
  if (!referrer || referrer.isBlocked) return;

  const isFirstPurchase = referrer.referredPurchaseCount === 0;
  const amount = isFirstPurchase ? 8 : 10;
  const type = isFirstPurchase ? 'first_purchase' : 'purchase';

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

    // If an existing order ID is provided (e.g. going back to step 1 and editing)
    if (orderId) {
      const order = await Order.findById(orderId);
      if (order && !['expired', 'cancelled'].includes(order.status)) {
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

    // Duplicate phone check: if active order exists, update it rather than throwing 409
    const existing = await Order.findOne({ phone, status: { $nin: ['expired', 'cancelled'] } });
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

// ── STEP 3: Upload receipt (simulated — store filename) ───────────
// PUT /api/orders/:id/receipt
router.put('/:id/receipt', optionalAuth, async (req, res) => {
  try {
    const { receiptUrl } = req.body; // frontend sends filename / mock url

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!['pending', 'confirmed', 'awaiting_payment'].includes(order.status)) {
      return res.status(409).json({ message: 'Order must be active before uploading receipt.' });
    }

    order.receiptUrl = receiptUrl || 'mock-receipt.jpg';
    order.status = 'awaiting_payment';
    if (req.user && !order.user) {
      order.user = req.user._id;
    }
    await order.save();

    res.json({ message: 'Receipt uploaded. Awaiting admin verification.', orderId: order._id });
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

    // Deliver: bind the order to a user account and activate buyer status
    if (status === 'delivered' && prev !== 'delivered') {
      // Try to find user by phone
      const buyer = await User.findOne({ phone: order.phone });
      if (buyer) {
        order.user = buyer._id;
        buyer.buyerStatus = 'buyer';
        buyer.watermarkName = order.fullName;
        buyer.watermarkIdNumber = order.watermarkIdNumber;
        buyer.qaCredits = { text: 2, video: 1 };
        await buyer.save();
      }

      // Credit purchase bonuses to referrer
      if (order.referrer) {
        await handleReferralOnPurchase({ ...order.toObject(), user: order.user });
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
