"""Hybrid scoreboard parser: OpenCV template matching + Anthropic API for names.

Pipeline:
1. Detect/crop scoreboard region from screenshot
2. Extract 10 player rows (5 red, 5 blue)
3. Extract spec icon from each row → CV template match
4. Single LLM call (Haiku) for player names + user identification
5. Merge CV specs with LLM names
"""

import base64
import logging
import time
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
TEMPLATE_DIR = DATA_DIR / "icons" / "templates"

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

# Minimum confidence for CV template match
CV_CONFIDENCE_THRESHOLD = 0.6

# Template match scales for resolution independence
MATCH_SCALES = [0.8, 0.9, 1.0, 1.1, 1.2]


# ── Template loading ──


@lru_cache(maxsize=1)
def _load_templates() -> dict[str, np.ndarray]:
    """Load all 32x32 grayscale template masks from disk."""
    templates = {}
    if not TEMPLATE_DIR.exists():
        logger.warning("Template directory not found: %s", TEMPLATE_DIR)
        return templates

    for path in TEMPLATE_DIR.glob("*.png"):
        spec_id = path.stem
        img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if img is not None:
            templates[spec_id] = img

    logger.info("Loaded %d templates", len(templates))
    return templates


# ── Scoreboard detection ──


def _is_scoreboard_crop(img: np.ndarray) -> bool:
    """Heuristic: check if the image is already a scoreboard crop vs full screenshot.

    Scoreboard crops tend to be wider than tall (aspect ratio > 2) or have
    a relatively small height. Full screenshots are close to 16:9 or 21:9.
    """
    h, w = img.shape[:2]
    aspect = w / h

    # Full screenshot aspect ratios: 16:9 = 1.78, 21:9 = 2.33
    # Scoreboard crops are typically very wide relative to height
    # or are just a portion of the screen
    if aspect > 3.0:
        return True  # Very wide strip = scoreboard crop
    if h < 400 and w > 600:
        return True  # Small height, decent width = crop

    # Check if this looks like a full game screenshot (has HUD elements, etc.)
    # Full screenshots at gaming resolutions
    if w >= 1920 and abs(aspect - 16 / 9) < 0.3:
        return False
    if w >= 2560 and abs(aspect - 21 / 9) < 0.3:
        return False

    # Default: assume it might need cropping if it's large enough
    return h < 600


def _crop_scoreboard(img: np.ndarray) -> np.ndarray:
    """Extract scoreboard region from a full screenshot.

    The scoreboard is a dark semi-transparent overlay in the center of the screen.
    """
    h, w = img.shape[:2]

    # Scoreboard is roughly centered, ~60% width, ~70% height
    x1 = int(w * 0.20)
    x2 = int(w * 0.80)
    y1 = int(h * 0.10)
    y2 = int(h * 0.85)

    center_crop = img[y1:y2, x1:x2]

    # Try to refine by finding the dark overlay region
    gray = cv2.cvtColor(center_crop, cv2.COLOR_BGR2GRAY)

    # The scoreboard overlay is darker than the game background
    # Threshold for dark regions
    _, dark_mask = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)

    # Find contours of dark regions
    contours, _ = cv2.findContours(dark_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if contours:
        # Find the largest dark rectangle (likely the scoreboard)
        largest = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(largest)
        crop_area = center_crop.shape[0] * center_crop.shape[1]

        if area > crop_area * 0.3:  # Must be significant
            x, y, cw, ch = cv2.boundingRect(largest)
            # Add small padding
            pad = 5
            x = max(0, x - pad)
            y = max(0, y - pad)
            cw = min(center_crop.shape[1] - x, cw + 2 * pad)
            ch = min(center_crop.shape[0] - y, ch + 2 * pad)
            return center_crop[y : y + ch, x : x + cw]

    return center_crop


# ── Row extraction ──


def _extract_rows(scoreboard: np.ndarray) -> list[np.ndarray]:
    """Extract 10 player rows from the scoreboard image.

    Uses horizontal projection (average brightness per row) to find row boundaries.
    Returns list of 10 row images (5 red team + 5 blue team).
    """
    h, w = scoreboard.shape[:2]
    gray = cv2.cvtColor(scoreboard, cv2.COLOR_BGR2GRAY)

    # Horizontal projection: average brightness per pixel row
    projection = np.mean(gray, axis=1)

    # Find row boundaries by looking for brightness dips (separators between rows)
    # Smooth the projection to reduce noise
    kernel_size = max(3, h // 100)
    if kernel_size % 2 == 0:
        kernel_size += 1
    smoothed = cv2.GaussianBlur(projection.reshape(-1, 1), (1, kernel_size), 0).flatten()

    # Find valleys (dark separator lines between rows)
    mean_val = np.mean(smoothed)
    threshold = mean_val * 0.7

    # Detect transitions: bright → dark → bright
    is_dark = smoothed < threshold
    boundaries = []
    in_dark = False
    dark_start = 0

    for i in range(len(is_dark)):
        if is_dark[i] and not in_dark:
            dark_start = i
            in_dark = True
        elif not is_dark[i] and in_dark:
            # Center of dark band is the separator
            boundaries.append((dark_start + i) // 2)
            in_dark = False

    # If we found enough boundaries, use them
    if len(boundaries) >= 9:
        # We should have ~9-11 separators for 10 rows
        rows = []
        # Add edges
        all_bounds = [0] + boundaries + [h]
        for i in range(len(all_bounds) - 1):
            y1 = all_bounds[i]
            y2 = all_bounds[i + 1]
            if y2 - y1 > h * 0.02:  # Skip very thin separators
                rows.append(scoreboard[y1:y2])

        if len(rows) >= 10:
            return rows[:10]

    # Fallback: divide evenly into 10 rows
    row_height = h // 10
    rows = []
    for i in range(10):
        y1 = i * row_height
        y2 = (i + 1) * row_height
        rows.append(scoreboard[y1:y2])

    return rows


# ── Icon extraction ──


def _extract_icon(row: np.ndarray, team: str) -> np.ndarray | None:
    """Extract the spec icon region from a player row.

    Red team: icon is on the LEFT of the player name.
    Blue team: icon is on the RIGHT of the player name.
    """
    h, w = row.shape[:2]

    # Icon is roughly square, about 60-80% of row height
    icon_size = int(h * 0.7)
    pad_y = (h - icon_size) // 2

    if team == "red":
        # Icon on the left side, roughly first 10-15% of width
        x_start = int(w * 0.02)
        x_end = x_start + icon_size
    else:
        # Icon on the right side, roughly last 10-15% of width
        x_end = int(w * 0.98)
        x_start = x_end - icon_size

    # Clamp
    x_start = max(0, x_start)
    x_end = min(w, x_end)
    y_start = max(0, pad_y)
    y_end = min(h, pad_y + icon_size)

    if x_end <= x_start or y_end <= y_start:
        return None

    icon = row[y_start:y_end, x_start:x_end]

    # Convert to grayscale and threshold to binary silhouette
    gray = cv2.cvtColor(icon, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return binary


# ── Template matching ──


def _match_icon(icon: np.ndarray, templates: dict[str, np.ndarray]) -> tuple[str | None, float]:
    """Match an extracted icon against all templates using multi-scale template matching.

    Returns (spec_id, confidence) or (None, 0.0) if no match above threshold.
    """
    if icon is None or icon.size == 0:
        return None, 0.0

    best_spec = None
    best_score = 0.0

    for spec_id, template in templates.items():
        for scale in MATCH_SCALES:
            # Resize template to match icon dimensions at this scale
            th, tw = template.shape[:2]
            new_w = int(tw * scale)
            new_h = int(th * scale)

            # Template must be smaller than or equal to icon
            ih, iw = icon.shape[:2]
            if new_w > iw or new_h > ih:
                # Resize icon up instead
                resized_icon = cv2.resize(icon, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
                resized_template = template
            else:
                resized_icon = icon
                resized_template = cv2.resize(template, (new_w, new_h), interpolation=cv2.INTER_AREA)

            # Ensure template isn't larger than icon in any dimension
            ri_h, ri_w = resized_icon.shape[:2]
            rt_h, rt_w = resized_template.shape[:2]
            if rt_w > ri_w or rt_h > ri_h:
                continue

            try:
                result = cv2.matchTemplate(resized_icon, resized_template, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, _ = cv2.minMaxLoc(result)

                if max_val > best_score:
                    best_score = max_val
                    best_spec = spec_id
            except cv2.error:
                continue

    if best_score >= CV_CONFIDENCE_THRESHOLD:
        return best_spec, best_score

    return None, best_score


# ── LLM call for player names ──


async def _extract_names_llm(image_b64: str, media_type: str) -> dict | None:
    """Call Anthropic API (Haiku) to extract player names and identify user.

    Returns dict with user_team_color, highlighted_player_name, red_team_names, blue_team_names.
    """
    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed, skipping name extraction")
        return None

    client = anthropic.AsyncAnthropic()

    tool = {
        "name": "report_scoreboard",
        "description": "Report the player names and teams from a GW2 PvP scoreboard.",
        "input_schema": {
            "type": "object",
            "properties": {
                "user_team_color": {
                    "type": "string",
                    "enum": ["red", "blue"],
                    "description": "The team color of the highlighted/bolded player (the user).",
                },
                "highlighted_player_name": {
                    "type": "string",
                    "description": "The character name that appears highlighted or bolded (the user's name).",
                },
                "red_team_names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 5,
                    "maxItems": 5,
                    "description": "The 5 player character names on the red team, in order from top to bottom.",
                },
                "blue_team_names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 5,
                    "maxItems": 5,
                    "description": "The 5 player character names on the blue team, in order from top to bottom.",
                },
            },
            "required": ["user_team_color", "highlighted_player_name", "red_team_names", "blue_team_names"],
        },
    }

    try:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            tools=[tool],
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
                            "text": (
                                "This is a Guild Wars 2 PvP scoreboard screenshot.\n\n"
                                "Read all 10 player character names:\n"
                                "- Red team (top section): 5 players\n"
                                "- Blue team (bottom section): 5 players\n\n"
                                "One player name is highlighted/bolded — that is the user.\n"
                                "Report which team they are on and their name.\n\n"
                                "Use the report_scoreboard tool to return the results."
                            ),
                        },
                    ],
                }
            ],
        )

        # Extract tool use result
        for block in response.content:
            if block.type == "tool_use" and block.name == "report_scoreboard":
                return block.input

        logger.warning("No tool_use block in LLM response")
        return None

    except Exception:
        logger.exception("LLM name extraction failed")
        return None


# ── Main pipeline ──


async def parse_scoreboard_hybrid(
    image_b64: str,
    media_type: str = "image/png",
) -> dict:
    """Parse a scoreboard screenshot using CV + LLM hybrid approach.

    Returns:
        {
            "red_team": [{"character_name": ..., "profession_id": ..., "spec_id": ..., "cv_confidence": ...}, ...],
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

    logger.info("Image decoded: %dx%d", img.shape[1], img.shape[0])

    # Step 1: Detect/crop scoreboard
    if _is_scoreboard_crop(img):
        scoreboard = img
        logger.info("Input appears to be a scoreboard crop")
    else:
        scoreboard = _crop_scoreboard(img)
        logger.info("Cropped scoreboard: %dx%d", scoreboard.shape[1], scoreboard.shape[0])

    # Step 2: Extract player rows
    rows = _extract_rows(scoreboard)
    logger.info("Extracted %d rows", len(rows))

    # Step 3: CV template matching (runs in parallel with LLM)
    templates = _load_templates()

    cv_results = []
    for i, row in enumerate(rows):
        team = "red" if i < 5 else "blue"
        icon = _extract_icon(row, team)
        spec_id, confidence = _match_icon(icon, templates)
        profession_id = SPEC_TO_PROFESSION.get(spec_id) if spec_id else None
        cv_results.append({
            "spec_id": spec_id,
            "profession_id": profession_id,
            "cv_confidence": round(confidence, 3),
        })
        logger.info("Row %d (%s): spec=%s confidence=%.3f", i, team, spec_id, confidence)

    cv_elapsed = time.perf_counter() - total_start
    logger.info("CV matching done in %.2fs", cv_elapsed)

    # Step 4: LLM call for names (async)
    llm_result = await _extract_names_llm(image_b64, media_type)
    llm_elapsed = time.perf_counter() - total_start - cv_elapsed
    logger.info("LLM call done in %.2fs", llm_elapsed)

    # Step 5: Merge CV + LLM results
    red_team = []
    blue_team = []
    user_team_color = "red"
    highlighted_name = None

    if llm_result:
        user_team_color = llm_result.get("user_team_color", "red")
        highlighted_name = llm_result.get("highlighted_player_name")
        red_names = llm_result.get("red_team_names", ["", "", "", "", ""])
        blue_names = llm_result.get("blue_team_names", ["", "", "", "", ""])
    else:
        red_names = ["", "", "", "", ""]
        blue_names = ["", "", "", "", ""]

    for i in range(5):
        cv = cv_results[i] if i < len(cv_results) else {}
        name = red_names[i] if i < len(red_names) else ""
        is_user = highlighted_name and name == highlighted_name
        red_team.append({
            "character_name": name,
            "profession_id": cv.get("profession_id"),
            "spec_id": cv.get("spec_id"),
            "cv_confidence": cv.get("cv_confidence", 0.0),
            "is_user": bool(is_user),
        })

    for i in range(5):
        cv = cv_results[i + 5] if (i + 5) < len(cv_results) else {}
        name = blue_names[i] if i < len(blue_names) else ""
        is_user = highlighted_name and name == highlighted_name
        blue_team.append({
            "character_name": name,
            "profession_id": cv.get("profession_id"),
            "spec_id": cv.get("spec_id"),
            "cv_confidence": cv.get("cv_confidence", 0.0),
            "is_user": bool(is_user),
        })

    total_elapsed = time.perf_counter() - total_start
    logger.info(
        "=== HYBRID PARSE DONE === %.1fs total (cv=%.1fs, llm=%.1fs)",
        total_elapsed, cv_elapsed, llm_elapsed,
    )

    return {
        "red_team": red_team,
        "blue_team": blue_team,
        "user_team_color": user_team_color,
    }
