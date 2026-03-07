import base64
import json
import logging
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

DATA_DIR = Path(__file__).parent.parent / "data"
logger = logging.getLogger(__name__)


def _load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


class EnemySlot(BaseModel):
    profession_id: str
    spec_id: str | None = None
    build_id: str | None = None
    player_name: str | None = None


class TeamCompRequest(BaseModel):
    enemies: list[EnemySlot]


def _get_spec(spec_id: str, specs: list[dict]) -> dict | None:
    for s in specs:
        if s["id"] == spec_id:
            return s
    return None


def _get_profession(prof_id: str, professions: list[dict]) -> dict | None:
    for p in professions:
        if p["id"] == prof_id:
            return p
    return None


def _get_build(build_id: str, builds: list[dict]) -> dict | None:
    for b in builds:
        if b.get("id") == build_id:
            return b
    return None


def _get_stolen_skill(profession_id: str, stolen_skills: list[dict]) -> dict | None:
    for s in stolen_skills:
        if s["profession_id"] == profession_id:
            return s
    return None


def _determine_threat(spec: dict | None, build: dict | None, profession: dict | None) -> str:
    if build and build.get("threat_level"):
        return build["threat_level"]
    if not spec:
        return "RESPECT"
    tp = spec.get("threat_profile", {})
    burst = tp.get("burst", 3)
    sustain = tp.get("sustain", 3)
    mobility = tp.get("mobility", 3)
    # High burst + high mobility = dangerous for thief
    if burst >= 4 and mobility >= 4:
        return "AVOID"
    if sustain >= 5:
        return "AVOID"
    if burst <= 3 and sustain <= 3:
        return "HUNT"
    return "RESPECT"


def _generate_strategy_card(
    enemy: EnemySlot,
    spec: dict | None,
    build: dict | None,
    profession: dict | None,
    stolen_skill: dict | None,
) -> dict:
    # Use build-specific data if available
    if build and build.get("counter"):
        counter = build["counter"]
        return {
            "profession_id": enemy.profession_id,
            "profession_name": profession["name"] if profession else enemy.profession_id,
            "spec_id": enemy.spec_id,
            "spec_name": spec["name"] if spec else enemy.spec_id or "Unknown",
            "build_name": build.get("name", ""),
            "player_name": enemy.player_name,
            "threat_level": counter.get("threat_level", "RESPECT"),
            "stolen_skill": stolen_skill,
            "kills_you_with": counter.get("kills_you_with", "Unknown"),
            "saves_them_with": counter.get("saves_them_with", "Unknown"),
            "your_window": counter.get("your_window", "Unknown"),
            "gameplan": counter.get("gameplan", ["Assess and adapt"]),
        }

    # Fallback: generate from spec threat profile
    threat = _determine_threat(spec, build, profession)
    tp = spec.get("threat_profile", {}) if spec else {}
    armor = profession.get("armor_class", "medium") if profession else "medium"
    hp = profession.get("hp_tier", "medium") if profession else "medium"
    roles = spec.get("role_tags", []) if spec else []

    kills_you = "Unknown — select a build for details"
    saves_them = "Unknown — select a build for details"
    window = "Unknown — select a build for details"
    gameplan = []

    if spec:
        if tp.get("burst", 0) >= 4:
            kills_you = f"High burst damage ({spec['name']} burst combo)"
        elif tp.get("control", 0) >= 4:
            kills_you = f"CC chains into burst ({spec['name']} lockdown)"
        else:
            kills_you = f"Sustained pressure ({spec['name']} attrition)"

        if tp.get("sustain", 0) >= 4:
            saves_them = f"High sustain / healing ({spec['name']} recovery)"
        elif "support" in roles:
            saves_them = "Team support — heals from allies"
        else:
            saves_them = "Dodge / evade skills"

        if tp.get("sustain", 0) >= 4:
            window = "After they burn their sustain cooldowns"
        elif tp.get("burst", 0) >= 4:
            window = "After they use their burst combo (watch for cooldowns)"
        else:
            window = "Catch them between rotations or off-node"

        if threat == "HUNT":
            gameplan.append(f"Free kill target — {spec['name']} is squishy")
            if armor == "light":
                gameplan.append("Light armor: your damage hits hard")
            if hp == "low":
                gameplan.append("Low HP pool: can burst from 100-0")
        elif threat == "AVOID":
            gameplan.append(f"Do NOT 1v1 — {spec['name']} counters you")
            if tp.get("sustain", 0) >= 5:
                gameplan.append("Too tanky — you won't kill them solo")
            if tp.get("burst", 0) >= 4 and tp.get("mobility", 0) >= 4:
                gameplan.append("Can match your mobility AND burst you")
        else:
            gameplan.append(f"Winnable 1v1 — respect {spec['name']}'s cooldowns")

        if "support" in roles:
            gameplan.append("PRIORITY: Kill in teamfights to remove enemy heals")
        if "bunker" in roles:
            gameplan.append("Don't waste time on node — decap and rotate")

    if not gameplan:
        gameplan = ["Assess and adapt — select build for detailed strategy"]

    return {
        "profession_id": enemy.profession_id,
        "profession_name": profession["name"] if profession else enemy.profession_id,
        "spec_id": enemy.spec_id,
        "spec_name": spec["name"] if spec else enemy.spec_id or "Unknown",
        "build_name": build.get("name", "") if build else "",
        "player_name": enemy.player_name,
        "threat_level": threat,
        "stolen_skill": stolen_skill,
        "kills_you_with": kills_you,
        "saves_them_with": saves_them,
        "your_window": window,
        "gameplan": gameplan,
    }


def _focus_order(cards: list[dict], specs_data: list[dict]) -> list[dict]:
    """Sort cards by focus priority: supports first, then low-armor DPS, then high-sustain."""

    def priority_key(card):
        spec = _get_spec(card.get("spec_id", ""), specs_data)
        roles = spec.get("role_tags", []) if spec else []
        tp = spec.get("threat_profile", {}) if spec else {}
        sustain = tp.get("sustain", 3)

        if "support" in roles:
            return (0, sustain)
        if card.get("threat_level") == "HUNT":
            return (1, sustain)
        if card.get("threat_level") == "RESPECT":
            return (2, sustain)
        return (3, sustain)

    return sorted(cards, key=priority_key)


def _general_strategy(cards: list[dict], specs_data: list[dict]) -> dict:
    roles_count = {"support": 0, "dps": 0, "duelist": 0, "roamer": 0, "bunker": 0, "teamfighter": 0}
    for card in cards:
        spec = _get_spec(card.get("spec_id", ""), specs_data)
        if spec:
            for role in spec.get("role_tags", []):
                if role in roles_count:
                    roles_count[role] += 1

    supports = roles_count["support"]
    roamers = roles_count["roamer"]

    if supports == 0:
        recommendation = "No support. Play aggressive — damage sticks."
    elif supports == 1:
        support_names = [
            c["spec_name"]
            for c in cards
            if _get_spec(c.get("spec_id", ""), specs_data)
            and "support" in (_get_spec(c.get("spec_id", ""), specs_data) or {}).get("role_tags", [])
        ]
        name = support_names[0] if support_names else "their support"
        recommendation = f"Focus {name} first in teamfights, or catch DPS alone."
    else:
        recommendation = "Double support. Don't teamfight — split, decap, outrotate."

    if roamers >= 2:
        recommendation += " Multiple roamers. Watch your back when decapping."

    role_parts = []
    for role, count in roles_count.items():
        if count > 0:
            role_parts.append(f"{count} {role.title()}")

    return {
        "recommendation": recommendation,
        "role_summary": " / ".join(role_parts),
        "supports": supports,
        "roamers": roamers,
    }


@router.post("/team-comp")
async def analyze_team_comp(request: TeamCompRequest):
    professions = _load_json(DATA_DIR / "game" / "professions.json")["professions"]
    specs = _load_json(DATA_DIR / "game" / "elite_specs.json")["elite_specs"]
    builds = _load_json(DATA_DIR / "meta" / "builds.json")["builds"]
    stolen_skills = _load_json(DATA_DIR / "game" / "stolen_skills.json")["stolen_skills"]
    do_not_hit_all = _load_json(DATA_DIR / "game" / "do_not_hit.json")["do_not_hit"]

    cards = []
    enemy_profession_ids = set()
    enemy_spec_ids = set()

    for enemy in request.enemies:
        profession = _get_profession(enemy.profession_id, professions)
        spec = _get_spec(enemy.spec_id, specs) if enemy.spec_id else None
        build = _get_build(enemy.build_id, builds) if enemy.build_id else None
        stolen = _get_stolen_skill(enemy.profession_id, stolen_skills)

        enemy_profession_ids.add(enemy.profession_id)
        if enemy.spec_id:
            enemy_spec_ids.add(enemy.spec_id)

        card = _generate_strategy_card(enemy, spec, build, profession, stolen)
        cards.append(card)

    ordered_cards = _focus_order(cards, specs)
    for i, card in enumerate(ordered_cards):
        card["focus_order"] = i + 1

    general = _general_strategy(cards, specs)

    # Filter do-not-hit for this team
    do_not_hit = [
        d
        for d in do_not_hit_all
        if d["profession_id"] in enemy_profession_ids
        and (d.get("spec_id") is None or d.get("spec_id") in enemy_spec_ids)
    ]

    return {
        "strategy_cards": ordered_cards,
        "general_strategy": general,
        "do_not_hit": do_not_hit,
    }


# ── Screenshot Parsing ──

SPEC_TO_PROFESSION = {
    # Guardian (blue icons)
    "core_guardian": "guardian",
    "dragonhunter": "guardian",
    "firebrand": "guardian",
    "willbender": "guardian",
    "herald": "guardian",
    # Warrior (gold icons)
    "core_warrior": "warrior",
    "berserker": "warrior",
    "spellbreaker": "warrior",
    "bladesworn": "warrior",
    "vindicator": "warrior",
    # Revenant (red icons)
    "core_revenant": "revenant",
    "herald_rev": "revenant",
    "renegade": "revenant",
    "vindicator_rev": "revenant",
    # Ranger (green icons)
    "core_ranger": "ranger",
    "druid": "ranger",
    "soulbeast": "ranger",
    "untamed": "ranger",
    # Thief (gray icons)
    "core_thief": "thief",
    "daredevil": "thief",
    "deadeye": "thief",
    "specter": "thief",
    # Engineer (orange icons)
    "core_engineer": "engineer",
    "scrapper": "engineer",
    "holosmith": "engineer",
    "mechanist": "engineer",
    # Necromancer (dark green icons)
    "core_necromancer": "necromancer",
    "reaper": "necromancer",
    "scourge": "necromancer",
    "harbinger": "necromancer",
    # Elementalist (red-orange icons)
    "core_elementalist": "elementalist",
    "tempest": "elementalist",
    "weaver": "elementalist",
    "catalyst": "elementalist",
    # Mesmer (purple icons)
    "core_mesmer": "mesmer",
    "chronomancer": "mesmer",
    "mirage": "mesmer",
    "virtuoso": "mesmer",
}


class ParsedEnemy(BaseModel):
    character_name: str
    spec: str


class ParsedScoreboard(BaseModel):
    enemies: list[ParsedEnemy]


class ScoreboardRequest(BaseModel):
    image: str  # base64 encoded
    media_type: str = "image/png"


@router.post("/parse-scoreboard")
async def parse_scoreboard(request: ScoreboardRequest):
    import tempfile

    try:
        from claude_code_model import ClaudeCodeModel
        from pydantic_ai import Agent
    except ImportError:
        logger.warning("claude-code-model or pydantic-ai not installed")
        return {"enemies": [], "error": "Screenshot parsing dependencies not available"}

    try:
        image_data = base64.b64decode(request.image)
    except Exception:
        return {"enemies": [], "error": "Invalid base64 image data"}

    # Save image to temp file so the CLI can read it (avoids broken stream-json)
    ext = request.media_type.split("/")[-1] if "/" in request.media_type else "png"
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False, dir="/tmp") as f:
            f.write(image_data)
            image_path = f.name

        scoreboard_agent = Agent(
            ClaudeCodeModel(model="sonnet", timeout=120, cwd=Path("/tmp")),
            output_type=ParsedScoreboard,
            retries=3,
            system_prompt=(
                "You are analyzing a Guild Wars 2 PvP scoreboard screenshot.\n\n"
                "SCOREBOARD LAYOUT:\n"
                "- Two colored sections: RED team (top/left) and BLUE team (bottom/right)\n"
                "- Each section has exactly 5 player rows\n"
                "- One player name is highlighted/bolded — that is the user's character\n\n"
                "ICON POSITIONS:\n"
                "- Red team: spec icons appear to the LEFT of the player name\n"
                "- Blue team: spec icons appear to the RIGHT of the player name\n\n"
                "The scoreboard shows ELITE SPECIALIZATION icons, not base profession icons. "
                "Icons are color-coded by profession. Identify the specific elite spec.\n\n"
                "GUARDIAN (blue icons):\n"
                "- core_guardian: blue flame/shield\n"
                "- dragonhunter: bow/crossbow with wings\n"
                "- firebrand: open tome/book with flames\n"
                "- willbender: angular sword with flowing motion lines\n"
                "- herald: spear with golden light\n\n"
                "WARRIOR (gold/yellow icons):\n"
                "- core_warrior: gold sword\n"
                "- berserker: flaming horned helmet/skull\n"
                "- spellbreaker: crossed daggers with broken circle\n"
                "- bladesworn: angular gunsaber/katana\n"
                "- vindicator: greatsword with alliance symbol\n\n"
                "REVENANT (red/crimson icons):\n"
                "- core_revenant: red misty/ethereal\n"
                "- herald_rev: dragon face with radiating lines\n"
                "- renegade: shattered charr warband emblem\n"
                "- vindicator_rev: upward-pointing wings\n\n"
                "RANGER (green icons):\n"
                "- core_ranger: green leaf/nature\n"
                "- druid: celestial/star with nature elements\n"
                "- soulbeast: merged beast face (human/animal hybrid)\n"
                "- untamed: wild feral claw marks\n\n"
                "THIEF (gray/dark icons):\n"
                "- core_thief: gray dagger\n"
                "- daredevil: three-pointed staff/bo\n"
                "- deadeye: crosshair/scope/target reticle\n"
                "- specter: shadow/ghostly lantern\n\n"
                "ENGINEER (orange/brown icons):\n"
                "- core_engineer: wrench/gear\n"
                "- scrapper: wrench/hammer with lightning bolt\n"
                "- holosmith: holographic sun burst\n"
                "- mechanist: jade mech/robot face\n\n"
                "NECROMANCER (dark green icons):\n"
                "- core_necromancer: green skull\n"
                "- reaper: hooded skull with scythe blade\n"
                "- scourge: sand shade/torch with swirling particles\n"
                "- harbinger: pistol/flask with blight vial\n\n"
                "ELEMENTALIST (red-orange icons):\n"
                "- core_elementalist: red/orange flame\n"
                "- tempest: swirling storm/overload circle\n"
                "- weaver: dual-element intertwined strands\n"
                "- catalyst: jade sphere/hammer with elemental orb\n\n"
                "MESMER (purple/magenta icons):\n"
                "- core_mesmer: purple butterfly/swirl\n"
                "- chronomancer: clock face/hourglass\n"
                "- mirage: mirrored/illusory axe with haze\n"
                "- virtuoso: floating psychic blade/dagger\n\n"
                "YOUR TASK:\n"
                "1. Find the highlighted/bolded player name to identify the user's team\n"
                "2. Extract the 5 players from the OTHER (enemy) team\n"
                "3. For each enemy player, return their character name and spec ID "
                "(the lowercase identifier shown above, e.g. 'firebrand', 'reaper', 'daredevil')\n\n"
                "If you cannot distinguish the exact elite spec, return the core spec "
                "(e.g. 'core_guardian'). Use the spec field for the spec ID."
            ),
        )
        result = await scoreboard_agent.run(
            f"Read and parse the scoreboard screenshot at {image_path}"
        )

        enemies = []
        for e in result.output.enemies:
            spec = e.spec.lower().strip()
            if spec not in SPEC_TO_PROFESSION:
                continue
            enemies.append(
                {
                    "character_name": e.character_name,
                    "profession_id": SPEC_TO_PROFESSION[spec],
                    "spec_id": spec,
                }
            )

        return {"enemies": enemies[:5]}

    except Exception as e:
        logger.exception("Failed to parse scoreboard")
        return {"enemies": [], "error": str(e)}
    finally:
        import os

        try:
            os.unlink(image_path)
        except (OSError, NameError):
            pass
