"""
Enrichment module: adds thief-specific (S/D Daredevil) counter strategies to scraped builds.

Takes raw builds from data/meta/builds.json and enriches them with:
- threat_level (AVOID / RESPECT / HUNT)
- counter strategies (kills_you_with, saves_them_with, your_window, gameplan)

Usage: python -m scraper.enrich
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
GAME_DIR = DATA_DIR / "game"
META_DIR = DATA_DIR / "meta"


def _load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


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


# Known dangerous skills that are especially threatening to thief
DANGEROUS_SKILLS = {
    # Instant-kill combos
    "Dragon Trigger": "One-shot potential if fully charged",
    "Magebane Tether": "Strips your boons on hit",
    "Whirling Wrath": "High damage spin — don't stand in it",
    "Kill Shot": "Massive single hit from range",
    "Backstab": "Mirror matchup burst",
    "Death's Judgment": "Massive single hit if you have Malice stacks",
    "Rapid Fire": "High sustained ranged pressure",
    "Barrage": "AoE denial on point",
    "Gravedigger": "Spammable execute below 50%",
    "Hundred Blades": "High damage channel — dodge or blind",
    "Eviscerate": "Big single burst hit",
    "Whirling Defense": "Reflects projectiles + high damage",
    "One Wolf Pack": "Team-wide damage boost — dangerous burst window",
}

# Known defensive skills
DEFENSIVE_SKILLS = {
    "Renewed Focus": "3s invuln + virtue recharge",
    "Endure Pain": "Invuln to direct damage",
    "Full Counter": "Block + counter attack",
    "Infuse Light": "Converts damage to healing",
    "Obsidian Flesh": "Invuln channel",
    "Distortion": "Full evade",
    "Signet of Stone": "Damage immunity",
    "Natural Healing": "Strong passive heal",
    "Shroud": "Second health bar",
    "Reaper's Shroud": "Second health bar + extra damage",
    "Harbinger Shroud": "Second health bar + ranged",
    "Celestial Avatar": "Massive healing mode",
    "Elixir S": "Stealth + invuln",
    "Shield of Courage": "Frontal block",
}


def _infer_kills_you(build: dict, spec: dict | None) -> str:
    """Infer what the build kills you with based on skills and spec."""
    skills = build.get("key_skills", [])
    threats = []

    for skill in skills:
        for dangerous, desc in DANGEROUS_SKILLS.items():
            if dangerous.lower() in skill.lower():
                threats.append(f"{skill}: {desc}")

    if threats:
        return "; ".join(threats[:3])

    # Fallback to spec profile
    if spec:
        tp = spec.get("threat_profile", {})
        if tp.get("burst", 0) >= 4:
            return f"{spec['name']} burst combo (watch for cooldown windows)"
        if tp.get("control", 0) >= 4:
            return f"{spec['name']} CC chain into burst"
    return "Sustained pressure — avoid prolonged fights"


def _infer_saves_them(build: dict, spec: dict | None) -> str:
    """Infer what saves this build from dying."""
    skills = build.get("key_skills", [])
    defenses = []

    for skill in skills:
        for defensive, desc in DEFENSIVE_SKILLS.items():
            if defensive.lower() in skill.lower():
                defenses.append(f"{skill}: {desc}")

    if defenses:
        return "; ".join(defenses[:3])

    if spec:
        tp = spec.get("threat_profile", {})
        if tp.get("sustain", 0) >= 4:
            return f"High sustain from {spec['name']} kit"
        roles = spec.get("role_tags", [])
        if "support" in roles:
            return "Team heals — hard to kill with allies nearby"
    return "Dodge/evade skills — bait before committing"


def _infer_window(build: dict, spec: dict | None) -> str:
    """Infer the best window to attack."""
    if spec:
        tp = spec.get("threat_profile", {})
        roles = spec.get("role_tags", [])

        if tp.get("sustain", 0) >= 5:
            return "After they exhaust sustain cooldowns — long fights favor them"
        if tp.get("burst", 0) >= 4:
            return "After they blow burst combo — 8-12s window before it returns"
        if "bunker" in roles:
            return "Don't commit — decap and leave, they can't chase"
        if tp.get("mobility", 0) <= 2:
            return "Catch in rotation — they can't escape you"
    return "After dodge/evade skills are on cooldown"


def _build_gameplan(build: dict, spec: dict | None, profession: dict | None, threat: str) -> list[str]:
    """Generate 3-5 bullet point gameplan."""
    plan = []
    roles = spec.get("role_tags", []) if spec else []
    tp = spec.get("threat_profile", {}) if spec else {}
    weapons = build.get("weapons", [])
    armor = profession.get("armor_class", "medium") if profession else "medium"
    hp = profession.get("hp_tier", "medium") if profession else "medium"

    if threat == "HUNT":
        if armor == "light":
            plan.append("Light armor — your S/D burst hits very hard")
        if hp == "low":
            plan.append("Low HP — can kill from 100-0 in one burst rotation")
        plan.append("Engage aggressively, steal opener for the boon strip")
        if tp.get("mobility", 0) <= 2:
            plan.append("Low mobility — they can't escape your engages")

    elif threat == "AVOID":
        plan.append("Do NOT 1v1 — find a +1 or ignore them")
        if tp.get("sustain", 0) >= 5:
            plan.append("Way too tanky to kill solo — you'll waste time and cooldowns")
        if tp.get("control", 0) >= 4:
            plan.append("Heavy CC — one chain and you're dead. Keep your dodges")
        if "bunker" in roles:
            plan.append("Bunker build — decap their node and rotate, don't stay")

    else:  # RESPECT
        plan.append("Winnable 1v1 — but respect their cooldowns before committing")
        if tp.get("burst", 0) >= 4:
            plan.append("High burst — dodge their opener, then counter-attack")
        if tp.get("control", 0) >= 4:
            plan.append("Can lock you down — save dodge for their CC")

    # Role-specific advice
    if "support" in roles:
        plan.append("PRIORITY TARGET in teamfights — killing them removes enemy sustain")
    if "roamer" in roles and threat != "AVOID":
        plan.append("Fellow roamer — you'll fight them on side nodes often. Learn the matchup")

    # Weapon-specific
    if "rifle" in weapons:
        plan.append("Has rifle — close gap fast, they're weaker in melee")
    if "longbow" in weapons:
        plan.append("Has longbow — dodge Rapid Fire, close gap with steal/dash")
    if "greatsword" in weapons and spec and spec.get("profession_id") == "necromancer":
        plan.append("GS Reaper — don't stand in melee range during Gravedigger range")
    if "shield" in weapons:
        plan.append("Has shield — expect blocks, don't waste burst into Shield 4/5")

    return plan[:5]


def _determine_threat(build: dict, spec: dict | None, profession: dict | None) -> str:
    """Determine threat level for S/D Daredevil."""
    if not spec:
        return "RESPECT"

    tp = spec.get("threat_profile", {})
    roles = spec.get("role_tags", [])
    tier = build.get("tier", "")

    burst = tp.get("burst", 3)
    sustain = tp.get("sustain", 3)
    mobility = tp.get("mobility", 3)
    control = tp.get("control", 3)

    # Hard counters for thief
    if sustain >= 5 and ("bunker" in roles or "support" in roles):
        return "AVOID"
    if burst >= 4 and control >= 4:
        return "AVOID"  # Can lock you down AND kill you

    # Easy targets
    armor = profession.get("armor_class", "medium") if profession else "medium"
    hp = profession.get("hp_tier", "medium") if profession else "medium"

    if armor == "light" and sustain <= 3 and burst <= 3:
        return "HUNT"
    if hp == "low" and sustain <= 2:
        return "HUNT"
    if mobility <= 2 and sustain <= 3 and control <= 3:
        return "HUNT"

    # Tournament/meta tier builds are generally more threatening
    if tier in ("tournament_meta", "meta") and burst >= 4:
        return "AVOID"

    return "RESPECT"


def enrich():
    professions = _load_json(GAME_DIR / "professions.json")["professions"]
    specs = _load_json(GAME_DIR / "elite_specs.json")["elite_specs"]
    builds_data = _load_json(META_DIR / "builds.json")
    builds = builds_data.get("builds", [])

    if not builds:
        print("No builds to enrich. Run 'just scrape' first.")
        return

    enriched = 0
    for build in builds:
        spec = _get_spec(build.get("spec_id"), specs)
        profession = _get_profession(build.get("profession_id"), professions)

        threat = _determine_threat(build, spec, profession)
        build["threat_level"] = threat
        build["counter"] = {
            "threat_level": threat,
            "kills_you_with": _infer_kills_you(build, spec),
            "saves_them_with": _infer_saves_them(build, spec),
            "your_window": _infer_window(build, spec),
            "gameplan": _build_gameplan(build, spec, profession, threat),
        }
        enriched += 1
        print(f"  {build.get('spec_id', '?'):20s} | {build['name']:30s} | {threat}")

    builds_data["builds"] = builds
    with open(META_DIR / "builds.json", "w") as f:
        json.dump(builds_data, f, indent=2)

    print(f"\nEnriched {enriched} builds. Saved to {META_DIR / 'builds.json'}")


if __name__ == "__main__":
    enrich()
