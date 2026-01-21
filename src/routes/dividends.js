const express = require('express');
const axios = require('axios');
const Dividend = require('../models/Dividend');
const Portfolio = require('../models/Portfolio');
const Cash = require('../models/Cash');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const STOCK_API_URL = process.env.STOCK_API_URL || 'http://localhost:5001';

// Exchange rates to DKK
const EXCHANGE_RATES = {
  DKK: 1,
  USD: 6.38,
  EUR: 7.46,
  GBP: 8.47,
  SEK: 0.63,
  NOK: 0.60,
  CHF: 7.31
};

// Helper to convert to DKK
const convertToDKK = (amount, currency) => {
  if (!amount || amount < 0) return 0;
  const rate = EXCHANGE_RATES[currency] || EXCHANGE_RATES['USD'];
  return parseFloat((amount * rate).toFixed(2));
};

// Helper to calculate percentile
const percentile = (arr, p) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;
  
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

// Sophisticated dividend calculation with outlier detection (matches Streamlit logic)
const calculateRegularDividend = async (ticker) => {
  try {
    const response = await axios.get(`${STOCK_API_URL}/api/dividend/${ticker}`, {
      timeout: 5000
    });
    
    if (!response.data) return 0.0;
    
    const divData = response.data;
    const info = divData.info || {};
    
    // METHOD 1: Forward Dividend Rate (most reliable)
    if (info.dividendRate && info.dividendRate > 0) {
      return parseFloat(info.dividendRate);
    }
    
    // METHOD 2: Trailing Dividend Yield
    if (info.trailingAnnualDividendYield && info.currentPrice && info.currentPrice > 0) {
      const trailingDividend = info.trailingAnnualDividendYield * info.currentPrice;
      if (trailingDividend > 0) {
        return parseFloat(trailingDividend);
      }
    }
    
    // METHOD 3: Calculate from history with outlier detection (IQR method)
    const dividends = divData.dividends;
    if (dividends && Array.isArray(dividends) && dividends.length >= 4) {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      const lastYearDivs = dividends.filter(div => {
        const divDate = new Date(div.date || div.exDate);
        return divDate > oneYearAgo;
      }).map(div => parseFloat(div.amount || div.value || 0));
      
      if (lastYearDivs.length >= 2) {
        // IQR outlier detection
        const q1 = percentile(lastYearDivs, 25);
        const q3 = percentile(lastYearDivs, 75);
        const iqr = q3 - q1;
        
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;
        
        const regularDivs = lastYearDivs.filter(d => d >= lowerBound && d <= upperBound);
        
        if (regularDivs.length > 0) {
          return parseFloat(regularDivs.reduce((a, b) => a + b, 0).toFixed(4));
        }
      }
    }
    
    // METHOD 4: Last 4 quarters fallback
    if (dividends && Array.isArray(dividends) && dividends.length >= 4) {
      const last4 = dividends.slice(-4).map(d => parseFloat(d.amount || d.value || 0));
      const medianVal = percentile(last4, 50);
      const regularVals = last4.filter(d => d < medianVal * 2.5);
      
      if (regularVals.length >= 3) {
        return parseFloat((regularVals.reduce((a, b) => a + b, 0) * (4 / regularVals.length)).toFixed(4));
      }
    }
    
    return 0.0;
  } catch (error) {
    console.warn(`Error calculating dividend for ${ticker}:`, error.message);
    return 0.0;
  }
};

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

// Get dividend summary with sophisticated calculations
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    
    // Calculate expected dividends from holdings using sophisticated logic
    const portfolio = await Portfolio.find();
    const expectedDividendsList = [];
    let estimatedAnnualDividend = 0;
    let monthlyAverage = 0;

    for (const stock of portfolio) {
      try {
        // Use sophisticated dividend calculation
        const annualDividendPerShare = await calculateRegularDividend(stock.ticker);
        
        if (annualDividendPerShare && annualDividendPerShare > 0) {
          const shares = parseFloat(stock.shares) || 0;
          const totalDividend = annualDividendPerShare * shares;
          const currency = stock.currency || 'USD';
          const dividendInDKK = convertToDKK(totalDividend, currency);
          
          estimatedAnnualDividend += dividendInDKK;
          
          // Create or update expected dividend record
          let dividend = await Dividend.findOne({
            ticker: stock.ticker,
            status: 'EXPECTED'
          });

          if (dividend) {
            dividend.amountPerShare = annualDividendPerShare;
            dividend.totalAmount = dividendInDKK;
            dividend.shares = shares;
            dividend.currency = 'DKK';
            await dividend.save();
          } else {
            // Estimate next payment date (typically 3-4 months out)
            const estimatedExDate = new Date(now);
            estimatedExDate.setMonth(estimatedExDate.getMonth() + 3);
            const estimatedPayDate = new Date(estimatedExDate);
            estimatedPayDate.setMonth(estimatedPayDate.getMonth() + 1);
            
            dividend = new Dividend({
              ticker: stock.ticker,
              amountPerShare: annualDividendPerShare,
              totalAmount: dividendInDKK,
              currency: 'DKK',
              exDate: estimatedExDate,
              paymentDate: estimatedPayDate,
              shares: shares,
              status: 'EXPECTED',
              notes: `Estimated annual: ${annualDividendPerShare.toFixed(4)}/share × ${shares} shares = ${dividendInDKK.toFixed(2)} DKK`
            });
            await dividend.save();
          }
          expectedDividendsList.push(dividend);
        }
      } catch (error) {
        console.warn(`Could not calculate dividend for ${stock.ticker}:`, error.message);
      }
    }

    monthlyAverage = parseFloat((estimatedAnnualDividend / 12).toFixed(2));

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
    }).sort({ paymentDate: -1 });

    const expectedTotal = parseFloat(estimatedAnnualDividend.toFixed(2));
    
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
      estimatedAnnualDividend: expectedTotal,
      monthlyAverage: monthlyAverage,
      expectedTotal: parseFloat(expectedTotal.toFixed(2)),
      expectedCount: allExpectedDividends.length,
      receivedTotal: parseFloat(receivedTotal.toFixed(2)),
      receivedCount: receivedDividends.length,
      thisYearTotal: parseFloat(thisYearTotal.toFixed(2)),
      dividends: {
        expected: allExpectedDividends.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)),
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
