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

// Log all signals to identify what's stopping the container
process.on('SIGHUP', () => console.log('[SIGNAL] SIGHUP received'));
process.on('SIGQUIT', () => console.log('[SIGNAL] SIGQUIT received'));
process.on('SIGABRT', () => console.log('[SIGNAL] SIGABRT received'));
process.on('SIGALRM', () => console.log('[SIGNAL] SIGALRM received'));
process.on('SIGUSR1', () => console.log('[SIGNAL] SIGUSR1 received'));
process.on('SIGUSR2', () => console.log('[SIGNAL] SIGUSR2 received'));

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
if (!process.env.MONGODB_URI) {
  console.warn('[WARN] MONGODB_URI not set, continuing without database...');
} else {
  mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('✓ MongoDB connected');
  })
  .catch(err => {
    console.error('✗ MongoDB connection error:', err.message);
  });
}

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
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`[INFO] Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('[INFO] Application ready to receive requests');
  
  // Start health check only after server is listening
  setInterval(() => {
    console.log(`[HEALTH] App is alive - ${new Date().toISOString()}`);
  }, 30000);
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

// Graceful shutdown with delay to prevent accidental restarts
const shutdown = (signal) => {
  console.log(`\n[INFO] ${signal} received, shutting down gracefully...`);
  
  // Set a flag to prevent re-entrance
  if (process.shuttingDown) {
    console.log('[INFO] Already shutting down, ignoring signal');
    return;
  }
  process.shuttingDown = true;
  
  // Close server and connections
  server.close(() => {
    console.log('[INFO] Server closed');
  });

  // Close MongoDB connection separately if connected
  if (mongoose.connection.readyState === 1) {
    mongoose.disconnect().then(() => {
      console.log('[INFO] MongoDB connection closed');
      process.exit(0);
    }).catch((err) => {
      console.error('[ERROR] Error closing MongoDB:', err.message);
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('[ERROR] Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Only shutdown on explicit signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log when these signals arrive but don't exit
process.on('SIGHUP', () => console.log('[SIGNAL] SIGHUP received - ignoring'));
process.on('SIGPIPE', () => console.log('[SIGNAL] SIGPIPE received - ignoring'));

module.exports = app;
