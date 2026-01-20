const mongoose = require('mongoose');

const dividendSchema = new mongoose.Schema({
  ticker: {
    type: String,
    required: [true, 'Please provide a ticker symbol'],
    uppercase: true,
    trim: true
  },
  amountPerShare: {
    type: Number,
    required: [true, 'Please provide dividend amount per share'],
    min: [0, 'Dividend must be positive']
  },
  totalAmount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    enum: ['USD', 'EUR', 'GBP', 'SEK', 'NOK', 'CHF', 'DKK']
  },
  exDate: {
    type: Date,
    required: true
  },
  paymentDate: {
    type: Date,
    required: true
  },
  shares: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['EXPECTED', 'RECEIVED'],
    default: 'EXPECTED'
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for faster queries
dividendSchema.index({ ticker: 1, exDate: -1, status: 1 });

module.exports = mongoose.model('Dividend', dividendSchema);
