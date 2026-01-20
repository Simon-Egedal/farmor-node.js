const mongoose = require('mongoose');

const cashSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: [true, 'Please provide amount'],
    min: [0, 'Amount must be positive']
  },
  type: {
    type: String,
    enum: ['DEPOSIT', 'WITHDRAWAL', 'SALE'],
    required: true
  },
  description: String,
  date: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for faster queries
cashSchema.index({ type: 1, date: -1 });

module.exports = mongoose.model('Cash', cashSchema);
