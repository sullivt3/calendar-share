# Development checklist

Phase progression requires explicit user instruction. Completing a phase never
authorizes starting the next one.

## Phase 1 — Foundation
- [x] Next.js App Router, strict TypeScript, Tailwind and shadcn/ui conventions
- [x] PostgreSQL/Prisma identity schema, migration and two demo accounts
- [x] Better Auth registration, login, logout and server-side session guards
- [x] Docker development app/database/worker and environment documentation
- [x] Shared contracts, architecture and repository instructions
- [x] Auth unit/integration/browser tests, lint, types and production build

## Phase 2 — Shared accounts
- [x] Private spaces and transactional two-member limit
- [x] Expiring, hashed, single-use invitations and acceptance
- [x] Membership management and leave flow
- [x] Calendar sharing policies and cross-space authorization tests

## Phase 3 — Calendar dashboard
- [x] FullCalendar month/week/day/agenda and responsive sidebar
- [x] TanStack Query, filters, person colors, accessible event details, themes
- [x] Explicitly labeled mock adapters and realistic events
- [x] Server-side busy-only redaction and private-event restrictions
- [x] SSE invalidation contract and isolation tests

## Phase 4 — Google
- [x] Read-only OAuth with state/PKCE, encrypted credentials and refresh
- [x] Discovery/selection, recurrence and incremental event normalization
- [x] Durable jobs, webhook verification/channel renewal and reconciliation
- [x] Invalid cursor, deletion, duplicate, retry and quota tests
- [x] Integration with existing authorized dashboard/SSE updates
- [ ] Credentialed provider validation (unavailable; user chose mocked tests)

## Phase 5 — Microsoft
- [ ] Personal/work OAuth, read-only Graph access and policy errors
- [ ] Discovery, delta sync, recurrence and deletion handling
- [ ] Verified change subscriptions, renewal, refresh and reconciliation
- [ ] Mocked failure/retry coverage and credentialed live validation

## Phase 6 — Apple
- [ ] App-password guidance and encrypted server-side CalDAV credentials
- [ ] Discovery/selection and read-only event/recurrence normalization
- [ ] Five-minute polling, sync tokens/ETags, deletion and backoff
- [ ] Credential failures/disconnection and documented provider limits

## Phase 7 — Production hardening
- [ ] Account deletion, revocation and cleanup; preferences and safe audits
- [ ] Full security/isolation, DST, recurrence and live-update testing
- [ ] Email verification/recovery and abuse controls for public registration
- [ ] PWA installability with no private event caching
- [ ] Production Docker/reverse proxy/worker deployment and GitHub Actions
- [ ] Backups, recovery drills, performance and observability
- [ ] Provider configuration guides and honest live-validation matrix
