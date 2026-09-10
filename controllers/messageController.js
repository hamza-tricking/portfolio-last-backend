const Message = require('../models/Message');
const User = require('../models/User');

exports.sendMessage = async (req, res) => {
  try {
    const { to, subject, body } = req.body;

    if (!subject || !body) {
      return res.status(400).json({ message: 'Subject and body are required' });
    }

    let recipientId = to;

    // If sender is a regular user, or 'to' is 'admin' or omitted, default to the Admin account
    if (!recipientId || recipientId === 'admin' || req.user.role !== 'admin') {
      const adminUser = await User.findOne({ role: 'admin' });
      if (!adminUser) {
        return res.status(404).json({ message: 'Admin account not found to receive message' });
      }
      recipientId = adminUser._id;
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    const message = await Message.create({
      to: recipientId,
      from: req.user._id,
      subject,
      body,
    });

    await message.populate('from', 'fullName username email role');
    await message.populate('to', 'fullName username email role');

    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const messages = await Message.find()
      .populate('to', 'fullName username email role')
      .populate('from', 'fullName username email role')
      .sort('-createdAt');
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMyMessages = async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { to: req.user._id },
        { from: req.user._id },
      ],
    })
      .populate('from', 'fullName username email role')
      .populate('to', 'fullName username email role')
      .sort('-createdAt');
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id)
      .populate('to', 'fullName username email role')
      .populate('from', 'fullName username email role');

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const userId = req.user._id.toString();
    const isRecipient = message.to && message.to._id.toString() === userId;
    const isSender = message.from && message.from._id.toString() === userId;

    if (!isRecipient && !isSender && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (isRecipient && !message.read) {
      message.read = true;
      await message.save();
    }

    res.json(message);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const message = await Message.findByIdAndDelete(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    res.json({ message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
