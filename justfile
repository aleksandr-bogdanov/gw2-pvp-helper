# GW2 PvP Helper

# Start dev server (accessible on local network)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    # Ensure Docker is running
    if ! docker info > /dev/null 2>&1; then
        echo "ERROR: Docker is not running. Start Docker Desktop first."
        exit 1
    fi
    # Ensure Postgres container is up
    if ! docker compose ps --status running | grep -q postgres; then
        echo "Starting Postgres..."
        docker compose up -d
        sleep 2
        echo "Pushing schema..."
        npx drizzle-kit push
    fi
    npm run dev -- --host

# Start Postgres
db:
    docker compose up -d

# Stop Postgres
db-stop:
    docker compose down

# Generate Drizzle migration
db-generate:
    npx drizzle-kit generate

# Push schema to database
db-push:
    npx drizzle-kit push

# Open Drizzle Studio
db-studio:
    npx drizzle-kit studio

# Type check
check:
    npm run check

# Build for production
build:
    npm run build

# Preview production build
preview:
    npm run preview

# Install dependencies
install:
    npm install

# Start everything (db + dev)
up: db dev

# Reset database (recreate container)
db-reset:
    docker compose down -v
    docker compose up -d
    sleep 2
    npx drizzle-kit push

# Run scan accuracy tests against real screenshots
test-scan *ARGS:
    npx tsx tests/scan-accuracy.ts {{ARGS}}

# Save a screenshot as test fixture
save-fixture NAME PATH:
    npx tsx tests/save-fixture.ts {{NAME}} {{PATH}}
