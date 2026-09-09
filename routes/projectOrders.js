const router = require('express').Router();
const ProjectOrder = require('../models/ProjectOrder');
const User = require('../models/User');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

// ── POST /api/project-orders/step1 (Half Order) ───────────────────────
router.post('/step1', optionalAuth, async (req, res) => {
  try {
    let { fullName, phone } = req.body;

    let userId = null;
    let isRegisteredUser = false;

    if (req.user) {
      userId = req.user._id;
      isRegisteredUser = true;
      fullName = fullName || req.user.fullName;
      phone = phone || req.user.phone;
    } else if (phone) {
      // Check if this phone belongs to a registered user
      const existingUser = await User.findOne({ phone: phone.trim() });
      if (existingUser) {
        userId = existingUser._id;
        isRegisteredUser = true;
      }
    }

    if (!fullName || !phone) {
      return res.status(400).json({ message: 'Full name and phone are required.' });
    }

    const order = await ProjectOrder.create({
      fullName,
      phone,
      user: userId,
      isRegisteredUser,
      status: 'half_order'
    });

    res.status(201).json({ message: 'Half order created.', orderId: order._id, isRegisteredUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/project-orders/:id/step2 (Complete Order) ─────────────
router.put('/:id/step2', optionalAuth, async (req, res) => {
  try {
    const { websiteType, websiteTypeOther, similarProject, details, pagesCount } = req.body;

    const order = await ProjectOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (['contacted', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ message: 'This order is no longer active.' });
    }

    if (req.user && !order.user) {
      order.user = req.user._id;
      order.isRegisteredUser = true;
    } else if (!order.user && order.phone) {
      const existingUser = await User.findOne({ phone: order.phone });
      if (existingUser) {
        order.user = existingUser._id;
        order.isRegisteredUser = true;
      }
    }

    order.websiteType = websiteType || '';
    order.websiteTypeOther = websiteTypeOther || '';
    order.similarProject = similarProject || '';
    order.details = details || '';
    order.pagesCount = pagesCount || '';
    order.status = 'completed';
    
    await order.save();

    res.json({ message: 'Order completed.', orderId: order._id, isRegisteredUser: order.isRegisteredUser });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/project-orders — list all project orders (admin) ─────────────────────
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const orders = await ProjectOrder.find()
      .populate('user', 'fullName username email phone address role age')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/project-orders/:id/status — admin transitions order ──────────
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const allowed = ['half_order', 'completed', 'contacted', 'cancelled'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }

    const order = await ProjectOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    order.status = status;
    if (adminNote !== undefined) order.adminNote = adminNote;

    await order.save();
    res.json({ message: `Project order status updated to "${status}".`, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
