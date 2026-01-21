# Portfolio Tracker Backend - Node.js

## Issues Fixed

### 1. **Container Shutdown Cycle**
**Root Cause**: Multiple issues combined:
- Health check running before server was fully initialized
- Missing environment variables causing startup delays
- External API calls without timeouts (hanging indefinitely)
- MongoDB connection errors not handled gracefully

**Fixes Applied**:
- ✅ Increased startup grace period to 20s in health check
- ✅ Moved health check logging inside `app.listen()` callback
- ✅ Added 5-second timeout to external API calls
- ✅ Made MongoDB connection optional (app continues without DB)
- ✅ Added graceful shutdown handler that checks MongoDB connection state

### 2. **External API Integration Issues**
**Root Cause**: Portfolio routes calling external API (stock price service) without timeout

**Fixes Applied**:
- ✅ Added axios instance with 5-second timeout
- ✅ All API errors now log warnings instead of errors
- ✅ Falls back to buy price if API is unavailable

### 3. **Missing Environment Variables**
**Root Cause**: Required variables not set in Docker

**Fixes Applied**:
- ✅ Added default values for all required environment variables
- ✅ Added warnings for insecure defaults in production
- ✅ Updated `.env.example` with all required variables
- ✅ Added PORT configuration to Dockerfile

## Environment Variables (Required)

Create a `.env` file or pass these as Docker environment variables:

```
NODE_ENV=production
PORT=8080
MONGODB_URI=mongodb://user:pass@mongodb:27017/portfolio-tracker
JWT_SECRET=generate-a-secure-random-string
FRONTEND_URL=http://localhost:3000
STOCK_API_URL=http://stock-api:5001  # Optional - for real-time prices
```

## Running with Docker

```bash
docker build -t portfolio-tracker:latest .
docker run -d \
  -p 8080:8080 \
  -e MONGODB_URI=mongodb://mongodb:27017/portfolio-tracker \
  -e JWT_SECRET=your-secure-key \
  portfolio-tracker:latest
```

## Health Check
- Endpoint: `GET /health`
- Returns: `{ status: "OK", timestamp: "ISO-8601-date" }`
- Grace period: 20 seconds after startup
- Interval: Every 30 seconds
- Timeout: 10 seconds per check

## Graceful Shutdown
- Listens for SIGTERM and SIGINT signals
- Closes HTTP server first
- Disconnects MongoDB (if connected)
- Force exits after 30 seconds if cleanup takes too long
