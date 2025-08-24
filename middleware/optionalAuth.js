// middleware/optionalAuth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
module.exports = async function optionalAuth(req, _res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return next();

    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload?.userId || payload?.id || payload?._id;
    if (!userId) return next();

    const user = await User.findById(userId).lean();
    if (user) req.user = { _id: user._id, email: user.email, username: user.username };
  } catch (_err) {
    // swallow token errors; continue unauthenticated
  }
  next();
};
