# Implementation status

## Active scope

Phase 1 was committed as 862174e. Phase 2 is complete and verified. Stop before Phase 3 until explicitly authorized.

## Phase 2 implemented

- Private shared spaces, names, equal membership and a two-member limit.
- 24-hour expiring, hashed, single-use invitations, replacement and revocation.
- Same-tab invitation continuity through login and registration.
- Transactional acceptance and row locking for concurrent requests.
- Leave flow with confirmation, share cleanup and last-member space deletion.
- Provider/calendar metadata and per-space sharing modes, private by default.
- Owner-only sharing updates and current-member filtering on every query.
- Authenticated, origin-validated, no-store REST APIs and working settings pages.

No live calendars are connected. Calendar sharing settings show an honest empty
state until provider integrations arrive. Tests use MOCK calendar metadata.
Event views and busy-only event redaction belong to Phase 3.

## Verification

- Phase 1: 6 unit, 3 integration and 2 browser tests passed; lint, types,
  production build, Docker startup and dependency audit passed.
- Phase 2: 9 real-database/API tests passed, including concurrent acceptance,
  expiration/replay/replacement/revocation, cross-user and cross-space isolation,
  sharing revocation, departure cleanup, origin/session/input boundaries.
- Phase 2 unit tests: 8 passed (including the foundation tests).
- Phase 2 integration tests: 9 passed (including the foundation tests).
- Desktop/mobile Playwright: all 4 cases passed in the final serial run.
  Two independent browser accounts create/join/rename/leave a space, exercise
  busy-only calendar sharing, revoke it, and verify access after departure.
- ESLint and strict TypeScript: passed with no warnings/errors.
- Final production build: passed, including route tracing.
- Docker image build and fresh-database migration/startup/readiness: passed.

Build and browser checks use isolated filesystems and run serially for the
final verification to avoid cold-compilation contention in Docker.
Navigation after space creation avoids a competing refresh; membership changes
reload their destination to discard stale client page state.
Browser cases require a disposable database ending in _browser and reset only
its auth-rate counters between cases. Integration tests separately verify
actual rate-limit enforcement. Calendar fixtures are explicitly MOCK.

No Phase 2 blockers remain. Phase 3 has not started.

## Resume and local setup

Read AGENTS.md and docs/ROADMAP.md. Use docker compose up --build -d.
Local secrets are in ignored .env; demo accounts alex@example.test and
sam@example.test use its DEMO_PASSWORD value. The seed does not pre-join accounts
or create live calendars. Phase 1 is committed locally as 862174e. Phase 2 changes are local and
uncommitted. Nothing has been pushed for these implementation phases.
Temporary test databases/services are removed after verification. The
development database, migration history and demo accounts are preserved.

## Future phases

Phase 3: FullCalendar, event projection/privacy, filters, mock events and SSE.
Phases 4–6: real provider workflows, encrypted credentials and synchronization.
Phase 7: production deployment, CI, PWA, recovery and public auth hardening.
The foundation worker does not synchronize events. Email verification and
password recovery remain production gates.
