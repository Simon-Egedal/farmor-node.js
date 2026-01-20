const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
  ticker: {
    type: String,
    required: [true, 'Please provide a ticker symbol'],
    uppercase: true,
    trim: true
  },
  shares: {
    type: Number,
    required: [true, 'Please provide number of shares'],
    min: [0.0001, 'Shares must be positive']
  },
  buyPrice: {
    type: Number,
    required: [true, 'Please provide buy price'],
    min: [0, 'Buy price must be positive']
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    enum: ['USD', 'EUR', 'GBP', 'SEK', 'NOK', 'CHF', 'DKK']
  },
  buyDate: {
    type: Date,
    default: Date.now
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for faster queries
portfolioSchema.index({ ticker: 1, createdAt: -1 });

module.exports = mongoose.model('Portfolio', portfolioSchema);
