FROM node:18-alpine

WORKDIR /app

# Install wget for health checks
RUN apk add --no-cache wget

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY src ./src

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

# Health check with longer timeout and startup grace period
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=2 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "src/index.js"]
