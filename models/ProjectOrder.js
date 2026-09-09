const mongoose = require('mongoose');

const projectOrderSchema = new mongoose.Schema({
  // Step 1: Contact details (Half order)
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },

  // Step 2: Project details (Complete order)
  websiteType: { type: String, default: '' },
  websiteTypeOther: { type: String, default: '' },
  similarProject: { type: String, default: '' },
  details: { type: String, default: '' },
  pagesCount: { type: String, default: '' },

  // Lifecycle
  status: {
    type: String,
    enum: ['half_order', 'completed', 'contacted', 'cancelled'],
    default: 'half_order',
  },

  // Linkage
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Admin notes
  adminNote: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('ProjectOrder', projectOrderSchema);
