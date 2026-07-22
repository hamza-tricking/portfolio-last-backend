const Message = require('../models/Message');
const User = require('../models/User');

exports.sendMessage = async (req, res) => {
  try {
    const { to, subject, body } = req.body;

    const recipient = await User.findById(to);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    const message = await Message.create({
      to,
      from: req.user._id,
      subject,
      body,
    });

    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const messages = await Message.find()
      .populate('to', 'fullName username email')
      .populate('from', 'fullName')
      .sort('-createdAt');
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMyMessages = async (req, res) => {
  try {
    const messages = await Message.find({ to: req.user._id })
      .populate('from', 'fullName')
      .sort('-createdAt');
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id)
      .populate('to', 'fullName username email')
      .populate('from', 'fullName');

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const userId = req.user._id.toString();
    if (message.to._id.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (message.to._id.toString() === userId && !message.read) {
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
