const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  ticker: {
    type: String,
    required: [true, 'Please provide a ticker symbol'],
    uppercase: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: [true, 'Please specify transaction type']
  },
  shares: {
    type: Number,
    required: [true, 'Please provide number of shares'],
    min: [0.0001, 'Shares must be positive']
  },
  price: {
    type: Number,
    required: [true, 'Please provide price'],
    min: [0, 'Price must be positive']
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    enum: ['USD', 'EUR', 'GBP', 'SEK', 'NOK', 'CHF', 'DKK']
  },
  totalValue: Number,
  commission: {
    type: Number,
    default: 0
  },
  transactionDate: {
    type: Date,
    required: true
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Calculate total value before saving
transactionSchema.pre('save', function(next) {
  if (!this.totalValue) {
    this.totalValue = this.shares * this.price + (this.commission || 0);
  }
  next();
});

// Index for faster queries
transactionSchema.index({ ticker: 1, type: 1, transactionDate: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
