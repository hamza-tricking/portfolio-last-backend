const router = require('express').Router();
const User = require('../models/User');
const Payout = require('../models/Payout');
const { protect, adminOnly } = require('../middleware/auth');

// ── GET /api/referrals/stats — user's referral dashboard data ─────
router.get('/stats', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const totalEarned = user.earnings
      .filter((e) => e.status !== 'forfeited')
      .reduce((s, e) => s + e.amount, 0);

    const pendingAmount = user.earnings
      .filter((e) => e.status === 'pending_payout')
      .reduce((s, e) => s + e.amount, 0);

    const paidAmount = user.earnings
      .filter((e) => e.status === 'paid')
      .reduce((s, e) => s + e.amount, 0);

    // Milestone progress (capped at 100)
    const milestoneProgress = Math.min(totalEarned, 100);
    const milestoneReached = user.referredPurchaseCount >= 10;

    const referralUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/courses?ref=${user.referralCode}`;

    res.json({
      referralCode: user.referralCode,
      referralUrl,
      buyerStatus: user.buyerStatus,
      earnings: user.earnings,
      totalEarned,
      pendingAmount,
      paidAmount,
      milestoneProgress,
      milestoneReached,
      referredPurchaseCount: user.referredPurchaseCount,
      registrationBonusPaid: user.registrationBonusPaid,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/referrals/payout — request payout of pending earnings
router.post('/payout', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.isBlocked) return res.status(403).json({ message: 'Account is blocked.' });
    if (!user.ccpNumber) {
      return res.status(400).json({ message: 'Please save your CCP number in your profile first.' });
    }

    // Gather pending earning IDs
    const pendingEntries = user.earnings.filter((e) => e.status === 'pending_payout');
    if (pendingEntries.length === 0) {
      return res.status(400).json({ message: 'No pending earnings to withdraw.' });
    }

    const amount = pendingEntries.reduce((s, e) => s + e.amount, 0);
    const earningIds = pendingEntries.map((e) => e._id);

    // Threshold logic: call required for first-time or amount >= $20
    const priorPayouts = await Payout.countDocuments({ user: user._id, status: 'paid' });
    const callRequired = priorPayouts === 0 || amount >= 20;

    const payout = await Payout.create({
      user: user._id,
      ccpNumber: user.ccpNumber,
      amountUSD: amount,
      earningIds,
      callRequired,
    });

    res.status(201).json({
      message: 'Payout request submitted. Awaiting admin confirmation.',
      payoutId: payout._id,
      amountUSD: amount,
      callRequired,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/referrals/payouts — user's payout history ────────────
router.get('/payouts', protect, async (req, res) => {
  try {
    const payouts = await Payout.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(payouts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: GET /api/referrals/admin/payouts — all payouts ─────────
router.get('/admin/payouts', protect, adminOnly, async (req, res) => {
  try {
    const payouts = await Payout.find()
      .populate('user', 'fullName phone ccpNumber buyerStatus')
      .sort({ createdAt: -1 });
    res.json(payouts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: PUT /api/referrals/admin/payouts/:id — approve/reject ──
router.put('/admin/payouts/:id', protect, adminOnly, async (req, res) => {
  try {
    const { action, rejectionReason, callCompleted } = req.body;
    const payout = await Payout.findById(req.params.id).populate('user');
    if (!payout) return res.status(404).json({ message: 'Payout not found.' });

    if (action === 'approve') {
      payout.status = 'paid';
      payout.callCompleted = callCompleted || false;

      // Mark those earnings as paid on the user
      const user = payout.user;
      payout.earningIds.forEach((id) => {
        const entry = user.earnings.id(id);
        if (entry) entry.status = 'paid';
      });

      // Upgrade to member on first payout
      if (user.buyerStatus === 'buyer') {
        user.buyerStatus = 'member';
      }
      await user.save();
    } else if (action === 'reject') {
      payout.status = 'rejected';
      payout.rejectionReason = rejectionReason || '';
    } else {
      return res.status(400).json({ message: 'Action must be "approve" or "reject".' });
    }

    await payout.save();
    res.json({ message: `Payout ${action}d successfully.`, payout });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: GET /api/referrals/admin/fraud — fraud flags ───────────
router.get('/admin/fraud', protect, adminOnly, async (req, res) => {
  try {
    // Users with pending earnings but low referredPurchaseCount (possible registration farming)
    const suspects = await User.find({
      registrationBonusPaid: true,
      referredPurchaseCount: { $lt: 1 },
      'earnings.0': { $exists: true },
    }).select('fullName phone referralCode referredPurchaseCount earnings createdAt');

    res.json({ suspects });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/referrals/ccp — save CCP number ─────────────────────
router.put('/ccp', protect, async (req, res) => {
  try {
    const { ccpNumber } = req.body;
    if (!ccpNumber) return res.status(400).json({ message: 'CCP number is required.' });

    await User.findByIdAndUpdate(req.user._id, { ccpNumber });
    res.json({ message: 'CCP number saved.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
