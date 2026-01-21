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
  timeout: 5000 // 5 second timeout to prevent hanging
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

// Helper function to get exchange rate with timeout
const getExchangeRate = async () => {
  try {
    const response = await apiClient.get(`${STOCK_API_URL}/api/exchange-rate/USD/DKK`);
    return response.data.rate || 6.5; // Default rate if API fails
  } catch (error) {
    console.warn('[WARN] Error fetching exchange rate:', error.message);
    return 6.5; // Default USD/DKK rate
  }
};

// Helper function to determine stock currency from ticker
const getCurrencyFromTicker = (ticker) => {
  if (ticker.includes('.CO')) return 'DKK';   // Copenhagen
  if (ticker.includes('.ST')) return 'SEK';   // Stockholm
  if (ticker.includes('.OL')) return 'NOK';   // Oslo
  if (ticker.includes('.HE')) return 'EUR';   // Helsinki
  if (ticker.includes('.SW')) return 'CHF';   // Swiss
  return 'USD'; // Default to USD
};

// Helper function to enrich portfolio with real-time prices in DKK
const enrichPortfolioWithPrices = async (stocks) => {
  const tickers = stocks.map(s => s.ticker);
  
  try {
    // Fetch prices
    const priceResponse = await apiClient.post(`${STOCK_API_URL}/api/batch-price`, { tickers });
    const priceData = priceResponse.data;
    
    return await Promise.all(stocks.map(async (stock) => {
      const priceInStockCurrency = priceData[stock.ticker]?.price || 0;
      
      // Determine the currency of the stock based on ticker
      const stockCurrency = getCurrencyFromTicker(stock.ticker);
      
      // Convert to DKK if not already DKK
      const currentPriceDKK = await convertToDKK(priceInStockCurrency, stockCurrency);
      const buyPriceDKK = await convertToDKK(stock.buyPrice, stock.currency || stockCurrency);
      
      const cost = buyPriceDKK * stock.shares;
      const currentValue = currentPriceDKK * stock.shares;
      const gain = currentValue - cost;
      const gainPercent = cost > 0 ? ((gain / cost) * 100).toFixed(2) : 0;
      
      return {
        ...stock.toObject(),
        currentPrice: parseFloat(currentPriceDKK.toFixed(2)),
        currentValue: parseFloat(currentValue.toFixed(2)),
        gain: parseFloat(gain.toFixed(2)),
        gainPercent: parseFloat(gainPercent),
        currency: 'DKK',
        stockNativeCurrency: stockCurrency
      };
    }));
  } catch (error) {
    console.warn('[WARN] Error fetching prices:', error.message);
    // Return stocks with buy price as current price if API fails
    return stocks.map(stock => ({
      ...stock.toObject(),
      currentPrice: stock.buyPrice,
      currentValue: stock.buyPrice * stock.shares,
      gain: 0,
      gainPercent: 0,
      currency: 'DKK'
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

    // If user chose to deduct from cash, create a cash withdrawal in DKK
    if (deductFromCash) {
      try {
        // Get exchange rate
        const exchangeRate = await getExchangeRate();
        
        // Convert cost to DKK
        const costUSD = parseFloat(shares) * parseFloat(buyPrice);
        const costDKK = costUSD * exchangeRate;
        
        const cashTransaction = new Cash({
          amount: costDKK,
          type: 'WITHDRAWAL',
          description: `Stock purchase: ${ticker.toUpperCase()} - ${parseFloat(shares)} shares @ ${parseFloat(buyPrice)} USD (${costDKK.toFixed(2)} DKK)`
        });
        await cashTransaction.save();
      } catch (error) {
        console.error('Error deducting from cash:', error.message);
      }
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
    const sellPriceUSD = sellPrice ? parseFloat(sellPrice) : portfolio.buyPrice;
    
    if (sharesToSell > portfolio.shares) {
      return res.status(400).json({ error: 'Cannot sell more shares than you own' });
    }

    // Get exchange rate and convert to DKK
    const exchangeRate = await getExchangeRate();
    const sellPriceDKK = sellPriceUSD * exchangeRate;
    const saleProceeds = sharesToSell * sellPriceDKK;

    // Create cash transaction for sale proceeds in DKK
    const cashTransaction = new Cash({
      amount: parseFloat(saleProceeds.toFixed(2)),
      type: 'SALE',
      description: `Sale of ${sharesToSell} shares of ${portfolio.ticker} @ ${sellPriceUSD.toFixed(2)} USD = ${sellPriceDKK.toFixed(2)} DKK/share`,
      date: new Date()
    });
    await cashTransaction.save();

    // Create transaction record
    const transaction = new Transaction({
      ticker: portfolio.ticker,
      type: 'SELL',
      shares: sharesToSell,
      price: sellPriceUSD,
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
        shares: sharesToSell,
        currency: 'DKK'
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
