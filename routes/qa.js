const router = require('express').Router();
const QaRequest = require('../models/QaRequest');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

const TEXT_PRICE_USD = 2;
const VIDEO_PRICE_USD = 5;

// ── GET /api/qa/my — user's credits and requests ──────────────────
router.get('/my', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('qaCredits buyerStatus');
    const requests = await QaRequest.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ credits: user.qaCredits, requests, buyerStatus: user.buyerStatus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/qa/ask — submit a question ──────────────────────────
router.post('/ask', protect, async (req, res) => {
  try {
    const { type, questionText } = req.body;
    if (!type || !questionText) {
      return res.status(400).json({ message: 'Question type and text are required.' });
    }
    if (!['text', 'video'].includes(type)) {
      return res.status(400).json({ message: 'Type must be "text" or "video".' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Only buyers can ask questions
    if (user.buyerStatus === 'registered') {
      return res.status(403).json({ message: 'Only course buyers can ask questions.' });
    }

    // Check free credits strictly — no more questions when quota is finished
    const creditKey = type; // 'text' or 'video'
    const availableCredits = user.qaCredits ? (user.qaCredits[creditKey] || 0) : 0;
    if (availableCredits <= 0) {
      return res.status(403).json({
        message: `لقد استنفدت رصيدك المتاح من ${type === 'text' ? 'الأسئلة النصية' : 'أسئلة الفيديو'}. لا يمكنك إرسال المزيد من الأسئلة.`
      });
    }

    user.qaCredits[creditKey] = availableCredits - 1;
    await user.save();

    const request = await QaRequest.create({
      user: user._id,
      type,
      questionText,
      usedFreeCredit: true,
      isPaid: true,
      priceUSD: 0,
    });

    res.status(201).json({
      message: 'تم إرسال سؤالك بنجاح! سيتم الرد عليك قريباً.',
      requestId: request._id,
      usedFreeCredit: true,
      priceUSD: 0,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/qa/:id/receipt — upload payment receipt for paid Q&A ─
router.put('/:id/receipt', protect, async (req, res) => {
  try {
    const { receiptUrl } = req.body;
    const request = await QaRequest.findOne({ _id: req.params.id, user: req.user._id });
    if (!request) return res.status(404).json({ message: 'Question not found.' });
    if (request.isPaid) return res.status(409).json({ message: 'Already paid.' });

    request.receiptUrl = receiptUrl || 'mock-qa-receipt.jpg';
    await request.save();
    res.json({ message: 'Receipt uploaded. Awaiting admin to mark as paid.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: GET /api/qa/admin/all — all Q&A requests ──────────────
router.get('/admin/all', protect, adminOnly, async (req, res) => {
  try {
    const requests = await QaRequest.find()
      .populate('user', 'fullName phone email')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: PUT /api/qa/admin/:id/pay — mark request as paid ───────
router.put('/admin/:id/pay', protect, adminOnly, async (req, res) => {
  try {
    const request = await QaRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    request.isPaid = true;
    await request.save();
    res.json({ message: 'Q&A request marked as paid.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: PUT /api/qa/admin/:id/answer — respond to a question ───
router.put('/admin/:id/answer', protect, adminOnly, async (req, res) => {
  try {
    const { responseText, responseVideoUrl } = req.body;
    const request = await QaRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });

    request.responseText = responseText || '';
    request.responseVideoUrl = responseVideoUrl || '';
    request.status = 'answered';
    request.isPaid = true;
    await request.save();
    res.json({ message: 'Answer submitted.', request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
