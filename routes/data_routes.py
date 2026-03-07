import json
from pathlib import Path

from fastapi import APIRouter, Query

router = APIRouter()

DATA_DIR = Path(__file__).parent.parent / "data"


def _load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


@router.get("/professions")
async def get_professions():
    return _load_json(DATA_DIR / "game" / "professions.json")


@router.get("/elite-specs")
async def get_elite_specs(profession_id: str | None = None):
    data = _load_json(DATA_DIR / "game" / "elite_specs.json")
    if profession_id:
        data["elite_specs"] = [s for s in data["elite_specs"] if s["profession_id"] == profession_id]
    return data


@router.get("/builds")
async def get_builds(spec_id: str | None = None):
    data = _load_json(DATA_DIR / "meta" / "builds.json")
    if spec_id:
        data["builds"] = [b for b in data["builds"] if b.get("spec_id") == spec_id]
    return data


@router.get("/stolen-skills/{profession_id}")
async def get_stolen_skill(profession_id: str):
    data = _load_json(DATA_DIR / "game" / "stolen_skills.json")
    for skill in data["stolen_skills"]:
        if skill["profession_id"] == profession_id:
            return skill
    return {"error": "not found"}


@router.get("/do-not-hit")
async def get_do_not_hit(profession_ids: str | None = Query(None)):
    data = _load_json(DATA_DIR / "game" / "do_not_hit.json")
    if profession_ids:
        ids = [p.strip() for p in profession_ids.split(",")]
        data["do_not_hit"] = [d for d in data["do_not_hit"] if d["profession_id"] in ids]
    return data
