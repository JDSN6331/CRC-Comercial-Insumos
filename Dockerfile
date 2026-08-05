# ============================================
# CRC Comercial Insumos — Production Dockerfile
# Optimized for Easypanel deployment
# ============================================

# Stage 1: Build frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app

# Install production dependencies only + tsx
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server source (tsx runs TypeScript directly)
COPY server/ ./server/

# Copy system prompt file
COPY ["SYSTEM PROMPT - Assistente do Salesforce.txt", "./"]

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
