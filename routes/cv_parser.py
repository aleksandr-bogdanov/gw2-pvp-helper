"""Scoreboard parser: single Anthropic API call for full scoreboard extraction.

Sends the screenshot to Haiku with a structured tool_choice to extract:
- All 10 player names (5 red, 5 blue)
- Elite spec for each player (from icon recognition)
- Which player is the user (highlighted/bolded name)
"""

import base64
import logging
import time

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── Spec → Profession mapping ──

SPEC_TO_PROFESSION = {
    "core_guardian": "guardian",
    "dragonhunter": "guardian",
    "firebrand": "guardian",
    "willbender": "guardian",
    "herald": "guardian",
    "core_warrior": "warrior",
    "berserker": "warrior",
    "spellbreaker": "warrior",
    "bladesworn": "warrior",
    "vindicator": "warrior",
    "core_revenant": "revenant",
    "herald_rev": "revenant",
    "renegade": "revenant",
    "vindicator_rev": "revenant",
    "core_ranger": "ranger",
    "druid": "ranger",
    "soulbeast": "ranger",
    "untamed": "ranger",
    "core_thief": "thief",
    "daredevil": "thief",
    "deadeye": "thief",
    "specter": "thief",
    "core_engineer": "engineer",
    "scrapper": "engineer",
    "holosmith": "engineer",
    "mechanist": "engineer",
    "core_necromancer": "necromancer",
    "reaper": "necromancer",
    "scourge": "necromancer",
    "harbinger": "necromancer",
    "core_elementalist": "elementalist",
    "tempest": "elementalist",
    "weaver": "elementalist",
    "catalyst": "elementalist",
    "core_mesmer": "mesmer",
    "chronomancer": "mesmer",
    "mirage": "mesmer",
    "virtuoso": "mesmer",
}

VALID_SPEC_IDS = list(SPEC_TO_PROFESSION.keys())

# ── Scoreboard cropping ──


def _crop_scoreboard_region(img: np.ndarray) -> np.ndarray:
    """Crop to just the scoreboard panel area from a full screenshot.

    The scoreboard is a dark semi-transparent overlay roughly centered on screen.
    We crop to the center ~55% width, ~50% height to focus the LLM on the
    relevant area and reduce token cost.
    """
    h, w = img.shape[:2]

    # Only crop if this looks like a full game screenshot
    if w < 1200 or h < 600:
        return img

    # The scoreboard panel is roughly centered
    x1 = int(w * 0.17)
    x2 = int(w * 0.83)
    y1 = int(h * 0.03)
    y2 = int(h * 0.55)

    return img[y1:y2, x1:x2]


def _encode_image(img: np.ndarray) -> str:
    """Encode an OpenCV image to base64 JPEG for the API."""
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf).decode()


# ── LLM call ──

SCOREBOARD_TOOL = {
    "name": "report_scoreboard",
    "description": "Report all players, their elite specs, and teams from a GW2 PvP scoreboard.",
    "input_schema": {
        "type": "object",
        "properties": {
            "red_team_name": {
                "type": "string",
                "description": "The guild/team name shown in the RED team header row (NOT a player). Usually has a score number next to it.",
            },
            "blue_team_name": {
                "type": "string",
                "description": "The guild/team name shown in the BLUE team header row (NOT a player). Usually has a score number next to it.",
            },
            "user_team_color": {
                "type": "string",
                "enum": ["red", "blue"],
                "description": "The team color of the highlighted/bolded player (the user).",
            },
            "highlighted_player_name": {
                "type": "string",
                "description": "The character name that appears highlighted or bolded (the user).",
            },
            "red_team": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Player character name."},
                        "spec_id": {
                            "type": "string",
                            "description": "Elite spec ID from the icon next to the player name.",
                            "enum": VALID_SPEC_IDS,
                        },
                    },
                    "required": ["name", "spec_id"],
                },
                "minItems": 5,
                "maxItems": 5,
                "description": "The 5 players on the red team (left side), top to bottom.",
            },
            "blue_team": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Player character name."},
                        "spec_id": {
                            "type": "string",
                            "description": "Elite spec ID from the icon next to the player name.",
                            "enum": VALID_SPEC_IDS,
                        },
                    },
                    "required": ["name", "spec_id"],
                },
                "minItems": 5,
                "maxItems": 5,
                "description": "The 5 players on the blue team (right side), top to bottom.",
            },
        },
        "required": ["red_team_name", "blue_team_name", "user_team_color", "highlighted_player_name", "red_team", "blue_team"],
    },
}

SYSTEM_PROMPT = """\
You are reading a Guild Wars 2 PvP scoreboard screenshot.

SCOREBOARD LAYOUT:
- The scoreboard has two halves side by side: RED team on the LEFT, BLUE team on the RIGHT.
- At the top of each half is a TEAM/GUILD NAME with a score (e.g. "Thermal Runaways 500"). These are NOT player names — skip them.
- Below the team header, each half has exactly 5 PLAYER rows.
- One player name is highlighted/bolded — that is the user.
- Each player has a small colored ELITE SPECIALIZATION icon next to their name.
- Red team: icon is near the player name on the left side.
- Blue team: icon is near the player name on the right side.
- Return EXACTLY 5 players per team. Do NOT include team/guild names as players.

ICON IDENTIFICATION — The icons are small colored silhouettes. Identify by profession color + shape:
GUARDIAN (blue/teal): core_guardian, dragonhunter (wings), firebrand (book), willbender (sword), herald (spear)
WARRIOR (gold/yellow): core_warrior, berserker (flames), spellbreaker (daggers), bladesworn (katana), vindicator (greatsword)
REVENANT (red/dark red): core_revenant, herald_rev (dragon), renegade (emblem), vindicator_rev (wings)
RANGER (green): core_ranger, druid (star), soulbeast (beast), untamed (claw)
THIEF (gray/brown): core_thief, daredevil (staff), deadeye (crosshair), specter (lantern)
ENGINEER (orange): core_engineer, scrapper (hammer), holosmith (sun), mechanist (mech)
NECROMANCER (dark green): core_necromancer, reaper (skull), scourge (shade), harbinger (flask)
ELEMENTALIST (red-orange/fire): core_elementalist, tempest (storm), weaver (strands), catalyst (sphere)
MESMER (purple/pink): core_mesmer, chronomancer (clock), mirage (axe), virtuoso (blade)

If you cannot determine the exact elite spec, use the core_<profession> ID based on icon color.

IMPORTANT: The FIRST row in each team section is the TEAM/GUILD HEADER (team name + score).
It is NOT a player. Players are the 5 rows BELOW the team header.
Look for the team name row that shows a score number — skip it.

YOUR TASK: Read every player name and identify their elite spec from the icon. Report using the tool.\
"""


async def _call_llm(image_b64: str, media_type: str) -> dict | None:
    """Single Anthropic API call to extract all scoreboard data."""
    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed")
        return None

    client = anthropic.AsyncAnthropic()

    try:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=[SCOREBOARD_TOOL],
            tool_choice={"type": "tool", "name": "report_scoreboard"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Read this GW2 PvP scoreboard. Extract all player names and their elite specs.",
                        },
                    ],
                }
            ],
        )

        for block in response.content:
            if block.type == "tool_use" and block.name == "report_scoreboard":
                return block.input

        logger.warning("No tool_use block in LLM response")
        return None

    except Exception:
        logger.exception("LLM scoreboard extraction failed")
        return None


# ── Main pipeline ──


async def parse_scoreboard_hybrid(
    image_b64: str,
    media_type: str = "image/png",
) -> dict:
    """Parse a scoreboard screenshot.

    Returns:
        {
            "red_team": [{"character_name": ..., "profession_id": ..., "spec_id": ...}, ...],
            "blue_team": [...],
            "user_team_color": "red" | "blue",
        }
    """
    total_start = time.perf_counter()

    # Decode image
    image_data = base64.b64decode(image_b64)
    arr = np.frombuffer(image_data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    if img is None:
        return {"red_team": [], "blue_team": [], "user_team_color": "red", "error": "Failed to decode image"}

    h, w = img.shape[:2]
    logger.info("Image decoded: %dx%d", w, h)

    # Crop to scoreboard region to reduce tokens / improve focus
    cropped = _crop_scoreboard_region(img)
    ch, cw = cropped.shape[:2]
    logger.info("Cropped to: %dx%d", cw, ch)

    # Re-encode the crop as JPEG for the API call
    crop_b64 = _encode_image(cropped)

    # Single LLM call for everything
    llm_result = await _call_llm(crop_b64, "image/jpeg")

    elapsed = time.perf_counter() - total_start
    logger.info("LLM call done in %.2fs", elapsed)

    if not llm_result:
        logger.warning("LLM returned no result")
        return {"red_team": [], "blue_team": [], "user_team_color": "red", "error": "Failed to parse scoreboard"}

    # Build response
    user_team_color = llm_result.get("user_team_color", "red")
    highlighted_name = llm_result.get("highlighted_player_name", "")

    # Collect team/guild header names to filter them out of player lists
    team_header_names = set()
    for key in ("red_team_name", "blue_team_name"):
        header = llm_result.get(key, "")
        if header:
            team_header_names.add(header.lower().strip())

    def _build_team(raw_players: list[dict]) -> list[dict]:
        """Build team list, filtering out any team header names that leaked in."""
        team = []
        for player in raw_players:
            name = player.get("name", "")
            # Skip entries that match a team/guild header name
            if name.lower().strip() in team_header_names:
                logger.info("Filtered out team header name from player list: %s", name)
                continue
            spec_id = player.get("spec_id", "")
            profession_id = SPEC_TO_PROFESSION.get(spec_id)
            team.append({
                "character_name": name,
                "profession_id": profession_id,
                "spec_id": spec_id if spec_id in SPEC_TO_PROFESSION else None,
                "is_user": name == highlighted_name,
            })
        return team[:5]

    red_team = _build_team(llm_result.get("red_team", []))
    blue_team = _build_team(llm_result.get("blue_team", []))

    total_elapsed = time.perf_counter() - total_start
    logger.info("=== PARSE DONE === %.1fs, red=%d blue=%d", total_elapsed, len(red_team), len(blue_team))

    return {
        "red_team": red_team,
        "blue_team": blue_team,
        "user_team_color": user_team_color,
    }
