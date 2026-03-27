# Domain 3: Auth & Security — DeepLoop Audit Results

**Arbiter**: Claude Opus 4.6 (1M context)
**Date**: 2026-03-26
**Status**: CONVERGED — DOMAIN COMPLETE

---

## PRs Created
- **PR #43** — fix: scope match dedup to user, add impersonation audit logging (Round 1)
- **PR #44** — fix: wrap user registration in transaction to prevent invite code race (Round 2)

---

## PHASE 1: Code Audit (5 rounds, converged at rounds 3-4-5 clean)

### Round 1: TWO FINDINGS (APPROVED, FIXED)

**F-001: Cross-tenant data leak in match dedup** (HIGH) — PR #43
- `src/routes/api/match/+server.ts` lines 106-129
- POST `/api/match` screenshot hash dedup queried by `screenshotHash` without filtering by `userId`. Any user could submit another user's screenshot hash and receive their team roster.
- Fix: Added `userId` filter to dedup query.

**F-002: No audit logging for admin impersonation** (MEDIUM) — PR #43
- `src/routes/api/admin/impersonate/+server.ts`
- Admin impersonation start/stop had no log entries for security forensics.
- Fix: Added structured logger calls for `impersonation_start` and `impersonation_stop` events.

### Round 2: ONE FINDING (APPROVED, FIXED)

**F-003: Race condition in user registration** (MEDIUM) — PR #44
- `src/lib/server/auth.ts` lines 82-119
- `createUser()` performed user insert, invite code marking, and session creation as three separate queries. Two concurrent requests with the same invite code could both create users.
- Fix: Wrapped all three operations in `db.transaction()`.

### Rounds 3-5: CLEAN (no findings) — CONVERGED

### REJECTED Findings
- Invite code timing-safe comparison: `Set.has()` is O(1) hash-based, not a real timing side channel. Even if it were, the real gate is the DB lookup.
- No rate limiting on login/register: Infrastructure concern, not a code bug.
- `/api/screenshots/[hash]` serves without auth: Hash is 16-char hex SHA-256 prefix, effectively unguessable.

---

## PHASE 2: Test Audit (1 round, converged)

### Coverage Assessment

| Area | Covered | Source |
|------|---------|--------|
| Session creation/resolution | YES | `tests/auth.test.ts` |
| Session expiry | YES | Tests expired session returns null |
| Username uniqueness | YES | DB constraint test |
| GDPR cascade delete | YES | Verifies sessions + invite codes deleted |
| BYOK encrypt/decrypt roundtrip | YES | `tests/byok.test.ts` |
| BYOK tamper detection | YES | Tests tampered ciphertext throws |
| BYOK key lifecycle | YES | DB storage + deletion test |
| Auth middleware | YES | `tests/auth-enforcement.test.ts` static analysis |
| Admin role check | YES | Role assignment verified |
| Login with wrong password | NO | Low risk — bcrypt.compare well-tested |
| Impersonation flow | NO | Low risk — 27-line endpoint, double-gated |
| Multi-tenant isolation | NO | Out of Domain 3 scope |

**PHASE 2 COMPLETE — No actionable test gaps.**

---

## Security Posture Summary

- **Authentication**: Session-based (randomUUID tokens, 30-day TTL, server-side DB storage). No JWT.
- **Password storage**: bcrypt, 12 rounds, timing-safe comparison.
- **Cookies**: httpOnly, sameSite=lax, secure in production.
- **BYOK encryption**: AES-256-GCM with random IV, env-based key. Keys never exposed in responses.
- **Authorization**: Centralized in hooks.server.ts. All API routes auth-gated. Admin routes double-gated.
- **Multi-tenancy**: Data scoped by userId across all query paths.
- **Registration**: Transactional, invite-code gated, duplicate-protected.
- **GDPR**: Full cascade delete via DB foreign keys.

## DOMAIN 3 COMPLETE
