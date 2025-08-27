const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true }, // unique already creates an index
  seq: { type: Number, default: 0 }
}, { timestamps: true });

// Remove extra: counterSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Counter', counterSchema);