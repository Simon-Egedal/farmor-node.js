const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolio');
const stockRoutes = require('./routes/stocks');
const dividendRoutes = require('./routes/dividends');
const cashRoutes = require('./routes/cash');

// Initialize app
const app = express();

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('✗ Uncaught Exception:', err);
  process.exit(1);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('✗ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Security middleware
app.use(helmet());
app.use(morgan('combined'));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
console.log('[INFO] Attempting MongoDB connection...');
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✓ MongoDB connected');
})
.catch(err => {
  console.error('✗ MongoDB connection error:', err.message);
  // Don't exit - app can still serve requests
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/dividends', dividendRoutes);
app.use('/api/cash', cashRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`[INFO] Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('[INFO] Application ready to receive requests');
});

// Track connections
let activeConnections = 0;
server.on('connection', (conn) => {
  activeConnections++;
  console.log(`[INFO] Connection established (${activeConnections} active)`);
  conn.on('close', () => {
    activeConnections--;
    console.log(`[INFO] Connection closed (${activeConnections} active)`);
  });
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n[INFO] ${signal} received, shutting down gracefully...`);
  server.close(async () => {
    console.log('[INFO] Server closed');
    try {
      await mongoose.connection.close();
      console.log('[INFO] MongoDB connection closed');
      process.exit(0);
    } catch (err) {
      console.error('[ERROR] Error closing MongoDB:', err.message);
      process.exit(1);
    }
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('[ERROR] Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Keep process alive
setInterval(() => {
  console.log(`[HEALTH] App is alive - ${new Date().toISOString()}`);
}, 30000);

module.exports = app;
