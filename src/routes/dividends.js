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

// Sophisticated dividend calculation with outlier detection (matches Streamlit logic)
const calculateRegularDividend = async (ticker) => {
  try {
    const response = await axios.get(`${STOCK_API_URL}/api/dividend/${ticker}`, {
      timeout: 5000
    });
    
    if (!response.data) return 0.0;
    
    // Python API returns: { ticker, annualDividend, currency, dividendYield }
    const annualDividend = parseFloat(response.data.annualDividend) || 0;
    
    if (annualDividend && annualDividend > 0) {
      return annualDividend;
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
    console.log(`[DIVIDENDS] Found ${portfolio.length} stocks in portfolio`);
    
    const expectedDividendsList = [];
    let estimatedAnnualDividend = 0;
    let monthlyAverage = 0;

    for (const stock of portfolio) {
      try {
        console.log(`[DIVIDENDS] Calculating dividend for ${stock.ticker} (${stock.shares} shares)`);
        
        // Use sophisticated dividend calculation
        const annualDividendPerShare = await calculateRegularDividend(stock.ticker);
        console.log(`[DIVIDENDS] ${stock.ticker}: ${annualDividendPerShare}/share`);
        
        if (annualDividendPerShare && annualDividendPerShare > 0) {
          const shares = parseFloat(stock.shares) || 0;
          const totalDividend = annualDividendPerShare * shares;
          const currency = stock.currency || 'USD';
          const dividendInDKK = convertToDKK(totalDividend, currency);
          
          console.log(`[DIVIDENDS] ${stock.ticker}: ${totalDividend} ${currency} = ${dividendInDKK} DKK`);
          estimatedAnnualDividend += dividendInDKK;
          
          // Default dates
          let exDate = new Date(now);
          exDate.setMonth(exDate.getMonth() + 3);
          let payDate = new Date(exDate);
          payDate.setMonth(payDate.getMonth() + 1);
          
          // Try to get real dates from API
          try {
            const divResponse = await axios.get(`${STOCK_API_URL}/api/dividend/${stock.ticker}`, {
              timeout: 5000
            });
            
            if (divResponse.data.nextExDate) {
              try {
                exDate = new Date(divResponse.data.nextExDate);
                console.log(`[DIVIDENDS] ${stock.ticker} ex-date: ${exDate.toISOString()}`);
              } catch (e) {
                console.warn(`Could not parse exDate for ${stock.ticker}`);
              }
            }
            
            if (divResponse.data.nextPayDate) {
              try {
                payDate = new Date(divResponse.data.nextPayDate);
                console.log(`[DIVIDENDS] ${stock.ticker} pay-date: ${payDate.toISOString()}`);
              } catch (e) {
                console.warn(`Could not parse payDate for ${stock.ticker}`);
              }
            }
          } catch (apiError) {
            console.warn(`Could not fetch dividend dates for ${stock.ticker}`);
          }
          
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
            dividend.exDate = exDate;
            dividend.paymentDate = payDate;
            await dividend.save();
          } else {
            dividend = new Dividend({
              ticker: stock.ticker,
              amountPerShare: annualDividendPerShare,
              totalAmount: dividendInDKK,
              currency: 'DKK',
              exDate: exDate,
              paymentDate: payDate,
              shares: shares,
              status: 'EXPECTED',
              notes: `Estimated annual: ${annualDividendPerShare.toFixed(4)}/share × ${shares} shares = ${dividendInDKK.toFixed(2)} DKK`
            });
            await dividend.save();
          }
          expectedDividendsList.push(dividend);
        }
      } catch (error) {
        console.error(`[DIVIDENDS ERROR] Could not calculate dividend for ${stock.ticker}:`, error.message);
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
