const jwt = require('jsonwebtoken');
const User = require('../models/User');

const Order = require('../models/Order');
const ProjectOrder = require('../models/ProjectOrder');

const generateAccessToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

const generateRefreshToken = (user) => {
  return jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '30d',
  });
};

const sanitizeUser = (user) => {
  const obj = user.toObject();
  delete obj.password;
  return obj;
};

exports.register = async (req, res) => {
  try {
    const { username, fullName, email, password, phone, address, age } = req.body;

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ message: 'Email or username already in use' });
    }

    const user = await User.create({ username, fullName, email, password, phone, address, age });

    // Link any existing orders that match the phone number
    if (phone) {
      await Order.updateMany(
        { phone: phone, user: null },
        { $set: { user: user._id } }
      );
      await ProjectOrder.updateMany(
        { phone: phone, user: null },
        { $set: { user: user._id } }
      );
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.status(201).json({
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email/username and password are required' });
    }

    const user = await User.findOne({
      $or: [{ email }, { username: email }],
    }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Link any existing orders that match the phone number
    if (user.phone) {
      await Order.updateMany(
        { phone: user.phone, user: null },
        { $set: { user: user._id } }
      );
      await ProjectOrder.updateMany(
        { phone: user.phone, user: null },
        { $set: { user: user._id } }
      );
    }

    user.lastLoginAt = new Date();
    user.lastActiveAt = new Date();
    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.json({
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const accessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Auto-sync: if user is still marked 'registered' but has a paid or delivered order, activate buyer access
    if (user.buyerStatus === 'registered') {
      const paidOrder = await Order.findOne({
        $or: [
          { user: user._id },
          { phone: user.phone }
        ],
        status: { $in: ['paid', 'delivered'] }
      });

      if (paidOrder) {
        user.buyerStatus = 'buyer';
        if (!user.watermarkName) user.watermarkName = paidOrder.fullName;
        if (!user.watermarkIdNumber && paidOrder.watermarkIdNumber) {
          user.watermarkIdNumber = paidOrder.watermarkIdNumber;
        }
        if (!user.qaCredits || (user.qaCredits.text === 0 && user.qaCredits.video === 0)) {
          user.qaCredits = { text: 2, video: 1 };
        }
        await user.save();

        if (!paidOrder.user) {
          paidOrder.user = user._id;
          await paidOrder.save();
        }
      }
    } else if (user.buyerStatus === 'buyer' && user.role !== 'admin') {
      const paidOrder = await Order.findOne({
        $or: [
          { user: user._id },
          { phone: user.phone }
        ],
        status: { $in: ['paid', 'delivered'] }
      });

      if (!paidOrder) {
        user.buyerStatus = 'registered';
        await user.save();
      }
    }

    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.syncProgress = async (req, res) => {
  try {
    const { lessonId, watchedSecondsToAdd, isCompleted } = req.body;
    if (!lessonId) return res.status(400).json({ message: 'Lesson ID is required' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let progressEntry = user.courseProgress.find(p => p.lessonId === lessonId);
    if (!progressEntry) {
      progressEntry = { lessonId, watchedSeconds: 0, isCompleted: false, lastWatchedAt: new Date() };
      user.courseProgress.push(progressEntry);
      progressEntry = user.courseProgress[user.courseProgress.length - 1];
    }

    if (watchedSecondsToAdd) {
      progressEntry.watchedSeconds += Number(watchedSecondsToAdd);
    }
    if (isCompleted !== undefined) {
      progressEntry.isCompleted = isCompleted;
    }
    progressEntry.lastWatchedAt = new Date();

    await user.save();
    res.json({ courseProgress: user.courseProgress });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
