// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const uid = decoded?.userId || decoded?.id || decoded?._id;
    if (!uid) return res.status(401).json({ message: 'Invalid token payload' });
    req.user = { _id: uid, id: uid, email: decoded?.email, username: decoded?.username };
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
