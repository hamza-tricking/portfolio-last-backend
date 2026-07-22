const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateAccessToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '15m',
  });
};

const generateRefreshToken = (user) => {
  return jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '7d',
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
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

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
