FROM node:22-alpine AS builder

WORKDIR /app

# Install bun for fast package management
RUN npm install -g bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

# --- Production stage ---
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Drizzle migrate runs as pre-deploy command (railway.toml)
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/lib/server/db/schema.ts ./src/lib/server/db/schema.ts
COPY --from=builder /app/scripts/bootstrap-migrations.mjs ./scripts/bootstrap-migrations.mjs

# Data files for prompt templates + reference icons
COPY --from=builder /app/data ./data

# Railway volume mount point for training screenshots
RUN mkdir -p /app/screenshots

ENV NODE_ENV=production
ENV PORT=3000
ENV SCREENSHOTS_DIR=/app/screenshots
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["node", "build/index.js"]
