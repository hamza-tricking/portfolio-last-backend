const router = require('express').Router();
const LeakReport = require('../models/LeakReport');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

const BOUNTY_USD = 0.5;

// ── POST /api/leaks/report — public leak submission ───────────────
router.post('/report', async (req, res) => {
  try {
    const { reporterName, reporterEmail, reporterPhone, videoUrl } = req.body;

    if (!reporterPhone && !reporterEmail) {
      return res.status(400).json({ message: 'At least a phone or email is required to receive the bounty.' });
    }
    if (!videoUrl && !req.body.videoFile) {
      return res.status(400).json({ message: 'A video link or file reference is required.' });
    }

    const report = await LeakReport.create({
      reporterName: String(reporterName || '').slice(0, 100).trim(),
      reporterEmail: String(reporterEmail || '').slice(0, 100).trim(),
      reporterPhone: String(reporterPhone || '').slice(0, 30).trim(),
      videoUrl: String(videoUrl || '').slice(0, 2000).trim(),
      videoFile: String(req.body.videoFile || '').slice(0, 500).trim(),
    });

    res.status(201).json({
      message: 'Report received! We will review and contact you for the $0.5 bounty.',
      reportId: report._id,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: GET /api/leaks — list all reports ──────────────────────
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const reports = await LeakReport.find()
      .populate('leakerUser', 'fullName phone email')
      .populate('reporterUser', 'fullName phone email referralCode')
      .sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: PUT /api/leaks/:id/judge — run judge session outcome ───
// Payload: { outcome: 'valid' | 'rejected', leakerPhone, reporterPhone, judgeNotes }
router.put('/:id/judge', protect, adminOnly, async (req, res) => {
  try {
    const { outcome, leakerPhone, reporterPhone, judgeNotes } = req.body;
    if (!['valid', 'rejected'].includes(outcome)) {
      return res.status(400).json({ message: 'Outcome must be "valid" or "rejected".' });
    }

    const report = await LeakReport.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found.' });

    report.status = 'judge_in_progress';
    report.judgeNotes = judgeNotes || '';

    if (outcome === 'rejected') {
      report.status = 'rejected';
      await report.save();
      return res.json({ message: 'Report rejected. No bounty issued.' });
    }

    // ── Valid leak: block leaker, reward reporter ──────────────────
    let blockedUser = null;
    if (leakerPhone) {
      blockedUser = await User.findOne({ phone: leakerPhone });
      if (blockedUser) {
        blockedUser.isBlocked = true;
        // Forfeit all pending earnings
        blockedUser.earnings.forEach((e) => {
          if (e.status === 'pending_payout') e.status = 'forfeited';
        });
        await blockedUser.save();
        report.leakerUser = blockedUser._id;
      }
    }

    // Register reporter and grant referral link + bounty
    let reporter = null;
    if (reporterPhone) {
      reporter = await User.findOne({ phone: reporterPhone });
    }
    if (reporter) {
      // Add $5 bounty earning
      reporter.earnings.push({ type: 'bounty', amount: BOUNTY_USD, status: 'pending_payout' });
      // Grant referral link if they don't have one from a purchase
      if (reporter.buyerStatus === 'registered') {
        reporter.referralLinkType = 'granted';
      }
      await reporter.save();
      report.reporterUser = reporter._id;
    }

    report.status = 'resolved';
    report.bountyPaid = false; // will be paid via payout flow
    await report.save();

    res.json({
      message: `Judge session complete. ${blockedUser ? `Leaker (${leakerPhone}) blocked.` : 'Leaker not found in system.'} ${reporter ? `Reporter credited $${BOUNTY_USD}.` : 'Reporter not in system — register them manually.'}`,
      blockedUser: blockedUser ? blockedUser._id : null,
      reporter: reporter ? reporter._id : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
