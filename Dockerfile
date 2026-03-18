FROM node:20-alpine AS builder

WORKDIR /app

# Install bun for fast package management
RUN npm install -g bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Install heavy OTel packages AFTER build so they don't slow Vite analysis.
# These are only needed at runtime when HONEYCOMB_API_KEY is set.
RUN bun add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto \
    @opentelemetry/instrumentation-http @opentelemetry/instrumentation-pg

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Data files for server-side scan fallback + prompt templates
COPY --from=builder /app/data ./data

# Railway volume mount point for training screenshots
RUN mkdir -p /app/screenshots

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["node", "build/index.js"]
