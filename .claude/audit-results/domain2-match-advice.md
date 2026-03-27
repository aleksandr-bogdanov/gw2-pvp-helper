# Domain 2: Match & Advice — DeepLoop Audit Results

**Status: CONVERGED**
**PR: https://github.com/aleksandr-bogdanov/gw2-pvp-helper/pull/40**
**Branch: fix/match-advice-round1-bugs**

## Phase 1: Code Audit (9 rounds, converged at rounds 7-8-9)

### Round 1 — 3 findings APPROVED, fixed
1. **Missing client disconnect cleanup** (advice/+server.ts)
   - Anthropic stream continued running when client disconnected mid-advice, wasting tokens
   - Fix: Added `cancel()` handler on ReadableStream that sets `aborted` flag and calls `stream.abort()`

2. **No player data validation in POST /api/match** (match/+server.ts)
   - `myTeam: [{}]` would insert rows with undefined characterName/profession/spec into DB
   - Fix: Added `Array.isArray()` check + field validation loop before DB insert

3. **Missing match ownership check in ratings PATCH** (match/ratings/+server.ts)
   - Any authenticated user could rate players in any match
   - Fix: Added match ownership verification before allowing rating updates

### Round 2 — 1 finding APPROVED, fixed
4. **Ratings GET missing user ownership check** (match/ratings/+server.ts)
   - GET endpoint didn't accept `locals`, so no auth check — any user could read any match's ratings
   - Fix: Added `locals` to handler, verify match belongs to requesting user

### Round 3 — CLEAN
### Round 4 — 1 finding APPROVED, fixed
5. **PATCH updatePlayers missing player validation** (match/+server.ts)
   - Same malformed player bug as POST but in the PATCH handler's updatePlayers path
   - Fix: Added same validation loop before DB insert in PATCH updatePlayers

### Round 5 — CLEAN
### Round 6 — 1 finding APPROVED, fixed
6. **Cross-tenant data leak in screenshot dedup** (match/+server.ts)
   - Dedup query was not scoped to userId — if user B uploaded same screenshot as user A, user B received user A's matchId and player data
   - Fix: Added `eq(matches.userId, userId)` to dedup WHERE clause, skip dedup for unauthenticated users

### Rounds 7, 8, 9 — CLEAN (3 consecutive = CONVERGED)

### Rejected findings (not bugs per audit criteria)
- No Anthropic stream timeout — SDK has internal timeouts, Railway has request timeouts
- advice endpoint doesn't validate myTeam/enemyTeam arrays — invalid input from attacker, not valid input crash
- `loadDataFile` called per request — performance, not correctness
- match GET limit/offset NaN handling — defensive coding
- Screenshot dedup race condition — theoretical, worst case is duplicate match not corruption

## Phase 2: Test Audit

### Finding APPROVED, fixed
- **match-utils.ts had zero tests** despite being the critical path for parsing LLM advice output
- Added 37 unit tests covering: parseAdvice, getTeams, getEnemyAllyTeams, formatTime, buildNameFragments, splitSentences, highlightNames, getThreatColor, getSpecIconUrl, getMapName, getMapMode

### Remaining test gaps (not approved — require DB/mocking infrastructure)
- No integration tests for /api/match POST/GET/PATCH/DELETE
- No integration tests for /api/match/ratings PATCH/GET
- advice-raw.test.ts tests are source-code greps, not behavioral tests

## Commits (on fix/match-advice-round1-bugs)
1. `b6b45ec` — fix: abort Anthropic stream on disconnect, validate player data, scope ratings PATCH
2. `8f40fe3` — fix: scope ratings GET to match owner
3. `14fd188` — fix: validate player data in PATCH updatePlayers path
4. `45686aa` — fix: scope screenshot dedup to current user (cross-tenant leak)
5. `2679563` — test: add unit tests for match-utils.ts (37 tests)
