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
COPY "SYSTEM PROMPT - Assistente do Salesforce.txt" ./

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/auth/me || exit 1

CMD ["npx", "tsx", "server/index.ts"]
