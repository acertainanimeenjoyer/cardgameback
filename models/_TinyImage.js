// models/_TinyImage.js
const { Schema } = require('mongoose');

const TinyImageSchema = new Schema({
  // Prefer JPEG; keep PNG for backward compatibility
  mime:   { type: String, enum: ['image/jpeg','image/png'], required: true },
  // May be a normal http(s) URL or a data: URI
  data:   { type: String, required: true, trim: true },
  // Optional for http(s) URLs; enforced in controllers for data: URIs
  sizeKB: { type: Number, min: 1, max: 90, required: false },
}, { _id: false });

module.exports = TinyImageSchema;
