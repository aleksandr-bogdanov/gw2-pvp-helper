# Domain 6: Profiles & Players API — Audit Results

## Phase 1: Code Audit — CONVERGED (6 rounds, 5 findings fixed)

### Round 1 — 3 FINDINGS

#### FINDING 1 (CRITICAL): SQL Injection Pattern + Crash in /api/players PATCH
- **File:** `src/routes/api/players/+server.ts`
- **Issue:** `sql.raw()` with string interpolation for rating updates. Non-numeric input produces NaN -> invalid SQL -> crash.
- **Fix:** Parameterized Drizzle queries + input validation (400 on non-numeric). **FIXED in PR #45.**

#### FINDING 2 (CRITICAL): lookupPlayers() No Multi-Tenant Scoping
- **File:** `src/lib/server/players.ts`
- **Issue:** Queries match data/player metadata across ALL users. Leaks cross-user history via scan endpoints.
- **Fix:** Added userId parameter, filter by m.user_id and p.user_id. **FIXED in PR #45.**

#### FINDING 3 (LOW): /api/profiles GET Returns All Profiles When userId Null
- **File:** `src/routes/api/profiles/+server.ts`
- **Issue:** Defense-in-depth failure — returns all profiles when userId null.
- **Fix:** Return empty array. **FIXED in PR #45.**

### Round 2 — 1 FINDING

#### FINDING 4 (MEDIUM): generate-profile decrements usage before API call with no rollback
- **File:** `src/routes/api/generate-profile/+server.ts`
- **Issue:** decrementProfileGens called before Anthropic stream. API failure = permanent usage loss (3 free gens).
- **Fix:** Added restoreProfileGen() rollback in stream error handler. **FIXED in PR #45.**

### Round 3 — 1 FINDING

#### FINDING 5 (MEDIUM): Input validation after usage decrement
- **File:** `src/routes/api/generate-profile/+server.ts`
- **Issue:** Body parsing + validation happened AFTER decrement. Missing fields = wasted gen.
- **Fix:** Moved validation before usage check. **FIXED in PR #45.**

### Rounds 4, 5, 6 — CLEAN (no findings)

---

## Phase 2: Test Audit — CONVERGED

### Tests Added
- `tests/build-decode.test.ts` — 14 tests covering:
  - Valid build code decoding (with/without wrapper)
  - Specialization trait bitfield parsing
  - Skill palette ID extraction
  - Error paths: empty, short, wrong type, unknown profession
  - Profession-specific data (ranger pets, revenant legends)
  - SotO weapon extension bytes
  - All 9 profession codes
  - formatBuildForPrompt output formatting

### Tests NOT added (require DB/network mocks)
- players.ts lookupPlayers() — needs PostgreSQL mock
- API endpoint integration tests — need request/auth mocking
- generate-profile streaming — needs Anthropic SDK mock

---

## PR
- **PR #45:** https://github.com/aleksandr-bogdanov/gw2-pvp-helper/pull/45
- 3 commits: Round 1 fixes, Round 2 rollback, Round 3 validation reorder, tests
