import json
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

from db.database import get_db

router = APIRouter()


class PlayerCreate(BaseModel):
    account_name: str
    nickname: str | None = None
    threat_level: int = 0
    notes: str | None = None
    last_profession: str | None = None
    last_spec: str | None = None


class MatchCreate(BaseModel):
    map_name: str | None = None
    enemy_comp: list[dict] | None = None
    result: str | None = None
    notes: str | None = None
    player_ids: list[int] | None = None


@router.get("/lookup/{name}")
async def lookup_player(name: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM players WHERE account_name LIKE ?",
            (f"%{name}%",),
        )
        rows = await cursor.fetchall()
        return {"players": [dict(r) for r in rows]}
    finally:
        await db.close()


@router.post("")
async def create_or_update_player(player: PlayerCreate):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id FROM players WHERE account_name = ?",
            (player.account_name,),
        )
        existing = await cursor.fetchone()

        if existing:
            await db.execute(
                """UPDATE players SET
                    nickname = COALESCE(?, nickname),
                    threat_level = ?,
                    notes = COALESCE(?, notes),
                    last_seen = ?,
                    last_profession = COALESCE(?, last_profession),
                    last_spec = COALESCE(?, last_spec)
                WHERE account_name = ?""",
                (
                    player.nickname,
                    player.threat_level,
                    player.notes,
                    datetime.now().isoformat(),
                    player.last_profession,
                    player.last_spec,
                    player.account_name,
                ),
            )
            await db.commit()
            return {"id": existing["id"], "updated": True}
        else:
            cursor = await db.execute(
                """INSERT INTO players
                (account_name, nickname, threat_level, notes, last_seen, last_profession, last_spec)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    player.account_name,
                    player.nickname,
                    player.threat_level,
                    player.notes,
                    datetime.now().isoformat(),
                    player.last_profession,
                    player.last_spec,
                ),
            )
            await db.commit()
            return {"id": cursor.lastrowid, "created": True}
    finally:
        await db.close()


@router.post("/matches")
async def create_match(match: MatchCreate):
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO matches (map_name, enemy_comp, result, notes)
            VALUES (?, ?, ?, ?)""",
            (
                match.map_name,
                json.dumps(match.enemy_comp) if match.enemy_comp else None,
                match.result,
                match.notes,
            ),
        )
        match_id = cursor.lastrowid

        if match.player_ids:
            for pid in match.player_ids:
                await db.execute(
                    "INSERT OR IGNORE INTO match_players (match_id, player_id) VALUES (?, ?)",
                    (match_id, pid),
                )

        await db.commit()
        return {"match_id": match_id}
    finally:
        await db.close()


@router.get("/{player_id}/history")
async def player_history(player_id: int):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM players WHERE id = ?", (player_id,))
        player = await cursor.fetchone()
        if not player:
            return {"error": "Player not found"}

        cursor = await db.execute(
            """SELECT m.* FROM matches m
            JOIN match_players mp ON m.id = mp.match_id
            WHERE mp.player_id = ?
            ORDER BY m.date DESC""",
            (player_id,),
        )
        matches = await cursor.fetchall()
        return {
            "player": dict(player),
            "matches": [dict(m) for m in matches],
        }
    finally:
        await db.close()
