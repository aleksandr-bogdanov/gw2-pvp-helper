default:
    @just --list

# Start the dev server
dev:
    uv run uvicorn app:app --reload --host 0.0.0.0 --port 5000

# Scrape MetaBattle for current builds
scrape:
    uv run python -m scraper.metabattle

# Enrich scraped builds with counter strategies
enrich:
    uv run python -m scraper.enrich

# Run tests
test:
    uv run pytest tests/ -v

# Initialize the database
init-db:
    uv run python -c "import asyncio; from db.database import init_db; asyncio.run(init_db())"

# Scrape and enrich in one step
update: scrape enrich
