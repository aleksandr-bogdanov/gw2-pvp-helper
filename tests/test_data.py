"""Data integrity and API endpoint tests."""

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app import app

DATA_DIR = Path(__file__).parent.parent / "data"


# ── Data integrity tests ──


def test_professions_valid():
    with open(DATA_DIR / "game" / "professions.json") as f:
        data = json.load(f)
    assert len(data["professions"]) == 9
    for p in data["professions"]:
        assert "id" in p
        assert "name" in p
        assert p["armor_class"] in ("light", "medium", "heavy")
        assert p["hp_tier"] in ("low", "medium", "high")


def test_elite_specs_valid():
    with open(DATA_DIR / "game" / "elite_specs.json") as f:
        data = json.load(f)
    assert len(data["elite_specs"]) > 30
    for s in data["elite_specs"]:
        assert "id" in s
        assert "profession_id" in s
        assert "threat_profile" in s
        tp = s["threat_profile"]
        for key in ("burst", "sustain", "mobility", "support", "control"):
            assert 1 <= tp[key] <= 5, f"{s['id']}.{key} = {tp[key]}"


def test_stolen_skills_cover_all_professions():
    with open(DATA_DIR / "game" / "professions.json") as f:
        profs = {p["id"] for p in json.load(f)["professions"]}
    with open(DATA_DIR / "game" / "stolen_skills.json") as f:
        stolen = {s["profession_id"] for s in json.load(f)["stolen_skills"]}
    assert profs == stolen, f"Missing stolen skills for: {profs - stolen}"


def test_do_not_hit_references_valid_professions():
    with open(DATA_DIR / "game" / "professions.json") as f:
        profs = {p["id"] for p in json.load(f)["professions"]}
    with open(DATA_DIR / "game" / "do_not_hit.json") as f:
        data = json.load(f)
    for d in data["do_not_hit"]:
        assert d["profession_id"] in profs, f"Invalid profession: {d['profession_id']}"


# ── API endpoint tests ──


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_get_professions():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/api/data/professions")
    assert resp.status_code == 200
    assert len(resp.json()["professions"]) == 9


@pytest.mark.anyio
async def test_get_elite_specs():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/api/data/elite-specs?profession_id=guardian")
    assert resp.status_code == 200
    specs = resp.json()["elite_specs"]
    assert all(s["profession_id"] == "guardian" for s in specs)


@pytest.mark.anyio
async def test_team_comp_analysis():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post(
            "/api/analysis/team-comp",
            json={
                "enemies": [
                    {"profession_id": "guardian", "spec_id": "firebrand"},
                    {"profession_id": "necromancer", "spec_id": "reaper"},
                ]
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["strategy_cards"]) == 2
    assert "general_strategy" in data
    assert "do_not_hit" in data
    for card in data["strategy_cards"]:
        assert card["threat_level"] in ("AVOID", "RESPECT", "HUNT")
        assert "focus_order" in card


@pytest.mark.anyio
async def test_health_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"


@pytest.mark.anyio
async def test_ready_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/ready")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"
