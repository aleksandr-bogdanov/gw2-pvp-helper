# GW2 PvP Match Companion — Implementation Plan

## Context

Build a local Python web app used on a second laptop during GW2 PvP matches. It identifies enemy team compositions and provides instant TLDR strategies for S/D Daredevil Thief. All game data is data-driven (JSON files). Builds come **exclusively from live MetaBattle scraping** — no hardcoded build data. Uses `uv` for package management and `justfile` for task running.

### Key Architectural Separation: Factual vs Meta

Two distinct data layers:

1. **Factual game data** (slow-changing, patch-level updates):
   - Professions, elite specs, skills, stolen skills, do-not-hit mechanics
   - `data/game/` directory
   - Updated manually or via a separate skill scraper when expansions drop

2. **Meta data** (fast-changing, balance patch / weekly):
   - Builds, tier ratings, counter strategies, role classifications
   - `data/meta/` directory
   - Populated exclusively by MetaBattle scraper + enrichment
   - Re-run `just scrape` after any balance patch

3. **Player perspective** (future: tunable per build):
   - Currently hardcoded to S/D Daredevil in enrichment rules
   - Counter strategies are generated relative to the player's build
   - Future: configurable `data/my_build.json` that enrichment reads to generate perspective-specific counters for ANY build

---

## Phase 1: Project Scaffolding

**Files to create:**
- `.python-version` → `3.12`
- `pyproject.toml` → dependencies: fastapi, uvicorn, jinja2, aiosqlite, httpx, beautifulsoup4, pyyaml; dev: pytest, pytest-asyncio, httpx
- `justfile` → commands: `dev`, `scrape`, `enrich`, `test`, `init-db`
- `app.py` → FastAPI app with Jinja2 templates, static files, router registration, lifespan DB init
- `db/database.py` → aiosqlite helpers, schema init (players, matches tables)
- `routes/__init__.py` → empty

**SQLite schema (`db/players.db`):**
```sql
CREATE TABLE players (
    id INTEGER PRIMARY KEY,
    account_name TEXT UNIQUE NOT NULL,
    nickname TEXT,
    threat_level INTEGER DEFAULT 0,
    notes TEXT,
    last_seen TEXT,
    last_profession TEXT,
    last_spec TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE matches (
    id INTEGER PRIMARY KEY,
    date TEXT DEFAULT (datetime('now')),
    map_name TEXT,
    enemy_comp TEXT,  -- JSON string
    result TEXT,      -- win/loss/unknown
    notes TEXT
);
CREATE TABLE match_players (
    match_id INTEGER REFERENCES matches(id),
    player_id INTEGER REFERENCES players(id),
    profession_id TEXT,
    spec_id TEXT,
    build_id TEXT
);
```

---

## Phase 2: Static Game Data (JSON files)

These are game fundamentals that rarely change — NOT builds.

**Factual game data (`data/game/`):**
- **`professions.json`** — 9 professions: id, name, armor class (light/medium/heavy), hp_tier, icon_class
- **`elite_specs.json`** — All elite specs per profession: id, name, profession_id, expansion, role_tags[], visual_identifiers, threat_profile{burst,sustain,mobility,support,control} (1-5 each)
- **`stolen_skills.json`** — Per-profession stolen skill: skill_name, effect, priority (1-9)
- **`do_not_hit.json`** — Skills to never hit into: skill_name, profession_id, spec_id (optional), what_happens, what_to_do, duration_seconds

**Meta data (`data/meta/`):**
- **`builds.json`** — Starts **empty** `{"builds":[]}`. Populated ONLY by MetaBattle scraper + enrichment.
- **`tier_list.json`** — Current tier rankings from MetaBattle (raw scrape output).

---

## Phase 3: Backend API Routes

### `routes/data_routes.py`
- `GET /api/data/professions` → all professions
- `GET /api/data/elite-specs?profession_id=X` → specs filtered by profession (optional)
- `GET /api/data/builds?spec_id=X` → builds filtered by spec (optional)
- `GET /api/data/stolen-skills/{profession_id}` → stolen skill for a profession
- `GET /api/data/do-not-hit?profession_ids=X,Y` → filtered do-not-hit list

### `routes/analysis_routes.py`
- `POST /api/analysis/team-comp` → accepts 1-5 enemies (profession_id, spec_id, build_id optional, player_name optional), returns:
  - `strategy_cards[]` — per-enemy: threat_level, stolen_skill, kills_you_with, saves_them_with, your_window, gameplan, focus_order
  - `general_strategy` — team comp summary, role breakdown, top-level recommendation
  - `do_not_hit[]` — filtered to this team's professions/specs
  - `role_summary` — e.g. "2 DPS / 1 Support / 1 Duelist / 1 Roamer"

**Strategy logic:**
```
0 supports → "No support. Play aggressive — damage sticks."
1 support  → "Focus {name} first in teamfights, or catch DPS alone."
2 supports → "Double support. Don't teamfight — split, decap, outrotate."
2+ roamers → "Multiple roamers. Watch your back when decapping."
```

Focus order algorithm: prioritize supports → low-armor DPS → high-sustain last.

If a build is selected, use its specific counter data (from scraper enrichment). If only spec is known, use spec-level threat profile to generate generic advice.

### `routes/player_routes.py`
- `GET /api/players/lookup/{name}` → find player by account name
- `POST /api/players` → create/update player
- `POST /api/matches` → save match result
- `GET /api/players/{id}/history` → past matches for player

---

## Phase 4: Frontend

### `templates/index.html`
Single-page app with 3 views (shown/hidden via JS, no routing):

**View 1: Match Setup**
- 5 enemy slots in a row/grid
- Each slot: click profession → big 9-button grid → click elite spec → 4-6 buttons → optional build dropdown + player name input
- Auto-analyze after any change (debounced)
- "RESET" button to clear all

**View 2: Match Analysis** (shown after selections)
- Top bar: role summary + general strategy
- 5 strategy cards side-by-side (or stacked on mobile)
- Each card: profession+spec, threat badge (AVOID/RESPECT/HUNT color-coded), stolen skill, kills_you_with, saves_them_with, your_window, gameplan bullets
- Bottom: do-not-hit quick reference

**View 3: Player History** (tab/button toggle)
- Search by name, see past encounters, add notes

### `static/css/style.css`
- Dark theme: `#0a0a0f` background, `#e0e0e0` text
- Threat colors: AVOID=red, RESPECT=orange, HUNT=green
- Large click targets (min 48px touch targets, ideally 64px+ for profession buttons)
- No scrolling for critical info — flexbox layout
- Mobile-friendly with media queries

### `static/js/app.js`
- State object tracking 5 enemy slots
- API fetch helpers
- DOM rendering functions
- Event delegation on slot container
- Debounced auto-analysis

---

## Phase 5: MetaBattle Scraper (LIVE DATA ONLY)

### `scraper/metabattle.py`
1. Fetch `https://metabattle.com/wiki/PvP_Builds`
2. Parse tier sections: Tournament Meta, Ranked Meta, Great, Good
3. For each build link, fetch the build page and extract:
   - Build name, profession, elite spec (from page title format `Build:Spec_-_Name`)
   - Tier rating (from which section it was found)
   - Weapons (from equipment section)
   - Key skills (from skill bar section)
   - Template code (for in-game import)
   - Usage notes (from usage guide section)
4. Rate limit: 2-second delay between requests, polite User-Agent
5. Output to `data/builds.json`

### `scraper/enrich.py`
Takes raw scraped builds and adds thief-specific counter data:
- `threat_level`: AVOID / RESPECT / HUNT (based on spec threat profile + build role)
- `visual_id`: weapons + key visual effects
- `kills_you_with`: inferred from key skills
- `saves_them_with`: inferred from defensive skills
- `your_window`: based on spec profile
- `your_gameplan`: rule-based 3-5 bullet points

Enrichment uses heuristic rules based on:
- Spec threat_profile ratings
- Role tags (support/duelist/roamer/teamfighter/bunker)
- Known dangerous skills per spec
- Armor class + HP tier

Future: replace heuristic enrichment with Claude API call.

---

## Phase 6: Verification

1. `just scrape` → fetches live MetaBattle data, populates `data/builds.json`
2. `just enrich` → adds counter strategies to builds
3. `just dev` → starts FastAPI on localhost:5000
4. Open browser → select 5 enemies → verify analysis appears
5. `just test` → data integrity + API endpoint tests
6. Test player tracking: enter name, save, verify lookup works next time

---

## Key Design Decisions

- **FastAPI** over Flask — async, modern, good for API-first design
- **No hardcoded builds** — `data/meta/builds.json` starts empty, populated only by scraper
- **Factual vs meta separation** — `data/game/` for stable game facts, `data/meta/` for fast-changing build meta. Different update cadences.
- **Spec-level fallback** — app works without any builds; spec threat profiles provide baseline strategies
- **Future build perspective** — enrichment currently assumes S/D Daredevil; future `data/my_build.json` makes it tunable for any build
- **Future Claude API hook** — analysis_routes.py has clear integration point where static strategy generation can be swapped for API call
- **`uv`** for deps, **`justfile`** for tasks, no pip/Makefile
