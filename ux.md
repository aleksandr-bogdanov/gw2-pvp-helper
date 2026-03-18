# GW2 PvP Helper — UX & Architecture Spec

## Design Philosophy

**The 60-Second Rule**: Every design decision serves one constraint — you have ~60 seconds between seeing the scoreboard and the match starting. By match 50, this should take under 10 seconds.

**Core insight**: The app has two completely different UX modes:
1. **Cold start** (first ~20 matches): Most players are unknown, spec detection needs correction, role assignment is manual. Heavy interaction.
2. **Warm state** (match 50+): Most players recognized from history, specs pre-filled from last encounter, auto-confirmed with high confidence. Near-zero interaction.

The design must serve *both* without making cold start tedious or warm state cluttered.

---

## Data Model

```
user_profiles          (your characters — you may play multiple)
├── id                 PK (auto-increment)
├── character_name     "Allenheim" / "Paragonname"
├── profession         "thief" / "warrior"
├── spec               "daredevil" / "paragon"
├── build_label        "S/D Power Daredevil" / "Staff Support Paragon"
├── role               "roamer" | "duelist" | "support" | "teamfighter"
├── weapons_main       "Sword/Dagger" / "Staff"
├── weapons_swap       "Shortbow" / "Sword/Warhorn"
├── profile_prompt     TEXT — Claude-generated Layer 2 prompt for this character
├── is_active          boolean (which one you're currently queueing as)
└── created_at

players                (every OTHER player you've ever seen)
├── character_name     PK
├── profession         always detectable from icon shape
├── spec               last confirmed spec
├── role               last confirmed role (dps/support/heal)
├── spec_source        "detected" | "corrected" | "history"
├── times_seen         int
├── wins_against       int (matches where this player was on enemy team and you won)
├── losses_against     int
└── last_seen_at

matches
├── match_id           PK (uuid)
├── timestamp
├── user_profile_id    FK → user_profiles (which character you played this match)
├── user_team_color    "red" | "blue"
├── map                nullable (not in screenshot)
├── result             nullable ("win" | "loss" — entered post-match)
└── notes              nullable (free text, e.g. "their FB was insane")

match_players
├── match_id           FK
├── character_name     FK → players
├── team               "ally" | "enemy"
├── profession
├── spec
└── role
```

**Key relationships**: `players` is the memory, keyed by character_name (what the scoreboard shows). Account names aren't visible on the PvP scoreboard, so character_name is the only reliable identifier from a screenshot. If a player switches characters between matches, they'll appear as a new entry — acceptable tradeoff since most PvP players stick to one character per session.

`user_profiles` supports multiple characters with completely different roles. The `profile_prompt` field stores a Claude-generated text block describing the character's skills, strengths, weaknesses, and playstyle — this is injected into the tactical advisor's system prompt at match time. The `role` field determines which output format template is used (DPS/roamer output vs support output). See **System Prompt Architecture** for how the three layers assemble.

---

## Screen Flow

### Screen 0: Idle State (Between Matches)

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  Playing as: [ Daredevil ] [ Paragon ]  [⚙]     │
│                                                  │
│           [ Ctrl+V to scout match ]              │
│                                                  │
│           or drag screenshot here                │
│                                                  │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ Last match: 4 min ago  W  vs Reaper/FB/...  │ │
│  │ Session: 5W 2L (71%)          [History →]   │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- Full-window paste target. `Ctrl+V` is captured globally, always.
- Drag-and-drop also works.
- **Character toggle** at the top — shows all entries from `user_profiles`. The active character determines which system prompt layers are assembled for advice. Daredevil gets kill priorities and stolen skill tips; Paragon gets babysitting targets and banner timing.
- **Settings gear [⚙]** — opens the profile management screen where you can add/edit/delete character profiles.
- **Auto-detect from screenshot**: Haiku identifies which player is you (the one with `is_user: true`). If Haiku reads your profession as Warrior this match, the app auto-switches to the Paragon profile. If Thief, switches to Daredevil. No manual toggle needed in most cases — just a fallback if auto-detect fails.
- Subtle session stats at the bottom — not distracting, just context.

**First launch**: If no profiles exist, the app redirects to the **Profile Creation Flow** (see below) before anything else. The app cannot give advice without knowing your build — profile creation is not optional, it's the first thing you do.

---

### Profile Management Screen (Settings)

Accessible via the [⚙] gear icon on the idle screen. Lists all character profiles with options to add, edit, or delete.

```
┌─────────────────────────────────────────────────────────────┐
│  CHARACTER PROFILES                                [← Back]  │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  ★ S/D Power Daredevil          Thief · Roamer    [Edit]    │
│    Allenheim                                                 │
│                                                              │
│    Staff Support Paragon         Warrior · Support  [Edit]   │
│    Paragonname                                               │
│                                                              │
│  [ + Add Character ]                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Clicking "Add Character" or "Edit" opens the **Profile Creation Flow**.

---

### Profile Creation Flow (Claude-Assisted)

This is how character profiles are created. It runs once per character (or when you change builds), not every match. The flow uses a separate Claude API call to generate the `profile_prompt` — the character-specific layer of the tactical advisor's system prompt.

#### Step 1: Basic Info (Form, no API call)

```
┌─────────────────────────────────────────────────────────────┐
│  CREATE CHARACTER PROFILE                                    │
│                                                              │
│  Character Name:  [ Allenheim          ]                     │
│                                                              │
│  Profession:      [ Thief ▾ ]                                │
│                                                              │
│  Elite Spec:      [ Daredevil ▾ ]    (filtered by profession)│
│                                                              │
│  Role:  ( Roamer ) ( Duelist ) ( Support ) ( Teamfighter )   │
│         ↑ tooltips on hover explain each role                │
│                                                              │
│  Weapons (main):  [ Sword ▾ ] / [ Dagger ▾ ]                │
│  Weapons (swap):  [ Shortbow ▾ ] / [ none ▾ ]               │
│                    ↑ filtered by profession — only equippable │
│                      weapons shown                           │
│                                                              │
│  Build Name:      [ S/D Power Daredevil ]  (optional label)  │
│                                                              │
│  [ NEXT → ]                                                  │
└─────────────────────────────────────────────────────────────┘
```

All fields are dropdowns or toggles populated from static game data:

**Professions**: 9 options. **Elite specs**: filtered by selected profession (4 + core). **Role**: 4 options with tooltip descriptions:
- **Roamer**: Fast rotation between points. +1 fights. Decap and leave. Never sit on a node.
- **Duelist**: Hold side nodes in 1v1. Win extended fights. Your point is your job.
- **Support**: Stay with team. Heal and buff. Never chase. Teammates die without you nearby.
- **Teamfighter**: Group fight specialist. Win mid brawls. Cleave downed. Strongest with allies around.

**Weapons**: filtered by profession. Weapon availability per profession is static game data (includes Weaponmaster Training from SotO and Spear from JW). Stored in `data/weapons.json`.

#### Step 2: Playstyle Description (Free Text)

```
┌─────────────────────────────────────────────────────────────┐
│  DESCRIBE YOUR BUILD                                         │
│                                                              │
│  How do you play this build? What's your gameplan?           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ I rotate fast between points, arrive at fights to turn  │ │
│  │ 1v1s into 2v1s. I burst with Sword 2 into Flanking     │ │
│  │ Strike, strip boons with Larcenous. I use Shortbow for  │ │
│  │ ranged poke and mobility. I don't win long 1v1s.       │ │
│  │ Steal to interrupt heals and rezzes. Shadowstep is my   │ │
│  │ stunbreak. Dagger Storm for teamfight cleave.           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  What gets you killed most often? (optional)                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Condition pressure, getting CC chained, staying in      │ │
│  │ melee too long against tanky specs like Reaper          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [ ← BACK ]                    [ GENERATE PROFILE → ]       │
└─────────────────────────────────────────────────────────────┘
```

Free text in the user's own words. Can be as brief as "I just started, I don't know what I'm doing yet" — Claude will generate a simpler, more cautious profile. A veteran can write detailed skill sequences. Both are valid.

#### Step 3: Claude Generates the Profile Prompt

Clicking "Generate Profile" sends a one-time API call to Claude Sonnet with a **profile generation** system prompt (separate from the tactical advisor prompt). See **System Prompt Architecture → Profile Generation Prompt** for the full prompt.

Claude receives the structured form data + free text description and returns a formatted profile covering: build summary, key offensive/defensive tools (with correct GW2 skill names inferred from the description), stolen skills (if Thief), strengths, weaknesses, and a role description. This output becomes the `profile_prompt` stored in the DB.

#### Step 4: Review and Save

```
┌─────────────────────────────────────────────────────────────┐
│  PROFILE GENERATED                                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ PLAYER BUILD SUMMARY:                                   │ │
│  │ - Profession: Thief — Daredevil                         │ │
│  │ - Weapons: Sword/Dagger + Shortbow                      │ │
│  │ - Role: Roamer                                          │ │
│  │                                                         │ │
│  │ KEY OFFENSIVE TOOLS:                                    │ │
│  │ - Steal (F1): 1200 range gap closer + interrupt...      │ │
│  │ - Infiltrator's Strike (Sword 2): Shadowstep to...      │ │
│  │ ...                                                     │ │
│  │                                                         │ │
│  │ STRENGTHS:                                              │ │
│  │ - Fastest rotation speed in the game...                 │ │
│  │ ...                                                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [ ← REGENERATE ]    [ EDIT MANUALLY ]    [ SAVE ✓ ]        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Three options:
- **Save** — accepts the generated profile, stores it in `user_profiles.profile_prompt`
- **Regenerate** — goes back to step 2 to adjust description, re-runs the API call
- **Edit manually** — opens the profile text as editable. Power users can tweak skill descriptions or add nuance. This text IS the prompt layer — what you write here is literally what Claude reads during matches.

---

### Screen 1: Processing (1-2 seconds)

When you paste, the screenshot goes to Haiku API immediately. During processing:

```
┌─────────────────────────────────────────────────┐
│                                                  │
│         Scanning scoreboard...                   │
│         ████████████░░░░  analyzing              │
│                                                  │
└─────────────────────────────────────────────────┘
```

This is intentionally minimal. No skeleton loaders, no fake progress bars. Just a clear "working" state. Should be 1-2 seconds max with Haiku.

---

### Screen 2: Roster Review + Correction (THE CORE SCREEN)

This is where the app lives or dies. The flow is strictly sequential: **review roster → pick map → get advice**. The tactical briefing does NOT auto-generate — it fires only when you click a button, sending the corrected data to Claude API. This gives you time to fix errors before spending an API call.

#### Layout (Before Advice)

```
┌─────────────────────────────────────────────────────────────┐
│  ENEMY TEAM                                                 │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ⚔ Anotherjohny     Herald (Power)        ✓ seen 3x       │
│  ⚔ Exbelive         Soulbeast (Power)     ✓ seen 1x       │
│  ⚔ The Last Citizen  Reaper               ✓ seen 5x       │
│  ⚔ Drowishki        Berserker (Power)     ? NEW           │
│  ⚔ Physsi           Chronomancer (Supp)   ~ detected      │
│                                                             │
│  YOUR TEAM                                                  │
│  ─────────────────────────────────────────────────────────  │
│  ★ Allenheim         Daredevil             YOU             │
│  ⚔ Chupakabrada     Mechanist (Alac)      ✓ seen 2x      │
│  ⚔ Je Suis Bonobo   Harbinger             ? NEW           │
│  ⚔ Schnabel Tasse   Spellbreaker          ✓ seen 1x      │
│  ⚔ Dajag            Firebrand [DPS|HEAL]  ~ detected      │
│                                                             │
│  MAP  [ Conquest ▾ ]                                        │
│                                                             │
│  [ ⚡ GET ADVICE ]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Map Selector

Inline dropdown below the roster. Options:

| Map | Mode | Mechanic |
|-----|------|----------|
| **Conquest (generic)** | Conquest | Standard 3-point — default if map unknown |
| **Legacy of the Foefire** | Conquest | Lord room — kill enemy lord for massive points |
| **Battle of Kyhlo** | Conquest | Trebuchet — siege weapon on each side |
| **Temple of the Silent Storm** | Conquest | Stillness (doubles node income) + Tranquility (instant cap all 3) |
| **Forest of Niflhel** | Conquest | Svanir + Chieftain bosses (25pts + stat buff each) |
| **Eternal Coliseum** | Conquest | Sword of Reaping + Shield buffs |
| **Revenge of the Capricorn** | Conquest | Bell — temporary 4th node, escalating bonus points |
| **Skyhammer** | Conquest | Skyhammer cannon platform (neutralizes nodes) |
| **Djinn's Dominion** | Conquest | Sandstorm periodically blocks LoS across mid |
| **Spirit Watch** | Conquest | Orb — carry to nodes for bonus points |
| **Sunjiang Backstreets** | Push | Jade Consoles + Cannon Controller |
| **Battle of Champion's Dusk** | Stronghold | Supply → NPCs → kill enemy Guild Lord |

If you've played the same map recently, it could default to that, but honestly just picking from a dropdown takes 1 second. Not worth over-engineering.

#### The "Get Advice" Button

This is the explicit trigger. Clicking it:
1. Freezes the roster (no more edits — prevents accidental changes during API call)
2. Sends the finalized roster + map + your build to `POST /api/advice`
3. Server forwards to Claude Sonnet API with a carefully crafted system prompt
4. Streams the response back, rendering below the button as it arrives

The button is large, obvious, and has a keyboard shortcut (`Enter` or `Ctrl+Enter`).

#### Player Row States

Each player row has one of four states, shown via a status badge on the right:

| State | Badge | Meaning | Interaction needed? |
|-------|-------|---------|-------------------|
| **History match** | `✓ seen 3x` (green) | Player seen before, spec loaded from DB with `corrected` source | None — auto-confirmed |
| **History (detected only)** | `~ seen 2x` (amber) | Seen before but spec was never manually corrected | Glance to confirm |
| **New + detected** | `~ detected` (amber) | First time seeing this player, LLM guessed the spec | May need correction |
| **New + unknown** | `? NEW` (gray) | First time, LLM couldn't determine spec (or profession only) | Needs spec assignment |

#### Spec Correction: One-Tap Cycling

Clicking/tapping the **spec name** on any row cycles through that profession's elite specs:

```
Guardian specs:     Willbender → Firebrand → Luminary → Dragonhunter → (core Guardian)
Revenant specs:     Conduit → Herald → Renegade → Vindicator → (core Revenant)
Warrior specs:      Paragon → Berserker → Spellbreaker → Bladesworn → (core Warrior)
Engineer specs:     Holosmith → Scrapper → Mechanist → Amalgam → (core Engineer)
Ranger specs:       Soulbeast → Galeshot → Druid → Untamed → (core Ranger)
Thief specs:        Daredevil → Specter → Deadeye → Antiquary → (core Thief)
Elementalist specs: Evoker → Tempest → Catalyst → Weaver → (core Elementalist)
Mesmer specs:       Virtuoso → Mirage → Chronomancer → Troubadour → (core Mesmer)
Necromancer specs:  Reaper → Scourge → Harbinger → Ritualist → (core Necromancer)
```

This is the fastest possible correction. No dropdowns, no modals. One click = next spec. Since there are 4 elite specs + core per profession, worst case is 4 clicks to get the right one.

**Visual feedback**: On click, the spec name does a quick left-to-right text swap animation (slide old text out, slide new text in). The status badge changes from `~ detected` to `✓ corrected`.

#### Role Assignment: Inline Toggle

For specs with multiple viable PvP builds, a small toggle appears *inline* after the spec name:

```
Firebrand [DPS|HEAL]     ← two-button toggle, one is highlighted
Scrapper [DPS|SUPP]
Mechanist [DPS|ALAC]
Herald [DPS|SUPP]
Chronomancer [DPS|SUPP]
Specter [DPS|SUPP]
Scourge [DPS|SUPP]
Tempest [DPS|HEAL]
Soulbeast [PWR|CONDI]
Berserker [PWR|CONDI]
Paragon [DPS|SUPP]      ← VoE spec, DPS spear vs staff support
Luminary [DPS|SUPP]      ← VoE spec, radiant DPS vs support
Conduit [PWR|CONDI]      ← VoE spec, Shiro power vs Mallyx condi
Troubadour [DPS|SUPP]    ← VoE spec, support is more common
```

Specs with only one common PvP build show no toggle — the role is implied. This includes: Reaper, Willbender, Dragonhunter, Bladesworn, Holosmith, Druid, Untamed, Daredevil, Deadeye, Weaver, Catalyst, Mirage, Virtuoso, Harbinger, Vindicator, and the VoE specs Amalgam, Galeshot, Antiquary, Evoker, Ritualist.

**Default selection logic**: If the player has history → use their last role. If new → pick the more common PvP build for that spec. E.g., Firebrand defaults to HEAL (more common in PvP), Mechanist defaults to ALAC.

#### No Auto-Confirm — Explicit "Get Advice" Flow

The app does NOT auto-generate advice. The pipeline is:

1. Haiku parses → roster populates (with history pre-fill where available)
2. You scan, click to correct any wrong specs, toggle roles
3. You pick the map
4. You hit **Get Advice** → Claude Sonnet receives the *corrected* data

**This means**: Corrections happen on clean, accurate data. You never get advice based on a wrong Haiku guess that you haven't noticed yet. The API call is a deliberate action, not a side effect.

**On a warm match** (most players known): paste → glance (all green) → select map → Enter → advice streams in. ~8-10 seconds of interaction, then ~3-4 seconds for Sonnet to respond.

---

### Tactical Briefing Section

After you click **Get Advice**, the briefing streams in below the button via Claude Sonnet API. The response is streamed token-by-token so you start reading immediately — no waiting for the full response.

#### Layout (After Advice)

```
┌─────────────────────────────────────────────────────────────┐
│  ENEMY TEAM                                                 │
│  ... (roster, now read-only / greyed slightly) ...          │
│  YOUR TEAM                                                  │
│  ... (roster, read-only) ...                                │
│                                                             │
│  MAP  Conquest (Legacy of the Foefire)                      │
│                                                             │
│  [ ⚡ GET ADVICE ]  ← now shows "Refresh" if you want to   │
│                       re-roll (e.g. after correcting a spec │
│                       you missed)                           │
│                                                             │
│  ════════════════════════════════════════════════════════   │
│                                                             │
│  TACTICAL BRIEFING                                          │
│                                                             │
│  KILL TARGETS                                               │
│  1. Physsi (Chronomancer) — fragile without CDs, catch      │
│     them between shatters. Steal interrupts Continuum Split │
│  2. Exbelive (Soulbeast) — burst window after Dolyak Stance │
│     expires. Don't engage while stance is up.               │
│                                                             │
│  AVOID / DON'T 1v1                                          │
│  ✕ The Last Citizen (Reaper) — shroud tank, 20k+ effective │
│    HP. Only engage as +1 when shroud is down.               │
│  ✕ Drowishki (Berserker) — condi berserker wins attrition, │
│    disengage after your burst if they survive.              │
│                                                             │
│  THREATS TO YOU                                             │
│  ⚠ Herald boon output — strip stability with Larcenous     │
│    before bursting anyone near the Herald                   │
│  ⚠ Chrono can chain-CC you — hold Shadowstep,              │
│    don't blow both stunbreaks early                         │
│                                                             │
│  ROTATION PLAN (Legacy of the Foefire)                      │
│  → Rush far with SB5. If contested by Soulbeast, fight —   │
│    you win that 1v1 if you dodge Maul. If Reaper is far,   │
│    decap and rotate mid. Spellbreaker holds close.          │
│  → Their comp has no dedicated roamer. You have free        │
│    rotations — abuse the map mobility advantage.            │
│  → Lord rush potential: their backline is squishy if you    │
│    can get a 450+ lead, consider coordinating a lord push.  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### How the Claude API Call Works

`POST /api/advice` on the server assembles a system prompt from three layers and calls Claude Sonnet:

```typescript
// Server-side: POST /api/advice handler
const systemPrompt = buildSystemPrompt(activeProfile);

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  stream: true,
  system: systemPrompt,
  messages: [{
    role: 'user',
    content: buildAdvicePrompt(matchData, activeProfile)
  }]
});

// Stream response back to browser via SSE
```

---

## System Prompt Architecture

The system prompt is assembled at runtime from three layers. This separation means adding a new character never requires editing game knowledge, and updating game knowledge (after a balance patch) never requires touching character profiles.

```
SYSTEM PROMPT (assembled per request)
├── Layer 1: UNIVERSAL GAME KNOWLEDGE (shared, static-ish)
│   ├── All 9 professions + 45 elite specs
│   ├── What each spec does (key skills, defensive tools, threat profile)
│   ├── Stolen skills per profession
│   ├── "Do not hit" reference table
│   ├── Map mechanics and strategies (12 maps)
│   ├── Role definitions (roamer, duelist, support, teamfighter, bunker)
│   └── Team composition analysis rules
│
├── Layer 2: ACTIVE CHARACTER PROFILE (per-character, Claude-generated)
│   ├── Profession, spec, weapons, role
│   ├── Key offensive skills (names + usage)
│   ├── Key defensive skills (names + usage)
│   ├── Stolen skills with priority ranking (if Thief)
│   ├── Strengths and weaknesses
│   └── Role description (how this character approaches a match)
│
└── Layer 3: OUTPUT FORMAT (determined by role)
    ├── If role = roamer/duelist/teamfighter → DPS output template
    └── If role = support → Support output template
```

### Layer 1: Universal Game Knowledge

Lives in a versioned data file (`data/universal-game-knowledge.md`). Updated when the meta shifts or a balance patch drops. Same for every user, every character.

Contents:
- **Profession matchup data**: For each of the ~30 meta builds — spec name, role, weapons, key dangerous skills, key defensive skills, engagement patterns, vulnerability windows
- **Stolen skills table**: 9 entries (one per profession)
- **"Do not hit" reference**: Defiant Stance, Endure Pain, Renewed Focus, Aegis, Obsidian Flesh, Hare's Agility, Reaper Shroud, Stone Heart, Distortion, Magnetic Shield, Full Counter, Shocking Aura
- **Map strategies**: For each of 12 maps — mechanic, rotation advice, secondary objectives, timing
- **Role definitions**: What each role (roamer, duelist, support, teamfighter, bunker) does in a match
- **Comp analysis rules**: 0 supports → aggressive, 1 support → focus or isolate, 2 supports → split and decap, etc.

Source material: the matchup bible (`gw2-pvp-matchup-bible.md`) contains the detailed per-build breakdowns that should be restructured into this format.

### Layer 2: Active Character Profile

The `profile_prompt` field from the user's active `user_profiles` entry. Generated by Claude during the Profile Creation Flow, stored in DB.

This is injected verbatim into the system prompt between Layer 1 and Layer 3. Example for the Daredevil profile:

```
THE PLAYER'S BUILD:

PLAYER BUILD SUMMARY:
- Profession: Thief — Daredevil
- Weapons: Sword/Dagger + Shortbow
- Role: Roamer
- Build label: S/D Power Daredevil

KEY OFFENSIVE TOOLS:
- Steal (F1): 1200 range gap closer + interrupt. Interrupts heals, rezzes, channels.
- Infiltrator's Strike (Sword 2): Shadowstep to target. Press again to return. Primary engage AND disengage.
- Flanking Strike → Larcenous Strike (Sword 3 chain): Evade-frame attack + unblockable boon strip.
- Dancing Dagger (Dagger 4): Ranged, bounces, cripples. Pop Aegis before engaging.
- Infiltrator's Arrow (Shortbow 5): Blast finisher + shadowstep. Primary escape and rotation mobility.
- Dagger Storm (Elite): Reflects projectiles, evade frames. Teamfight cleave.

KEY DEFENSIVE TOOLS:
- Infiltrator's Return (Sword 2 return): Instant disengage to entry point.
- Flanking Strike evade frame: Active evade during attack animation.
- Shadowstep (Utility): Stunbreak + 1200 range teleport. Save for emergencies.
- Stealth (via Cloak and Dagger): Drops targeting, enables escape or re-engage.

STOLEN SKILLS (priority order):
1. Consume Plasma (Mesmer) — gain ALL boons. Best stolen skill. Use immediately.
2. Blinding Tuft (Thief) — free stealth + blind. Amazing for stomps/escapes.
3. Skull Fear (Necromancer) — AoE fear. Great CC for stomps and teamfights.
4. Mace Head Crack (Guardian) — daze. Extra interrupt.
5-9. [remaining stolen skills with brief usage tips]

STRENGTHS:
- Fastest rotation speed in the game
- Excellent +1 potential — turns losing 1v1s into won 2v1s
- Unblockable boon strip counters defensive boon stacking
- Strong burst on squishies

WEAKNESSES:
- Cannot win extended 1v1s against duelists or bunkers
- Vulnerable to condition pressure — limited cleanse
- If CC-chained with Shadowstep on cooldown, likely dead

ROLE DESCRIPTION:
You are a +1 roamer. Your job is to rotate between capture points faster than anyone
else. You do NOT sit on points. You decap and leave. In teamfights, you poke with
Shortbow, then Sword 2 in for burst on low targets, Sword 2 return out. If a fight
is bad, you LEAVE.
```

### Layer 3: Output Format

Two templates, selected by `activeProfile.role`:

**DPS/Roamer/Duelist/Teamfighter format:**
```
Respond in these exact sections. Be terse. No preamble.
Use player names from the match data.

1. TEAM COMP SUMMARY (3 lines max: role breakdown, support check, overall threat)
2. PER-ENEMY BREAKDOWN (for each enemy: threat level, stolen skill if thief, kill window, one-line takeaway)
3. FOCUS ORDER (kill priority: first → last, with one-line reason)
4. DO NOT HIT LIST (filtered to only skills present in THIS enemy comp)
5. MAP STRATEGY (map-specific rotation advice for your role)
6. GENERAL GAMEPLAN (3-5 lines tying comp + map + your build together)
```

**Support format:**
```
Respond in these exact sections. Be terse. No preamble.
Use player names from the match data.

1. TEAM COMP SUMMARY (3 lines max: role breakdown, threat assessment)
2. WHO TO BABYSIT (which teammate benefits most from your support, why)
3. ENEMY THREATS TO YOUR CARRY (what's going to try to kill your DPS)
4. TEAMFIGHT POSITIONING (where to stand relative to team, engagement/disengage signals)
5. KEY COOLDOWN MANAGEMENT (when to use your big abilities — banner, elite, major heal)
6. MAP STRATEGY (map-specific advice focused on team cohesion, not solo roaming)
7. GENERAL GAMEPLAN (3-5 lines)
```

### Assembly Code

```typescript
function buildSystemPrompt(activeProfile: UserProfile): string {
  const layer1 = loadUniversalGameData();  // from data/universal-game-knowledge.md
  const layer2 = activeProfile.profile_prompt;  // from DB
  const layer3 = activeProfile.role === 'support'
    ? SUPPORT_OUTPUT_FORMAT
    : DPS_OUTPUT_FORMAT;

  return `You are a GW2 PvP tactical advisor.\n\n${layer1}\n\nTHE PLAYER'S BUILD:\n${layer2}\n\n${layer3}`;
}
```

### Profile Generation Prompt

A separate system prompt used only during profile creation (not during matches). It tells Claude to analyze the user's build info + playstyle description and output the structured Layer 2 format.

The profile generation prompt has expert GW2 knowledge: given that someone plays Sword/Dagger Daredevil and mentions using Flanking Strike, Claude can infer their full skill bar, trait choices, and specific capabilities. For Thief profiles, it includes all 9 stolen skills with priority rankings.

This runs once per character, or when the user edits their build. It's a separate `POST /api/generate-profile` endpoint.

---

### The User Message (Match-Time)

```typescript
function buildAdvicePrompt(match: MatchData, activeProfile: UserProfile): string {
  return `
CHARACTER: ${activeProfile.build_label}
ROLE: ${activeProfile.role}
MAP: ${match.map || 'unknown'}

ENEMY TEAM:
${match.enemyTeam.map(p =>
  `- ${p.character_name}: ${p.profession} - ${p.spec} (${p.role})` +
  (p.times_seen > 0 ? ` [seen ${p.times_seen}x, ${p.wins_against}W/${p.losses_against}L]` : ' [NEW]')
).join('\n')}

MY TEAM:
${match.allyTeam.map(p =>
  `- ${p.character_name}: ${p.profession} - ${p.spec} (${p.role})${p.is_user ? ' ← ME' : ''}`
).join('\n')}
`;
}
```

Note: `CHARACTER:` now uses `build_label` (e.g. "S/D Power Daredevil") not a hardcoded spec name. This makes it work for any number of characters without code changes.

---

### Why Claude API, Not a Rule Engine

The original spec proposed a rule engine for speed. Here's why LLM is better for this use case:

1. **Comp synergy reasoning** — A rule engine handles individual matchups but can't reason about "their Herald + Firebrand means heavy boon uptime, so strip before every engage." Claude can.
2. **Map × comp interaction** — "On Spirit Watch, their Reaper is slow but dangerous with orb. Your job shifts from decap to orb denial." Rules would need exponential combinations.
3. **Natural language** — The advice reads like a coach talking to you, not a bullet-point database lookup.
4. **Evolving knowledge** — Updating the system prompt is easier than maintaining a rule engine. When the meta shifts, you edit text, not code.
5. **Player history integration** — "You've lost to this player 3 times" is trivial for Claude to incorporate, hard to template in rules.

**The tradeoff is ~3-4 seconds of latency** (with streaming, you start reading in ~1s). Acceptable given you control when the call fires.

#### Streaming UX

The briefing area shows a subtle typing indicator, then text appears section by section. Since Sonnet outputs ~80 tokens/sec and the response is ~200-300 tokens, the full briefing renders in ~3-4 seconds. With streaming, the first section (Kill Targets) appears in ~1 second.

If the API call fails (rate limit, network), a retry button appears. The roster remains editable so you can just play without advice — it's not a blocker.

---

### Post-Match (Optional, Not Urgent)

After a match ends, the app sits in idle. A small toast appears:

```
┌────────────────────────────────────┐
│  Last match: did you win?  [W] [L] │
└────────────────────────────────────┘
```

One-click W or L. Recorded in `matches.result`. This feeds the `wins_against` / `losses_against` counters on players, which over time surfaces patterns like "you're 1-4 against this Reaper, don't solo them."

If you ignore it and paste a new screenshot, the previous match result stays null. No friction.

---

## Interaction Timing Analysis

### Cold Start (Match #1-5, most players new)

| Step | Time | Action |
|------|------|--------|
| Paste screenshot | 0s | Ctrl+V |
| API processing (Haiku) | 2s | Haiku parses image |
| Roster appears | 2s | Scan all 9 rows |
| Correct 2-3 specs | 8s | Click spec names to cycle (~2s each) |
| Set 1-2 roles | 4s | Tap DPS/SUPP toggles |
| Select map | 2s | Pick from dropdown |
| Click Get Advice | 0s | Enter key |
| Claude streams response | 3-4s | Start reading at ~1s (streaming) |
| Read tactical briefing | 10s | Skim kill targets + rotation plan |
| **Total** | **~30s** | Well within 60s budget |

### Warm State (Match #50+, ~7/9 players recognized)

| Step | Time | Action |
|------|------|--------|
| Paste screenshot | 0s | Ctrl+V |
| API processing (Haiku) | 2s | Haiku parses image |
| Roster appears | 2s | Glance — all green checkmarks |
| Correct 0-1 specs | 1s | Maybe one new player |
| Select map | 1s | Pick from dropdown |
| Click Get Advice | 0s | Enter key |
| Claude streams response | 3-4s | Start reading at ~1s |
| Read tactical briefing | 5s | Quick scan, mostly familiar |
| **Total** | **~15s** | Leaves 45s for mental prep |

---

## Technical Architecture

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│   Browser     │────▶│  API Server   │────▶│  Postgres    │
│  (SvelteKit)  │◀────│  (SvelteKit   │◀────│              │
│               │     │   server      │     │  players     │
│  Ctrl+V       │     │   routes)     │     │  matches     │
│  paste zone   │     │               │     │  match_plyr  │
│  roster UI    │     │  Haiku ──────┐│     │  user_profs  │
│  map selector │     │  (scan)      ││     └──────────────┘
│  advice view  │     │              ││              │
│  (streamed)   │     │  Sonnet ─────┤│     ┌────────┴─────┐
│  profile mgmt │     │  (advice,    ││     │  Data Files  │
│               │     │   streamed)  ││     │              │
│               │     │              ││     │  universal-  │
│               │     │  Sonnet ─────┤│     │  game-know.. │
│               │     │  (profile    ││     │  output-fmt  │
│               │     │   gen, 1x)   ││     │  weapons.json│
└──────────────┘     └──────────────┘│     └──────────────┘
                                     │
                      Anthropic API ◀┘
```

### Data Flow

```
PHASE 1 — SCAN (automatic on paste)
1. User pastes screenshot
2. Browser sends image to server: POST /api/scan
3. Server calls Anthropic Haiku API with the image
4. Haiku returns parsed JSON (team compositions + which player is_user)
5. Server detects active character from is_user's profession:
   - If profession matches an existing user_profile → auto-set as active
   - If no match → prompt to create new profile
6. Server enriches with player history from Postgres:
   - For each character_name, check players table
   - If found: attach historical spec, role, times_seen, win/loss
   - If not found: mark as NEW, use Haiku's detected spec
7. Server returns enriched roster + active character to browser
8. Browser renders roster — user corrects specs/roles, picks map

PHASE 2 — ADVICE (on explicit button click)
9. User clicks "Get Advice" (or presses Enter)
10. Browser sends corrected roster + map + active profile ID to: POST /api/advice
11. Server saves match to Postgres (upserts all players, records user_profile_id)
12. Server assembles system prompt from 3 layers:
    - Layer 1: universal game knowledge (from data file)
    - Layer 2: active character's profile_prompt (from DB)
    - Layer 3: output format template (based on profile role)
13. Server calls Claude Sonnet API with assembled system prompt + user message
14. Response streams back via SSE → browser renders incrementally
15. User reads advice, match starts
```

### Stack Choice

Given that you're already deep in SvelteKit + Tauri world from Shoom Studio:

- **Frontend**: SvelteKit (SSR for initial load, client-side for all interaction)
- **Backend**: SvelteKit server routes (no separate API server)
- **DB**: Postgres (as specified)
- **ORM**: Drizzle (lightweight, TypeScript-native, great with SvelteKit)
- **Scan API**: Anthropic Haiku (fast, cheap — image → structured JSON)
- **Advice API**: Anthropic Sonnet (smart, streamed — assembled system prompt + roster → tactical text)
- **Profile Generation API**: Anthropic Sonnet (one-time per character — build info → structured profile prompt)
- **Streaming**: Server-Sent Events (SSE) from server to browser for Sonnet output
- **Deploy**: Docker Compose (SvelteKit + Postgres) — runs locally

No Tauri needed here. This is a desktop web app you access at `localhost:3000`. It's faster to iterate, easier to paste images into, and there's no reason for native OS integration.

---

## Spec ↔ Role Mapping Reference

For the role toggle logic, here's the full mapping of which specs show a role toggle and their default in sPvP:

### Pre-VoE Elite Specs

| Profession | Spec | Roles | Default |
|-----------|------|-------|---------|
| Guardian | Firebrand | DPS / HEAL | HEAL |
| Guardian | Willbender | — | DPS |
| Guardian | Dragonhunter | — | DPS |
| Warrior | Berserker | PWR / CONDI | PWR |
| Warrior | Spellbreaker | — | DPS |
| Warrior | Bladesworn | — | DPS |
| Engineer | Scrapper | DPS / SUPP | SUPP |
| Engineer | Holosmith | — | DPS |
| Engineer | Mechanist | DPS / ALAC | ALAC |
| Ranger | Soulbeast | PWR / CONDI | PWR |
| Ranger | Druid | — | HEAL |
| Ranger | Untamed | — | DPS |
| Thief | Daredevil | — | DPS |
| Thief | Deadeye | — | DPS |
| Thief | Specter | DPS / SUPP | SUPP |
| Elementalist | Tempest | DPS / HEAL | HEAL |
| Elementalist | Weaver | — | DPS |
| Elementalist | Catalyst | — | DPS |
| Mesmer | Chronomancer | DPS / SUPP | SUPP |
| Mesmer | Mirage | — | DPS |
| Mesmer | Virtuoso | — | DPS |
| Necromancer | Reaper | — | DPS |
| Necromancer | Scourge | DPS / SUPP | SUPP |
| Necromancer | Harbinger | — | DPS |
| Revenant | Herald | DPS / SUPP | DPS |
| Revenant | Renegade | DPS / SUPP | DPS |
| Revenant | Vindicator | — | DPS |

### Visions of Eternity Elite Specs (October 2025)

These are the newest elite specs and dominate the current meta — 4 of the top 8 meta builds use VoE specs. Without these, the most common enemies can't be correctly identified.

| Profession | Spec | Roles | Default |
|-----------|------|-------|---------|
| Guardian | Luminary | DPS / SUPP | DPS |
| Warrior | Paragon | DPS / SUPP | DPS |
| Engineer | Amalgam | — | DPS |
| Ranger | Galeshot | — | DPS |
| Thief | Antiquary | — | DPS |
| Elementalist | Evoker | — | DPS |
| Mesmer | Troubadour | DPS / SUPP | SUPP |
| Necromancer | Ritualist | — | DPS |
| Revenant | Conduit | PWR / CONDI | CONDI |

Core (no elite spec) professions: show role toggle only for Guardian (DPS/BUNKER) and Elementalist (DPS/HEAL). All others default DPS.

**Note on Janthir Wilds**: JW didn't introduce new elite specs but DID add **spear** as a new weapon for all professions. Relevant if weapon display is ever added.

---

## Edge Cases

**Duplicate character names**: GW2 names are unique per account. No duplicates possible.

**Player switches spec between matches**: The `players` table stores `last_seen_spec`. If Haiku detects a different profession than what's in history, the history is overridden (people reroll). If same profession but different spec detected, show the history spec but with an amber `~ changed?` indicator.

**Unrecognized screenshot format**: If Haiku can't parse (wrong game, cropped weirdly, etc.), show a clear error: *"Couldn't read scoreboard. Make sure the full team list is visible."* Stay on paste screen.

**Map detection**: Map selection is now a required step before getting advice. The dropdown is always visible on the roster screen. If you don't select a map (leaving the default "Conquest generic"), the advice will still work — it just gives standard 3-point rotation advice without map-specific mechanics.

**Alt accounts / character switching**: The scoreboard only shows character names, not account names. Account names (`Name.1234` format) require right-clicking each player individually — not feasible in 30 seconds. So we track by character_name. If a player switches characters between matches, they appear as a new entry. Acceptable tradeoff — most PvP players stick to one character per session. **Phase 5 polish**: A manual "link characters" feature could let you associate multiple character names to one player after a match when you have time to right-click and check account names.

**Haiku elite spec icon detection**: The GW2 PvP scoreboard shows unique icons per elite spec (45 total: 9 base + 4 elite specs each), not just the 9 base profession icons. This means Haiku could potentially detect the exact elite spec, not just the profession — massively reducing correction clicks. **Recommendation**: Include reference images of all 45 spec icons in the Haiku parse prompt, especially the 9 VoE spec icons since they're newest and least likely in Haiku's training data. Even with good icon detection, keep spec cycling as fallback — Haiku won't be 100% accurate on ~20px monochrome silhouettes.

**User plays a different character**: If Haiku detects you as Warrior (not Thief), the app auto-switches the active profile to whichever profile matches that profession. If no matching profile exists, the app prompts to create one via the Profile Creation Flow. The system prompt assembled for Claude changes entirely based on active character — Layer 2 (your build) and Layer 3 (output format) are both swapped.

---

## What's Deliberately Excluded

- **Build templates / exact trait guesses**: Impossible to know from the scoreboard. The role toggle (DPS/Support/Heal) is the useful granularity.
- **Account-level player tracking**: Scoreboard doesn't show account names. Character name is the only identifier available from a screenshot. See edge cases for Phase 5 manual linking option.
- **Real-time overlay**: Would require game memory reading, probably violates ToS. Desktop web app is simpler and legal.
- **GW2 API integration**: The official API doesn't expose PvP lobby data. Screenshot parsing is the only viable approach.
- **Multi-match trend analysis / dashboards**: Nice-to-have for later. Not in the 60-second flow. Accessible from a separate `/history` route, not from the main screen.
- **Team voice callouts / sharing**: Out of scope. This is a solo tool.
- **Automatic win/loss detection**: Would need post-match screenshot parsing. The one-click W/L button is simpler and reliable enough.

---

## Companion Documents & Data Files

This spec defines the UX flow and architecture. The actual game knowledge lives in separate files, split by the 3-layer system prompt architecture:

### Runtime Data (loaded per request)

| File / Source | Prompt Layer | Purpose |
|------|---------|---------|
| **`data/universal-game-knowledge.md`** | Layer 1 | All profession matchup data, stolen skills table, "do not hit" reference, map strategies, role definitions, comp analysis rules. Updated when meta shifts. Same for all users. |
| **`user_profiles.profile_prompt` (DB)** | Layer 2 | Per-character build profile. Claude-generated during Profile Creation Flow. Contains skills, strengths, weaknesses, role description. |
| **`data/output-format-dps.md`** | Layer 3 | Output template for DPS/roamer/duelist/teamfighter characters. |
| **`data/output-format-support.md`** | Layer 3 | Output template for support characters. |

### Reference (not loaded at runtime)

| File | Purpose |
|------|---------|
| **`gw2-pvp-matchup-bible.md`** | Complete per-build matchup reference — visual IDs, threat ratings, kill windows, gameplans. Source material for populating Layer 1. |
| **`gw2-pvp-tactical-advisor-prompt.md`** | Original monolithic system prompt. Superseded by the 3-layer architecture but preserved as reference for Layer 1 content and profile generation prompt design. |
| **`gw2-pvp-thief-context.md`** | Player's build details, combat fundamentals, settings, practice goals. Background reference. |
| **`data/weapons.json`** | Static game data — weapon availability per profession (includes Weaponmaster Training + Spear). Powers the profile creation form dropdowns. |

---

## Implementation Priority

**Phase 1 — Scan Pipeline (get data flowing)**
1. Paste → Haiku parse → display roster (all 45 elite spec icons detectable)
2. Spec cycling on click (all 9 professions × 4 elite specs + core)
3. Role toggle for ambiguous specs (including VoE: Paragon, Luminary, Conduit, Troubadour)
4. Map selector dropdown (12 maps)

**Phase 2a — Profile System (know your build)**
5. Profile creation form (profession, spec, role, weapons — all from static game data)
6. Free text playstyle description input
7. Profile generation API call (Claude Sonnet, one-time per character)
8. Profile review + manual edit + save to DB (`profile_prompt` field)
9. Profile management screen (list, add, edit, delete)
10. Profile switcher on idle screen
11. Auto-detect active character from screenshot profession

**Phase 2b — Advice Pipeline (make it useful)**
12. 3-layer system prompt assembly (universal knowledge + character profile + output format)
13. Claude Sonnet API integration with assembled prompt
14. SSE streaming to browser
15. "Get Advice" button + Enter shortcut
16. Role-dependent output sections (DPS format vs Support format)

**Phase 3 — Memory (make it learn)**
17. Player history (Postgres upsert on every match)
18. History pre-fill on roster (override Haiku detection with DB data)
19. Win/loss per player passed into advice prompt

**Phase 4 — Polish (make it fast and pleasant)**
20. Post-match W/L recording
21. Win rate display on player rows
22. Session stats on idle screen
23. Haiku parse prompt tuning with elite spec icon reference images
24. Universal game knowledge tuning based on meta shifts

**Phase 5 — Nice-to-Have**
25. Manual "link characters" to associate multiple character names (for alt-hoppers)
26. Match history / analytics dashboard (`/history` route)
27. Additional output format templates (e.g. bunker-specific)
28. `data/weapons.json` verification against current patch
