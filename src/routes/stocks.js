const express = require('express');
const axios = require('axios');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const STOCK_API_URL = process.env.STOCK_API_URL || 'http://localhost:5001';

// Get single stock data
router.get('/:ticker', authMiddleware, async (req, res) => {
  try {
    const { ticker } = req.params;

    const response = await axios.get(`${STOCK_API_URL}/api/stock/${ticker}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch stock data for ${ticker}` });
  }
});

// Get batch stock data
router.post('/batch-price', async (req, res) => {
  try {
    const { tickers } = req.body;

    if (!tickers || tickers.length === 0) {
      return res.status(400).json({ error: 'No tickers provided' });
    }

    const response = await axios.post(`${STOCK_API_URL}/api/batch-price`, {
      tickers
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch batch stock data' });
  }
});

// Get exchange rate
router.get('/rate/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;

    const response = await axios.get(
      `${STOCK_API_URL}/api/exchange-rate/${from}/${to}`
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch exchange rate` });
  }
});

// Get dividend for stock
router.get('/dividend/:ticker', authMiddleware, async (req, res) => {
  try {
    const { ticker } = req.params;

    const response = await axios.get(
      `${STOCK_API_URL}/api/dividend/${ticker}`
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch dividend data for ${ticker}` });
  }
});

module.exports = router;
