"""Fetch GW2 elite specialization icons and generate template silhouettes for CV matching.

Usage:
    python -m scraper.fetch_spec_icons

Downloads spec icons from the GW2 API, then processes each into a 32x32
grayscale silhouette mask suitable for OpenCV template matching.
"""

import asyncio
import logging
from pathlib import Path

import cv2
import httpx
import numpy as np

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
RAW_DIR = DATA_DIR / "icons" / "raw"
TEMPLATE_DIR = DATA_DIR / "icons" / "templates"

GW2_API = "https://api.guildwars2.com/v2"

# Map (API spec name, profession) → project string ID
# Keyed by tuple to handle name collisions (e.g. Herald exists for both Guardian and Revenant)
API_SPEC_TO_PROJECT_ID = {
    # Guardian
    ("Dragonhunter", "guardian"): "dragonhunter",
    ("Firebrand", "guardian"): "firebrand",
    ("Willbender", "guardian"): "willbender",
    ("Luminary", "guardian"): "herald",
    # Warrior
    ("Berserker", "warrior"): "berserker",
    ("Spellbreaker", "warrior"): "spellbreaker",
    ("Bladesworn", "warrior"): "bladesworn",
    ("Paragon", "warrior"): "vindicator",
    # Revenant
    ("Herald", "revenant"): "herald_rev",
    ("Renegade", "revenant"): "renegade",
    ("Vindicator", "revenant"): "vindicator_rev",
    # Ranger
    ("Druid", "ranger"): "druid",
    ("Soulbeast", "ranger"): "soulbeast",
    ("Untamed", "ranger"): "untamed",
    # Thief
    ("Daredevil", "thief"): "daredevil",
    ("Deadeye", "thief"): "deadeye",
    ("Specter", "thief"): "specter",
    # Engineer
    ("Scrapper", "engineer"): "scrapper",
    ("Holosmith", "engineer"): "holosmith",
    ("Mechanist", "engineer"): "mechanist",
    # Necromancer
    ("Reaper", "necromancer"): "reaper",
    ("Scourge", "necromancer"): "scourge",
    ("Harbinger", "necromancer"): "harbinger",
    # Elementalist
    ("Tempest", "elementalist"): "tempest",
    ("Weaver", "elementalist"): "weaver",
    ("Catalyst", "elementalist"): "catalyst",
    # Mesmer
    ("Chronomancer", "mesmer"): "chronomancer",
    ("Mirage", "mesmer"): "mirage",
    ("Virtuoso", "mesmer"): "virtuoso",
}

# Core profession icons use the profession endpoint
CORE_PROFESSIONS = [
    "guardian", "warrior", "revenant", "ranger", "thief",
    "engineer", "necromancer", "elementalist", "mesmer",
]


def _make_silhouette(image_bytes: bytes, size: int = 32) -> np.ndarray:
    """Convert a PNG icon (with alpha) into a grayscale silhouette mask.

    Extracts the alpha channel as the silhouette shape, thresholds it,
    and resizes to the canonical template size.
    """
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)  # BGRA

    if img is None:
        raise ValueError("Failed to decode image")

    if img.shape[2] == 4:
        # Use alpha channel as silhouette
        alpha = img[:, :, 3]
    else:
        # No alpha — convert to grayscale and threshold
        alpha = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Threshold to clean binary mask
    _, mask = cv2.threshold(alpha, 128, 255, cv2.THRESH_BINARY)

    # Resize to canonical size
    mask = cv2.resize(mask, (size, size), interpolation=cv2.INTER_AREA)

    return mask


async def _fetch_specializations(client: httpx.AsyncClient) -> list[dict]:
    """Fetch all specializations from GW2 API."""
    resp = await client.get(f"{GW2_API}/specializations?ids=all")
    resp.raise_for_status()
    return resp.json()


async def _fetch_professions(client: httpx.AsyncClient) -> dict[str, dict]:
    """Fetch all professions from GW2 API, keyed by lowercase name."""
    resp = await client.get(f"{GW2_API}/professions?ids=all")
    resp.raise_for_status()
    return {p["name"].lower(): p for p in resp.json()}


async def _download_icon(client: httpx.AsyncClient, url: str) -> bytes:
    """Download an icon PNG."""
    resp = await client.get(url)
    resp.raise_for_status()
    return resp.content


async def fetch_and_process():
    """Main pipeline: fetch icons from API and generate templates."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=30) as client:
        specs, professions = await asyncio.gather(
            _fetch_specializations(client),
            _fetch_professions(client),
        )

        # Process elite specs
        downloaded = 0
        for spec in specs:
            if not spec.get("elite"):
                continue

            name = spec["name"]
            profession = spec["profession"].lower()

            key = (name, profession)
            if key in API_SPEC_TO_PROJECT_ID:
                project_id = API_SPEC_TO_PROJECT_ID[key]
            else:
                logger.warning("Unknown elite spec: %s (%s), skipping", name, profession)
                continue

            icon_url = spec.get("profession_icon") or spec.get("icon")
            if not icon_url:
                logger.warning("No icon URL for %s", name)
                continue

            try:
                icon_bytes = await _download_icon(client, icon_url)

                # Save raw
                raw_path = RAW_DIR / f"{project_id}.png"
                raw_path.write_bytes(icon_bytes)

                # Generate and save template
                mask = _make_silhouette(icon_bytes)
                template_path = TEMPLATE_DIR / f"{project_id}.png"
                cv2.imwrite(str(template_path), mask)

                downloaded += 1
                logger.info("OK: %s → %s", name, project_id)
            except Exception:
                logger.exception("Failed to process %s", name)

        # Process core professions (use profession icon)
        for prof_name in CORE_PROFESSIONS:
            prof = professions.get(prof_name)
            if not prof:
                logger.warning("Profession not found: %s", prof_name)
                continue

            project_id = f"core_{prof_name}"
            icon_url = prof.get("icon")
            if not icon_url:
                logger.warning("No icon URL for core %s", prof_name)
                continue

            try:
                icon_bytes = await _download_icon(client, icon_url)

                raw_path = RAW_DIR / f"{project_id}.png"
                raw_path.write_bytes(icon_bytes)

                mask = _make_silhouette(icon_bytes)
                template_path = TEMPLATE_DIR / f"{project_id}.png"
                cv2.imwrite(str(template_path), mask)

                downloaded += 1
                logger.info("OK: core_%s", prof_name)
            except Exception:
                logger.exception("Failed to process core %s", prof_name)

        logger.info("Done: %d icons downloaded and processed", downloaded)
        print(f"Downloaded and processed {downloaded} icons")
        print(f"  Raw icons: {RAW_DIR}")
        print(f"  Templates: {TEMPLATE_DIR}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    asyncio.run(fetch_and_process())
