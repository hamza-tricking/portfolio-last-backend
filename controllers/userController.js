const User = require('../models/User');
const Order = require('../models/Order');

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-__v').sort({ createdAt: -1 });
    const orders = await Order.find().sort({ createdAt: -1 });

    const usersWithOrders = users.map(user => {
      const userObj = user.toObject();
      const userOrders = orders.filter(o => 
        (o.user && o.user.toString() === user._id.toString()) || 
        (o.phone && user.phone && o.phone.trim() === user.phone.trim())
      );

      // Referral stats
      const referredUsers = users.filter(u => u.referredBy && u.referredBy.toString() === user._id.toString());
      const referredBuyersCount = referredUsers.filter(u => ['buyer', 'member'].includes(u.buyerStatus)).length;
      userObj.referredRegistrationsCount = referredUsers.length;
      userObj.referredBuyersCount = referredBuyersCount;

      const hasCourseOrder = userOrders.length > 0;
      const latestOrder = userOrders[0] || null;

      return {
        ...userObj,
        hasCourseOrder,
        courseOrdersCount: userOrders.length,
        latestCourseOrder: latestOrder ? {
          _id: latestOrder._id,
          status: latestOrder.status,
          amountUSD: latestOrder.amountUSD,
          paymentMethod: latestOrder.paymentMethod || 'ccp_baridimob',
          receiptUrl: latestOrder.receiptUrl,
          senderNote: latestOrder.senderNote || '',
          watermarkIdNumber: latestOrder.watermarkIdNumber,
          idConsentGiven: latestOrder.idConsentGiven,
          adminNote: latestOrder.adminNote,
          createdAt: latestOrder.createdAt,
          updatedAt: latestOrder.updatedAt,
        } : null,
        courseOrders: userOrders.map(o => ({
          _id: o._id,
          status: o.status,
          amountUSD: o.amountUSD,
          paymentMethod: o.paymentMethod || 'ccp_baridimob',
          receiptUrl: o.receiptUrl,
          senderNote: o.senderNote || '',
          watermarkIdNumber: o.watermarkIdNumber,
          idConsentGiven: o.idConsentGiven,
          adminNote: o.adminNote,
          createdAt: o.createdAt,
        })),
      };
    });

    res.json(usersWithOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-__v');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const orders = await Order.find({
      $or: [
        { user: user._id },
        { phone: user.phone }
      ]
    }).sort({ createdAt: -1 });

    const userObj = user.toObject();
    const hasCourseOrder = orders.length > 0;
    const latestOrder = orders[0] || null;

    res.json({
      ...userObj,
      hasCourseOrder,
      courseOrdersCount: orders.length,
      latestCourseOrder: latestOrder,
      courseOrders: orders,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
