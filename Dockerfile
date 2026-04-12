FROM node:20-alpine AS builder

WORKDIR /app

# Install bun for fast package management
RUN npm install -g bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# SvelteKit inlines $env/static/private at build time.
# Provide dummy values so the build succeeds — real values come from
# Railway env vars at runtime.
ARG DATABASE_URL=postgres://build:build@localhost:5432/build
ARG ANTHROPIC_API_KEY=sk-ant-build-dummy
ENV DATABASE_URL=$DATABASE_URL
ENV ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY

RUN bun run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Data files for prompt templates + reference icons
COPY --from=builder /app/data ./data

# Railway volume mount point for training screenshots
RUN mkdir -p /app/screenshots

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["node", "build/index.js"]
