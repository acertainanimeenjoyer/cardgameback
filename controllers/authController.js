// controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Register user
exports.registerUser = async (req, res) => {
  try {
    const { email: rawEmail, password: rawPassword, username: rawUsername } = req.body || {};

    // Trim + normalize first
    const email = String(rawEmail ?? '').trim().toLowerCase();
    const password = String(rawPassword ?? '').trim();
    const username = String(rawUsername ?? '').trim() || undefined; // keep sparse unique clean

    if (!email || !password) {
      return res.status(400).json({ message: 'All fields required' });
    }

    // Optional: basic email sanity (schema will also validate)
    // if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    //   return res.status(400).json({ message: 'Invalid email' });
    // }

    // Uniqueness
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Hash + save
    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ email, username, password: hashed });
    await newUser.save();

    // Token
    const token = jwt.sign(
      { id: newUser._id, email: newUser.email, username: newUser.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(201).json({ token });
  } catch (err) {
    // Duplicate key (email or username)
    if (err?.code === 11000) {
      if (err?.keyPattern?.email || err?.keyValue?.email) {
        return res.status(409).json({ message: 'Email already registered' });
      }
      if (err?.keyPattern?.username || err?.keyValue?.username) {
        return res.status(409).json({ message: 'Username already in use' });
      }
    }
    // Mongoose validation errors
    if (err?.name === 'ValidationError') {
      const msg = Object.values(err.errors || {})
        .map(e => e.message)
        .join(', ') || 'Invalid input';
      return res.status(400).json({ message: msg });
    }
    console.error('[AUTH][REGISTER]', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Login user
exports.loginUser = async (req, res) => {
  try {
    const { email: rawEmail, password: rawPassword } = req.body || {};
    const email = String(rawEmail ?? '').trim().toLowerCase();
    const password = String(rawPassword ?? '').trim();

    if (!email || !password) {
      return res.status(400).json({ message: 'All fields required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({ token });
  } catch (err) {
    console.error('[AUTH][LOGIN]', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get current user info
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    return res.json(user);
  } catch (err) {
    console.error('[AUTH][ME]', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
