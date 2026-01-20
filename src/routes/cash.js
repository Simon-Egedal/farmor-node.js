const express = require('express');
const Cash = require('../models/Cash');
const Portfolio = require('../models/Portfolio');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get current cash balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const transactions = await Cash.find().sort({ date: -1 });
    
    const balance = transactions.reduce((sum, tx) => {
      if (tx.type === 'DEPOSIT' || tx.type === 'SALE') {
        return sum + tx.amount;
      } else if (tx.type === 'WITHDRAWAL') {
        return sum - tx.amount;
      }
      return sum;
    }, 0);

    res.json({
      balance: parseFloat(balance.toFixed(2)),
      transactions: transactions.slice(0, 10) // Last 10 transactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deposit cash
router.post('/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const transaction = new Cash({
      amount: parseFloat(amount),
      type: 'DEPOSIT',
      description: description || 'Cash deposit',
      date: new Date()
    });

    await transaction.save();

    // Get updated balance
    const transactions = await Cash.find().sort({ date: -1 });
    const balance = transactions.reduce((sum, tx) => {
      if (tx.type === 'DEPOSIT' || tx.type === 'SALE') {
        return sum + tx.amount;
      } else if (tx.type === 'WITHDRAWAL') {
        return sum - tx.amount;
      }
      return sum;
    }, 0);

    res.status(201).json({
      message: 'Deposit successful',
      transaction,
      balance: parseFloat(balance.toFixed(2))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Withdraw cash
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    // Check if balance is sufficient
    const transactions = await Cash.find().sort({ date: -1 });
    const balance = transactions.reduce((sum, tx) => {
      if (tx.type === 'DEPOSIT' || tx.type === 'SALE') {
        return sum + tx.amount;
      } else if (tx.type === 'WITHDRAWAL') {
        return sum - tx.amount;
      }
      return sum;
    }, 0);

    if (balance < amount) {
      return res.status(400).json({ error: `Insufficient cash. Balance: ${balance.toFixed(2)} DKK` });
    }

    const transaction = new Cash({
      amount: parseFloat(amount),
      type: 'WITHDRAWAL',
      description: description || 'Cash withdrawal',
      date: new Date()
    });

    await transaction.save();

    // Get updated balance
    const updatedTransactions = await Cash.find().sort({ date: -1 });
    const updatedBalance = updatedTransactions.reduce((sum, tx) => {
      if (tx.type === 'DEPOSIT' || tx.type === 'SALE') {
        return sum + tx.amount;
      } else if (tx.type === 'WITHDRAWAL') {
        return sum - tx.amount;
      }
      return sum;
    }, 0);

    res.status(201).json({
      message: 'Withdrawal successful',
      transaction,
      balance: parseFloat(updatedBalance.toFixed(2))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all transactions
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await Cash.find().sort({ date: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
