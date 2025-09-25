# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Install system dependencies
RUN apk add --no-cache \
    curl \
    tzdata \
    bash

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application files
COPY . .

# Create necessary directories
RUN mkdir -p logs downloads && \
    chown -R nextjs:nodejs /app

# Set timezone (can be overridden with environment variable)
ENV TZ=UTC

# Expose health check port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

# Switch to non-root user
USER nextjs

# Set entrypoint
ENTRYPOINT ["node", "container-entrypoint.js"]
