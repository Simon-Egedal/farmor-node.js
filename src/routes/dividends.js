const express = require('express');
const axios = require('axios');
const Dividend = require('../models/Dividend');
const Portfolio = require('../models/Portfolio');
const Cash = require('../models/Cash');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const STOCK_API_URL = process.env.STOCK_API_URL || 'http://localhost:5001';

// Get all dividends
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    
    const filter = {};
    if (status) {
      filter.status = status.toUpperCase();
    }

    const dividends = await Dividend.find(filter).sort({ exDate: -1 });
    res.json(dividends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dividend summary
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    
    // First, calculate expected dividends from holdings
    const portfolio = await Portfolio.find();
    const expectedDividendsList = [];

    for (const stock of portfolio) {
      try {
        // Get dividend data from Stock API
        const response = await axios.get(`${STOCK_API_URL}/api/dividend/${stock.ticker}`);
        
        if (response.data && response.data.annualDividend && response.data.annualDividend > 0) {
          const totalDividend = response.data.annualDividend * stock.shares;
          
          // Create or update expected dividend record
          let dividend = await Dividend.findOne({
            ticker: stock.ticker,
            status: 'EXPECTED'
          });

          if (dividend) {
            // Update existing
            dividend.amountPerShare = response.data.annualDividend;
            dividend.totalAmount = totalDividend;
            dividend.shares = stock.shares;
            dividend.currency = stock.currency || response.data.currency || 'USD';
            await dividend.save();
          } else {
            // Create new
            dividend = new Dividend({
              ticker: stock.ticker,
              amountPerShare: response.data.annualDividend,
              totalAmount: totalDividend,
              currency: stock.currency || response.data.currency || 'USD',
              exDate: new Date(now.getFullYear(), now.getMonth() + 3, 1),
              paymentDate: new Date(now.getFullYear(), now.getMonth() + 4, 1),
              shares: stock.shares,
              status: 'EXPECTED',
              notes: `Auto-calculated: ${response.data.annualDividend}/share × ${stock.shares} shares`
            });
            await dividend.save();
          }
          expectedDividendsList.push(dividend);
        }
      } catch (error) {
        console.warn(`Could not fetch dividend for ${stock.ticker}:`, error.message);
        // Continue with other stocks even if one fails
      }
    }

    // Get manually added expected dividends
    const manualExpectedDividends = await Dividend.find({
      status: 'EXPECTED',
      ticker: { $nin: portfolio.map(p => p.ticker) }
    });

    // Combine all expected dividends
    const allExpectedDividends = [...expectedDividendsList, ...manualExpectedDividends];

    // Received dividends (past)
    const receivedDividends = await Dividend.find({
      status: 'RECEIVED'
    });

    const expectedTotal = allExpectedDividends.reduce((sum, div) => {
      return sum + (parseFloat(div.totalAmount) || 0);
    }, 0);

    const receivedTotal = receivedDividends.reduce((sum, div) => {
      return sum + (parseFloat(div.totalAmount) || 0);
    }, 0);

    const thisYearDividends = await Dividend.find({
      paymentDate: {
        $gte: new Date(now.getFullYear(), 0, 1),
        $lte: now
      },
      status: 'RECEIVED'
    });

    const thisYearTotal = thisYearDividends.reduce((sum, div) => {
      return sum + (parseFloat(div.totalAmount) || 0);
    }, 0);

    res.json({
      expectedTotal: parseFloat(expectedTotal.toFixed(2)),
      expectedCount: allExpectedDividends.length,
      receivedTotal: parseFloat(receivedTotal.toFixed(2)),
      receivedCount: receivedDividends.length,
      thisYearTotal: parseFloat(thisYearTotal.toFixed(2)),
      dividends: {
        expected: allExpectedDividends,
        received: receivedDividends
      }
    });
  } catch (error) {
    console.error('Error in dividend summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add dividend
router.post('/add', authMiddleware, async (req, res) => {
  try {
    const {
      ticker,
      amountPerShare,
      exDate,
      paymentDate,
      shares,
      currency,
      status,
      notes
    } = req.body;

    if (!ticker || !amountPerShare || !exDate || !paymentDate || !shares) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const totalAmount = amountPerShare * shares;

    const dividend = new Dividend({
      ticker,
      amountPerShare,
      totalAmount,
      currency: currency || 'USD',
      exDate: new Date(exDate),
      paymentDate: new Date(paymentDate),
      shares,
      status: status || 'EXPECTED',
      notes
    });

    await dividend.save();

    res.status(201).json({
      message: 'Dividend added',
      dividend
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update dividend status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!['EXPECTED', 'RECEIVED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const dividend = await Dividend.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!dividend) {
      return res.status(404).json({ error: 'Dividend not found' });
    }

    // If dividend is being marked as RECEIVED, add to cash balance
    if (status === 'RECEIVED' && dividend.totalAmount > 0) {
      const cashTransaction = new Cash({
        amount: dividend.totalAmount,
        type: 'DEPOSIT',
        description: `Dividend received: ${dividend.ticker} - ${dividend.amountPerShare} per share × ${dividend.shares} shares`
      });
      await cashTransaction.save();
    }

    res.json({
      message: 'Dividend status updated',
      dividend
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete dividend
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const dividend = await Dividend.findByIdAndDelete(req.params.id);

    if (!dividend) {
      return res.status(404).json({ error: 'Dividend not found' });
    }

    res.json({ message: 'Dividend deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
