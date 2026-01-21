/**
 * Currency Converter Utility
 * Handles conversion of prices from multiple currencies to DKK
 */

const axios = require('axios');

const STOCK_API_URL = process.env.STOCK_API_URL || 'http://localhost:5001';

// Cache for exchange rates (in-memory, update every hour)
let exchangeRateCache = {
  rates: {},
  lastUpdate: 0
};

const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Exchange rates fallback (if API fails)
const FALLBACK_RATES = {
  DKK: 1,
  USD: 6.8,
  EUR: 7.5,
  GBP: 8.5,
  SEK: 0.65,
  NOK: 0.65,
  CHF: 7.6
};

/**
 * Get exchange rate from a currency to DKK
 * @param {string} fromCurrency - Currency code (e.g., 'USD', 'EUR')
 * @returns {number} Exchange rate to DKK
 */
const getExchangeRate = async (fromCurrency) => {
  if (!fromCurrency || fromCurrency === 'DKK') {
    return 1;
  }

  // Check cache
  const now = Date.now();
  if (exchangeRateCache.lastUpdate > now - CACHE_DURATION && exchangeRateCache.rates[fromCurrency]) {
    return exchangeRateCache.rates[fromCurrency];
  }

  try {
    // Try to fetch from stock API
    const response = await axios.get(
      `${STOCK_API_URL}/api/exchange-rate/DKK/${fromCurrency}`,
      { timeout: 3000 }
    );
    
    const rate = response.data.rate || FALLBACK_RATES[fromCurrency];
    
    // Update cache
    exchangeRateCache.rates[fromCurrency] = rate;
    exchangeRateCache.lastUpdate = now;
    
    return rate;
  } catch (error) {
    console.warn(`[WARN] Failed to fetch exchange rate for ${fromCurrency}:`, error.message);
    
    // Use fallback rate
    const fallbackRate = FALLBACK_RATES[fromCurrency] || 1;
    exchangeRateCache.rates[fromCurrency] = fallbackRate;
    exchangeRateCache.lastUpdate = now;
    
    return fallbackRate;
  }
};

/**
 * Convert amount from source currency to DKK
 * @param {number} amount - Amount in source currency
 * @param {string} fromCurrency - Source currency code
 * @returns {Promise<number>} Amount converted to DKK
 */
const convertToDKK = async (amount, fromCurrency) => {
  if (!amount || amount < 0) return 0;
  
  const rate = await getExchangeRate(fromCurrency);
  return parseFloat((amount * rate).toFixed(2));
};

/**
 * Convert multiple prices at once
 * @param {Array} items - Array of items with price and currency
 * @param {string} priceField - Field name containing the price
 * @param {string} currencyField - Field name containing the currency
 * @returns {Promise<Array>} Items with added dkkPrice field
 */
const convertPricesToDKK = async (items, priceField = 'price', currencyField = 'currency') => {
  try {
    const converted = await Promise.all(
      items.map(async (item) => {
        const price = item[priceField];
        const currency = item[currencyField] || 'DKK';
        const dkkPrice = await convertToDKK(price, currency);
        
        return {
          ...item,
          dkkPrice,
          originalPrice: price,
          originalCurrency: currency
        };
      })
    );
    
    return converted;
  } catch (error) {
    console.error('[ERROR] Error converting prices to DKK:', error.message);
    return items;
  }
};

/**
 * Clear exchange rate cache
 */
const clearCache = () => {
  exchangeRateCache = {
    rates: {},
    lastUpdate: 0
  };
};

module.exports = {
  getExchangeRate,
  convertToDKK,
  convertPricesToDKK,
  clearCache,
  FALLBACK_RATES
};
