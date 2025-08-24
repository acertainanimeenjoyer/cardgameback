const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email']
  },
  username: {
    type: String,
    unique: true,
    sparse: true,
    minlength: 3,
    maxlength: 32,
    trim: true
  },
  password: { type: String, required: true }
});
module.exports = mongoose.model('User', userSchema);