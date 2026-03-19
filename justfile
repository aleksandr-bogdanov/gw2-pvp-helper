# GW2 PvP Helper

# Start everything: db + schema + dev server
up:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! docker info > /dev/null 2>&1; then
        echo "ERROR: Docker is not running. Start Docker Desktop first."
        exit 1
    fi
    if ! docker compose ps --status running | grep -q postgres; then
        echo "Starting Postgres..."
        docker compose up -d
        sleep 2
        echo "Pushing schema..."
        bunx drizzle-kit push
    fi
    bun run dev -- --host

# Start Postgres only
db:
    docker compose up -d

# Stop Postgres
db-stop:
    docker compose down

# Push schema to database
db-push:
    bunx drizzle-kit push

# Generate Drizzle migration
db-generate:
    bunx drizzle-kit generate

# Open Drizzle Studio (DB GUI)
db-studio:
    bunx drizzle-kit studio

# Reset database (destroy volume, recreate, push schema)
db-reset:
    docker compose down -v
    docker compose up -d
    sleep 2
    bunx drizzle-kit push

# Run all tests
test *ARGS:
    bun run test {{ARGS}}

# Run tests in watch mode
test-watch:
    bun run test:watch

# Run scan accuracy tests against real screenshots
test-scan *ARGS:
    bun tsx tests/scan-accuracy.ts {{ARGS}}

# Type check
check:
    bun run check

# Build for production
build:
    bun run build

# Preview production build locally
preview:
    bun run preview

# Install dependencies
install:
    bun install

# Fetch latest GW2 API data (weapon skills)
fetch-api:
    bun run fetch-api

# Database backup (local, saves to ./backups/)
backup:
    #!/usr/bin/env bash
    set -euo pipefail
    source .env
    mkdir -p backups
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    pg_dump "${DATABASE_URL}" | gzip > "backups/gw2-${TIMESTAMP}.sql.gz"
    echo "Backup saved to backups/gw2-${TIMESTAMP}.sql.gz"

# Show database connection info
db-info:
    #!/usr/bin/env bash
    source .env
    echo "DATABASE_URL: ${DATABASE_URL}"
    echo ""
    docker compose ps

# Logs from Postgres container
db-logs:
    docker compose logs -f postgres

# Clean build artifacts
clean:
    rm -rf build .svelte-kit node_modules/.vite
