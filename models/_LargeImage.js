// models/_LargeImage.js
const { Schema } = require('mongoose');

const LargeImageSchema = new Schema({
  mime:   { type: String, enum: ['image/jpeg','image/png'], required: true },
  data:   { type: String, required: true, trim: true }, // URL or data:URI
  sizeKB: { type: Number, min: 1, max: 400, required: false }, // allow up to ~400 KB
}, { _id: false });

module.exports = LargeImageSchema;
