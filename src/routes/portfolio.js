const express = require('express');
const axios = require('axios');
const Portfolio = require('../models/Portfolio');
const Transaction = require('../models/Transaction');
const Cash = require('../models/Cash');
const { authMiddleware } = require('../middleware/auth');
const { convertToDKK } = require('../utils/currencyConverter');

const router = express.Router();
const STOCK_API_URL = process.env.STOCK_API_URL || 'http://localhost:5001';

// Create axios instance with timeout
const apiClient = axios.create({
  timeout: 5000 // 5 second timeout
});

// Helper function to fetch current price for a ticker
const getCurrentPrice = async (ticker) => {
  try {
    const response = await apiClient.get(`${STOCK_API_URL}/api/stock/${ticker}`);
    return response.data.price || 0;
  } catch (error) {
    console.warn(`[WARN] Error fetching price for ${ticker}:`, error.message);
    return 0;
  }
};

// Helper function to enrich portfolio with real-time prices and convert to DKK
const enrichPortfolioWithPrices = async (stocks) => {
  const tickers = stocks.map(s => s.ticker);
  
  try {
    const response = await apiClient.post(`${STOCK_API_URL}/api/batch-price`, {
      tickers
    });
    
    const priceData = response.data;
    
    return await Promise.all(stocks.map(async (stock) => {
      const currentPrice = priceData[stock.ticker]?.price || 0;
      
      // Convert prices to DKK
      const buyPriceDKK = await convertToDKK(stock.buyPrice, stock.currency);
      const currentPriceDKK = await convertToDKK(currentPrice, stock.currency);
      
      const cost = buyPriceDKK * stock.shares;
      const currentValue = currentPriceDKK * stock.shares;
      const gain = currentValue - cost;
      const gainPercent = cost > 0 ? ((gain / cost) * 100).toFixed(2) : 0;
      
      return {
        ...stock.toObject(),
        // Original prices
        originalPrice: currentPrice,
        originalBuyPrice: stock.buyPrice,
        originalCurrency: stock.currency,
        // DKK prices
        currentPriceDKK: parseFloat(currentPriceDKK.toFixed(2)),
        buyPriceDKK: parseFloat(buyPriceDKK.toFixed(2)),
        costDKK: parseFloat(cost.toFixed(2)),
        currentValueDKK: parseFloat(currentValue.toFixed(2)),
        gainDKK: parseFloat(gain.toFixed(2)),
        gainPercent: parseFloat(gainPercent)
      };
    }));
  } catch (error) {
    console.warn('[WARN] Error fetching prices:', error.message);
    // Return stocks with buy price as current price if API fails
    return await Promise.all(stocks.map(async (stock) => {
      const buyPriceDKK = await convertToDKK(stock.buyPrice, stock.currency);
      
      return {
        ...stock.toObject(),
        originalPrice: stock.buyPrice,
        originalBuyPrice: stock.buyPrice,
        originalCurrency: stock.currency,
        currentPriceDKK: buyPriceDKK,
        buyPriceDKK,
        costDKK: parseFloat((buyPriceDKK * stock.shares).toFixed(2)),
        currentValueDKK: parseFloat((buyPriceDKK * stock.shares).toFixed(2)),
        gainDKK: 0,
        gainPercent: 0
      };
    }));
  }
};

// Get all portfolio stocks with real-time prices
router.get('/', authMiddleware, async (req, res) => {
  try {
    const portfolio = await Portfolio.find().sort({ createdAt: -1 });
    const enriched = await enrichPortfolioWithPrices(portfolio);
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get portfolio summary with real-time calculations
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const portfolio = await Portfolio.find();
    const enriched = await enrichPortfolioWithPrices(portfolio);
    
    const totalCost = enriched.reduce((sum, stock) => {
      return sum + (stock.buyPrice * stock.shares);
    }, 0);
    
    const totalValue = enriched.reduce((sum, stock) => {
      return sum + stock.currentValue;
    }, 0);
    
    const totalGain = totalValue - totalCost;
    const gainPercent = totalCost > 0 ? ((totalGain / totalCost) * 100).toFixed(2) : 0;
    
    res.json({
      totalCost: parseFloat(totalCost.toFixed(2)),
      totalValue: parseFloat(totalValue.toFixed(2)),
      totalGain: parseFloat(totalGain.toFixed(2)),
      gainPercent: parseFloat(gainPercent),
      holdingsCount: enriched.length,
      stocks: enriched
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add stock to portfolio
// Add stock to portfolio (auto-detects currency from Stock API)
router.post('/add', authMiddleware, async (req, res) => {
  try {
    const { ticker, shares, buyPrice, buyDate, notes, deductFromCash } = req.body;

    if (!ticker || !shares || !buyPrice) {
      return res.status(400).json({ error: 'Missing required fields: ticker, shares, buyPrice' });
    }

    // Fetch stock data to get currency automatically
    let currency = 'USD'; // default fallback
    try {
      const response = await axios.get(`${STOCK_API_URL}/api/stock/${ticker.toUpperCase()}`);
      if (response.data && response.data.currency) {
        currency = response.data.currency;
      }
    } catch (error) {
      console.warn(`Could not fetch currency for ${ticker}, using default USD`);
    }

    const portfolio = new Portfolio({
      ticker: ticker.toUpperCase(),
      shares: parseFloat(shares),
      buyPrice: parseFloat(buyPrice),
      currency,
      buyDate: buyDate || new Date(),
      notes
    });

    await portfolio.save();

    // Also create transaction record
    const transaction = new Transaction({
      ticker: ticker.toUpperCase(),
      type: 'BUY',
      shares: parseFloat(shares),
      price: parseFloat(buyPrice),
      currency,
      transactionDate: buyDate || new Date()
    });

    await transaction.save();

    // If user chose to deduct from cash, create a cash withdrawal
    if (deductFromCash) {
      const cost = parseFloat(shares) * parseFloat(buyPrice);
      const cashTransaction = new Cash({
        amount: cost,
        type: 'WITHDRAWAL',
        description: `Stock purchase: ${ticker.toUpperCase()} - ${parseFloat(shares)} shares @ $${parseFloat(buyPrice)}`
      });
      await cashTransaction.save();
    }

    // Return with enriched price data
    const enriched = await enrichPortfolioWithPrices([portfolio]);

    res.status(201).json({
      message: 'Stock added to portfolio',
      portfolio: enriched[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update stock quantity
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { shares, notes } = req.body;

    const portfolio = await Portfolio.findByIdAndUpdate(
      req.params.id,
      { shares, notes },
      { new: true, runValidators: true }
    );

    if (!portfolio) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    // Enrich with current price
    const enriched = await enrichPortfolioWithPrices([portfolio]);
    
    res.json({
      message: 'Stock updated',
      portfolio: enriched[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove stock from portfolio (or sell partial)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { sellPrice, sellShares } = req.body;
    const portfolio = await Portfolio.findById(req.params.id);

    if (!portfolio) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    // If selling all or partial
    const sharesToSell = sellShares ? parseFloat(sellShares) : portfolio.shares;
    const currentPrice = sellPrice ? parseFloat(sellPrice) : portfolio.buyPrice;
    
    if (sharesToSell > portfolio.shares) {
      return res.status(400).json({ error: 'Cannot sell more shares than you own' });
    }

    const saleProceeds = sharesToSell * currentPrice;

    // Create cash transaction for sale proceeds
    const cashTransaction = new Cash({
      amount: parseFloat(saleProceeds.toFixed(2)),
      type: 'SALE',
      description: `Sale of ${sharesToSell} shares of ${portfolio.ticker} @ ${currentPrice.toFixed(2)}`,
      date: new Date()
    });
    await cashTransaction.save();

    // Create transaction record
    const transaction = new Transaction({
      ticker: portfolio.ticker,
      type: 'SELL',
      shares: sharesToSell,
      price: currentPrice,
      currency: portfolio.currency,
      transactionDate: new Date()
    });
    await transaction.save();

    // If selling all shares, delete the stock
    if (sharesToSell === portfolio.shares) {
      await Portfolio.findByIdAndDelete(req.params.id);
      res.json({ 
        message: 'Stock sold completely',
        proceeds: parseFloat(saleProceeds.toFixed(2)),
        shares: sharesToSell
      });
    } else {
      // Otherwise, update shares
      portfolio.shares -= sharesToSell;
      await portfolio.save();
      
      res.json({ 
        message: 'Partial sale recorded',
        proceeds: parseFloat(saleProceeds.toFixed(2)),
        sharesSold: sharesToSell,
        sharesRemaining: portfolio.shares
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update all stock prices from Stock API (no longer needed - fetched on-demand)
// Kept for backward compatibility and triggering price refreshes
router.post('/update-prices', authMiddleware, async (req, res) => {
  try {
    const portfolio = await Portfolio.find();
    
    if (portfolio.length === 0) {
      return res.json({ message: 'No stocks to update' });
    }

    const enriched = await enrichPortfolioWithPrices(portfolio);
    
    res.json({
      message: 'Prices fetched (not stored - calculated on-demand)',
      stocks: enriched
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get allocation breakdown with real-time prices
router.get('/allocation', authMiddleware, async (req, res) => {
  try {
    const portfolio = await Portfolio.find();
    const enriched = await enrichPortfolioWithPrices(portfolio);
    
    const allocation = enriched.map(stock => ({
      ticker: stock.ticker,
      value: stock.currentValue,
      shares: stock.shares,
      buyPrice: stock.buyPrice,
      currentPrice: stock.currentPrice,
      percentage: 0
    }));

    const totalValue = allocation.reduce((sum, item) => sum + item.value, 0);

    allocation.forEach(item => {
      item.percentage = totalValue > 0 ? ((item.value / totalValue) * 100).toFixed(2) : 0;
    });

    res.json(allocation.sort((a, b) => b.percentage - a.percentage));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
