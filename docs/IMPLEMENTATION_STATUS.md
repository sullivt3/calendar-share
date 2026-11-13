# Implementation status

## Active scope

Phase 2 committed and pushed as dd1aeec (including the earlier Phase 1 commit).
Phase 3 is complete and verified. All 40 automated tests passed.
Stop before Phase 4 until explicitly authorized.

## Phase 3 implemented

- FullCalendar month/week/day/agenda views, navigation and responsive sidebar.
- Person/provider/calendar filters and person colors with blue/purple defaults.
- Accessible read-only event dialogs, source labels and timezone display.
- Persisted appearance preferences, dark/light/system themes.
- Database event schema and server-side privacy projection, including a separate
  description-sharing opt-in and provider-private event restrictions.
- Explicit opt-in, labeled development samples that remain private by default.
- Authenticated SSE invalidations, automatic query revalidation, fallback refresh
  and client cache clearing after invalidation/revocation.

## Verification

- Unit tests: all 16 passed.
- Real-database/API tests: all 18 passed, including event privacy, cross-space
  isolation, revocation, date bounds/DST, description permissions, mock idempotency,
  production mock blocking, SSE payload privacy/session revocation and preferences.
- Dependency audit: zero known vulnerabilities.
- Lint and strict TypeScript checks passed, including the final auth/theme fixes.
- All 6 desktop/mobile Chromium browser cases passed, including Phase 1–2
  regression flows, all calendar views, filtering, privacy, preferences, live
  creation/change/deletion visibility and membership revocation.
- Both focused calendar cases passed again with fully loaded screenshots.
  Desktop month and mobile agenda screenshots were visually reviewed; a
  dark-mode logout contrast issue was corrected.
- Docker image build, additive migration, startup and health checks passed.
- Final production build passed, including route tracing, after the auth
  navigation, theme bootstrap and dark-mode contrast corrections.
- SSE creation/deletion invalidation assertions also passed in a focused rerun.

Authentication now uses a fresh navigation after successful login/registration
and logout, preventing a late refresh from restoring the previous route/user's
client state. The browser query cache remains memory-only and user scoped.

## Local use

Read README.md. Run docker compose up --build -d and seed the two demo accounts.
Set ENABLE_MOCK_CALENDARS=true for local samples, then load them explicitly from
the calendar sidebar. Share each sample calendar in space settings to expose it
to the other member. No provider credentials or live integrations are used.

The existing sandbox at /private/tmp/calendar-share-sandbox-luk8kcc9 is upgraded
to Phase 3 at http://localhost:3100. Its accounts, environment secrets and test
data are preserved, and both original demo logins/private-space reads passed
smoke checks. Samples are enabled but must be loaded explicitly by each user.
Credentials are unchanged; see the sandbox's SANDBOX.md.

Before migration, the database was backed up (restricted file permissions) to
/private/tmp/calendar-share-sandbox-luk8kcc9-backups/before-phase3.sql. The prior
image remains tagged calendar-share-sandbox:luk8kcc9-phase2.

## Handoff

No Phase 3 blockers remain. Phase 4 has not started.
Phase 3 changes are local and uncommitted. No Phase 3 work has been pushed.
Disposable verification databases/services were removed; the user sandbox and
its backup remain available.
Real provider integration, durable sync jobs and webhook ingestion belong to
Phases 4–6. Worker does not synchronize providers. PWA, production deployment,
email verification/recovery and further hardening remain Phase 7.
