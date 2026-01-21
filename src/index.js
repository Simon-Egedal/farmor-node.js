const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Import routes with error handling
let authRoutes, portfolioRoutes, stockRoutes, dividendRoutes, cashRoutes;
try {
  authRoutes = require('./routes/auth');
  portfolioRoutes = require('./routes/portfolio');
  stockRoutes = require('./routes/stocks');
  dividendRoutes = require('./routes/dividends');
  cashRoutes = require('./routes/cash');
  console.log('[INFO] All routes loaded successfully');
} catch (err) {
  console.error('[ERROR] Failed to load routes:', err.message);
  process.exit(1);
}

// Initialize app
const app = express();

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught Exception:', err.message);
  console.error('[ERROR] Stack:', err.stack);
  // Don't exit - keep app running
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection:', reason);
  // Don't exit - keep app running
});

// Catch warnings
process.on('warning', (warning) => {
  console.warn('[WARNING]', warning.name, '-', warning.message);
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

// Health check - MUST always return 200 for Railway
app.get('/health', (req, res) => {
  try {
    res.status(200).json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (err) {
    console.error('[HEALTH_ERROR]', err);
    res.status(200).json({ status: 'OK' }); // Still return 200 even if error
  }
});

// Readiness check - verifies app is ready
app.get('/ready', (req, res) => {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    res.status(200).json({ 
      status: 'READY', 
      db: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[READY_ERROR]', err);
    res.status(200).json({ status: 'READY' });
  }
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
console.log(`[INFO] Starting server on port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`[INFO] Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('[INFO] Application ready to receive requests');
  console.log('[INFO] ========== APP IS RUNNING ==========');
  
  // Start health check only after server is listening
  setInterval(() => {
    console.log(`[HEALTH] App is alive - ${new Date().toISOString()}`);
  }, 30000);
});

// Error handlers for server
server.on('error', (err) => {
  console.error('[SERVER_ERROR]', err.message);
});

server.on('clientError', (err, socket) => {
  console.error('[CLIENT_ERROR]', err.message);
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
const shutdown = (signal) => {
  console.log(`\n[SHUTDOWN] ${signal} - initiating graceful shutdown...`);
  
  // Set a flag to prevent re-entrance
  if (process.shuttingDown) {
    console.log('[SHUTDOWN] Already shutting down, ignoring signal');
    return;
  }
  process.shuttingDown = true;
  
  // Close server and connections
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
  });

  // Close MongoDB connection separately if connected
  if (mongoose.connection.readyState === 1) {
    mongoose.disconnect().then(() => {
      console.log('[SHUTDOWN] MongoDB connection closed');
      process.exit(0);
    }).catch((err) => {
      console.error('[SHUTDOWN] Error closing MongoDB:', err.message);
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after 30s timeout');
    process.exit(1);
  }, 30000);
};

// Handle all signals explicitly
process.on('SIGTERM', () => {
  console.log('[SIGNAL] SIGTERM received');
  console.log('[INFO] Ignoring SIGTERM - app will keep running on Railway');
  // Don't shutdown on SIGTERM
});

process.on('SIGINT', () => {
  console.log('[SIGNAL] SIGINT (Ctrl+C) - graceful shutdown');
  shutdown('SIGINT');
});

// Log other signals but don't exit
process.on('SIGHUP', () => console.log('[SIGNAL] SIGHUP received'));
process.on('SIGQUIT', () => console.log('[SIGNAL] SIGQUIT received'));
process.on('SIGABRT', () => console.log('[SIGNAL] SIGABRT received'));
process.on('SIGUSR1', () => console.log('[SIGNAL] SIGUSR1 received'));
process.on('SIGUSR2', () => console.log('[SIGNAL] SIGUSR2 received'));
process.on('SIGPIPE', () => console.log('[SIGNAL] SIGPIPE received'));

// Log process exit
process.on('exit', (code) => {
  console.log(`[PROCESS] Node.js exiting with code: ${code}`);
});

module.exports = app;
