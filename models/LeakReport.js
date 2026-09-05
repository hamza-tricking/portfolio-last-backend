const mongoose = require('mongoose');

const leakReportSchema = new mongoose.Schema({
  // Reporter info (can be unauthenticated)
  reporterName:  { type: String, default: '' },
  reporterEmail: { type: String, default: '' },
  reporterPhone: { type: String, default: '' },

  // The leaked content
  videoUrl:  { type: String, default: '' },  // link submitted
  videoFile: { type: String, default: '' },  // filename if uploaded

  status: {
    type: String,
    enum: ['open', 'judge_in_progress', 'resolved', 'rejected'],
    default: 'open',
  },

  // Set after Judge Session
  leakerUser:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reporterUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Outcome
  bountyPaid:   { type: Boolean, default: false },
  judgeNotes:   { type: String, default: '' },
  adminNote:    { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('LeakReport', leakReportSchema);
