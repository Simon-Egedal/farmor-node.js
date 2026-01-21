FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY src ./src

EXPOSE 5000

# Set environment variables with defaults
ENV NODE_ENV=production
ENV PORT=5000
# JWT_SECRET and MONGODB_URI should be provided at runtime, but set safe defaults
ENV JWT_SECRET=${JWT_SECRET:-71a4f0688391ff56b7af27d67c475da98fc9a860d605d04c04c5616bd3c55c67}
ENV MONGODB_URI=${MONGODB_URI:-mongodb+srv://webapp:Sve100909.@portfolio.w8ciaqr.mongodb.net/?appName=portfolio}
ENV STOCK_API_URL=${STOCK_API_URL:-https://farmor-aktier-production.up.railway.app}

# Remove aggressive health check - let container orchestration handle it
# HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=2 \
#   CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "src/index.js"]
