"""
MetaBattle PvP builds scraper.

Fetches the PvP builds tier list and individual build pages from MetaBattle.
Outputs raw build data to data/meta/builds.json and tier data to data/meta/tier_list.json.

Usage: python -m scraper.metabattle
"""

import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

BASE_URL = "https://metabattle.com"
PVP_BUILDS_URL = f"{BASE_URL}/wiki/Conquest"
DATA_DIR = Path(__file__).parent.parent / "data" / "meta"

HEADERS = {"User-Agent": "GW2PvPHelper/1.0 (personal match companion tool)"}

REQUEST_DELAY = 2.0  # seconds between requests

# Maps profession names to IDs
PROFESSION_MAP = {
    "guardian": "guardian",
    "warrior": "warrior",
    "revenant": "revenant",
    "ranger": "ranger",
    "thief": "thief",
    "engineer": "engineer",
    "necromancer": "necromancer",
    "elementalist": "elementalist",
    "mesmer": "mesmer",
}

# Maps spec names to IDs (must match elite_specs.json)
SPEC_MAP = {
    "dragonhunter": "dragonhunter",
    "firebrand": "firebrand",
    "willbender": "willbender",
    "herald": "herald_rev",
    "berserker": "berserker",
    "spellbreaker": "spellbreaker",
    "bladesworn": "bladesworn",
    "renegade": "renegade",
    "vindicator": "vindicator_rev",
    "druid": "druid",
    "soulbeast": "soulbeast",
    "untamed": "untamed",
    "daredevil": "daredevil",
    "deadeye": "deadeye",
    "specter": "specter",
    "scrapper": "scrapper",
    "holosmith": "holosmith",
    "mechanist": "mechanist",
    "reaper": "reaper",
    "scourge": "scourge",
    "harbinger": "harbinger",
    "tempest": "tempest",
    "weaver": "weaver",
    "catalyst": "catalyst",
    "chronomancer": "chronomancer",
    "mirage": "mirage",
    "virtuoso": "virtuoso",
}


def _normalize_name(name: str) -> str:
    return name.strip().lower().replace(" ", "").replace("'", "").replace("-", "")


def _resolve_spec_id(spec_name: str) -> str | None:
    normalized = _normalize_name(spec_name)
    for key, val in SPEC_MAP.items():
        if _normalize_name(key) == normalized:
            return val
    return None


def _resolve_profession_id(name: str) -> str | None:
    normalized = _normalize_name(name)
    for key, val in PROFESSION_MAP.items():
        if _normalize_name(key) == normalized:
            return val
    return None


def _find_profession_for_spec(spec_id: str) -> str | None:
    """Look up profession from elite_specs.json."""
    specs_path = Path(__file__).parent.parent / "data" / "game" / "elite_specs.json"
    with open(specs_path) as f:
        data = json.load(f)
    for s in data["elite_specs"]:
        if s["id"] == spec_id:
            return s["profession_id"]
    return None


async def fetch_page(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        resp = await client.get(url, headers=HEADERS, follow_redirects=True, timeout=30)
        if resp.status_code == 200:
            return resp.text
        print(f"  [WARN] {resp.status_code} for {url}")
        return None
    except Exception as e:
        print(f"  [ERROR] {e} for {url}")
        return None


def parse_tier_list(html: str) -> dict[str, list[dict]]:
    """Parse the PvP builds page for tier sections and build links."""
    soup = BeautifulSoup(html, "html.parser")
    tiers = {}

    # MetaBattle uses heading + table/list structure for tiers
    # Look for tier section headers and their associated build links
    current_tier = None

    for heading in soup.find_all(["h2", "h3"]):
        text = heading.get_text(strip=True).lower()

        # Identify tier headings
        if "meta" in text and "tournament" not in text:
            current_tier = "meta"
        elif "tournament" in text:
            current_tier = "tournament_meta"
        elif "great" in text:
            current_tier = "great"
        elif "good" in text:
            current_tier = "good"
        else:
            continue

        if current_tier not in tiers:
            tiers[current_tier] = []

        # Find the next sibling that contains build links
        sibling = heading.find_next_sibling()
        while sibling and sibling.name not in ["h2", "h3"]:
            for link in sibling.find_all("a", href=True):
                href = link["href"]
                if "/wiki/" in href and ("Build:" in href or "build:" in href.lower()):
                    build_name = link.get_text(strip=True)
                    if build_name:
                        tiers[current_tier].append(
                            {
                                "name": build_name,
                                "url": BASE_URL + href if href.startswith("/") else href,
                            }
                        )
            sibling = sibling.find_next_sibling()

    # Fallback: scan all links with Build: pattern
    if not any(tiers.values()):
        all_build_links = soup.find_all("a", href=re.compile(r"/wiki/Build:", re.I))
        if all_build_links:
            tiers["unknown"] = []
            for link in all_build_links:
                href = link["href"]
                name = link.get_text(strip=True)
                if name and not any(name == b["name"] for builds in tiers.values() for b in builds):
                    tiers["unknown"].append(
                        {
                            "name": name,
                            "url": BASE_URL + href if href.startswith("/") else href,
                        }
                    )

    return tiers


def parse_build_page(html: str, url: str, tier: str) -> dict | None:
    """Extract build details from a MetaBattle build page."""
    soup = BeautifulSoup(html, "html.parser")

    # Title: usually "Build:Spec - Name" or similar
    title_el = soup.find("h1") or soup.find("title")
    if not title_el:
        return None
    title = title_el.get_text(strip=True).replace("- MetaBattle Guild Wars 2 Builds", "").strip()

    # Try to extract spec and build name from title pattern "Build:Spec - Name"
    # or from URL pattern /wiki/Build:Spec_-_Name
    spec_name = None
    build_name = title

    # Parse from URL
    url_match = re.search(r"/wiki/Build:(\w+)_-_(.+)", url)
    if url_match:
        spec_name = url_match.group(1).replace("_", " ")
        build_name = url_match.group(2).replace("_", " ")

    # Try from title
    title_match = re.match(r"(?:Build:)?\s*(\w[\w\s]*?)\s*[-—]\s*(.+)", title)
    if title_match and not spec_name:
        spec_name = title_match.group(1).strip()
        build_name = title_match.group(2).strip()

    if not spec_name:
        spec_name = title

    spec_id = _resolve_spec_id(spec_name)
    profession_id = _find_profession_for_spec(spec_id) if spec_id else None

    # If we couldn't find the spec, try harder with the title words
    if not spec_id:
        for word in title.split():
            spec_id = _resolve_spec_id(word)
            if spec_id:
                profession_id = _find_profession_for_spec(spec_id)
                break

    if not spec_id:
        for word in re.split(r"[\s_\-]+", url.split("/")[-1]):
            spec_id = _resolve_spec_id(word)
            if spec_id:
                profession_id = _find_profession_for_spec(spec_id)
                break

    # Extract weapons from equipment section
    weapons = []
    weapon_section = soup.find(string=re.compile(r"Weapons?", re.I))
    if weapon_section:
        parent = weapon_section.find_parent()
        if parent:
            for item in parent.find_all_next(["span", "div", "td"], limit=20):
                text = item.get_text(strip=True).lower()
                for w in [
                    "sword",
                    "dagger",
                    "staff",
                    "greatsword",
                    "hammer",
                    "mace",
                    "axe",
                    "longbow",
                    "shortbow",
                    "rifle",
                    "pistol",
                    "scepter",
                    "focus",
                    "torch",
                    "warhorn",
                    "shield",
                ]:
                    if w in text and w not in weapons:
                        weapons.append(w)

    # Extract key skills
    skills = []
    for skill_el in soup.select(".skill-name, .gw2-skill"):
        skill_text = skill_el.get_text(strip=True)
        if skill_text and skill_text not in skills and len(skills) < 15:
            skills.append(skill_text)

    # Extract template code
    template_code = None
    code_el = soup.find(string=re.compile(r"\[&[A-Za-z0-9+/=]+\]"))
    if code_el:
        code_match = re.search(r"\[&[A-Za-z0-9+/=]+\]", str(code_el))
        if code_match:
            template_code = code_match.group(0)

    # Extract usage notes
    usage = []
    usage_header = soup.find(string=re.compile(r"Usage|Guide|Gameplay", re.I))
    if usage_header:
        parent = usage_header.find_parent()
        if parent:
            for sibling in parent.find_next_siblings(limit=5):
                text = sibling.get_text(strip=True)
                if text and len(text) > 20:
                    usage.append(text[:300])

    build_id = re.sub(r"[^a-z0-9]+", "_", build_name.lower()).strip("_")
    if spec_id:
        build_id = f"{spec_id}_{build_id}"

    return {
        "id": build_id,
        "name": build_name,
        "spec_name": spec_name,
        "spec_id": spec_id,
        "profession_id": profession_id,
        "tier": tier,
        "weapons": weapons,
        "key_skills": skills,
        "template_code": template_code,
        "usage_notes": usage,
        "source_url": url,
        "scraped_at": datetime.now().isoformat(),
    }


async def scrape():
    print("Fetching PvP builds page...")
    async with httpx.AsyncClient() as client:
        html = await fetch_page(client, PVP_BUILDS_URL)
        if not html:
            print("Failed to fetch PvP builds page")
            return

        tiers = parse_tier_list(html)
        total_links = sum(len(v) for v in tiers.values())
        print(f"Found {total_links} build links across {len(tiers)} tiers")

        # Save tier list
        tier_data = {
            "tiers": {k: [b["name"] for b in v] for k, v in tiers.items()},
            "last_updated": datetime.now().isoformat(),
        }
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(DATA_DIR / "tier_list.json", "w") as f:
            json.dump(tier_data, f, indent=2)
        print(f"Saved tier list to {DATA_DIR / 'tier_list.json'}")

        # Fetch each build page
        builds = []
        seen_urls = set()
        for tier_name, build_links in tiers.items():
            for link in build_links:
                if link["url"] in seen_urls:
                    continue
                seen_urls.add(link["url"])

                print(f"  Fetching: {link['name']} ({tier_name})...")
                await asyncio.sleep(REQUEST_DELAY)

                build_html = await fetch_page(client, link["url"])
                if not build_html:
                    continue

                build = parse_build_page(build_html, link["url"], tier_name)
                if build:
                    builds.append(build)
                    spec = build["spec_id"] or "???"
                    wc, sc = len(build["weapons"]), len(build["key_skills"])
                    print(f"    -> {spec} / {build['name']} ({wc} weapons, {sc} skills)")
                else:
                    print("    -> Could not parse build page")

        # Save builds
        with open(DATA_DIR / "builds.json", "w") as f:
            json.dump({"builds": builds, "last_updated": datetime.now().isoformat()}, f, indent=2)
        print(f"\nDone! Saved {len(builds)} builds to {DATA_DIR / 'builds.json'}")


if __name__ == "__main__":
    asyncio.run(scrape())
