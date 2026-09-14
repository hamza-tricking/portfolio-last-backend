const mongoose = require('mongoose');

/**
 * Checks whether a user is an eligible referrer (must be a confirmed course buyer/member or admin).
 * Includes an automatic fallback check for existing orders with status 'paid' or 'delivered'
 * to guarantee that existing buyers are 100% recognized and self-healed even if their status lagged.
 */
async function isEligibleReferrer(user) {
  if (!user || user.isBlocked) return false;
  if (user.role === 'admin') return true;
  if (['buyer', 'member'].includes(user.buyerStatus)) return true;

  try {
    const Order = mongoose.models.Order || require('../models/Order');
    const cleanPhone = user.phone ? String(user.phone).replace(/\s+/g, '') : '';
    const phoneFilter = cleanPhone ? [
      { phone: user.phone },
      { phone: cleanPhone },
      { phone: cleanPhone.replace(/\D/g, '') },
      { phone: cleanPhone.startsWith('+213') ? cleanPhone.replace(/^\+213/, '0') : cleanPhone },
      { phone: cleanPhone.startsWith('0') ? `+213${cleanPhone.slice(1)}` : cleanPhone },
    ] : [];

    const hasPaid = await Order.exists({
      $or: [
        { user: user._id },
        ...phoneFilter,
      ],
      status: { $in: ['paid', 'delivered'] }
    });

    if (hasPaid) {
      // Self-heal user record so future lookups are instant
      user.buyerStatus = 'buyer';
      await user.save();
      return true;
    }
  } catch (err) {
    console.error('Error checking referrer eligibility fallback:', err);
  }

  return false;
}

module.exports = { isEligibleReferrer };
