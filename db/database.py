from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent / "players.db"


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS players (
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
            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY,
                date TEXT DEFAULT (datetime('now')),
                map_name TEXT,
                enemy_comp TEXT,
                result TEXT,
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS match_players (
                match_id INTEGER REFERENCES matches(id),
                player_id INTEGER REFERENCES players(id),
                profession_id TEXT,
                spec_id TEXT,
                build_id TEXT,
                PRIMARY KEY (match_id, player_id)
            );
        """)
        await db.commit()
    finally:
        await db.close()
    print(f"Database initialized at {DB_PATH}")
