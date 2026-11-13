# Implementation status

## Active scope

Phase 1 — Foundation is complete. Phase 2 has not been authorized or started.

## Implemented

- Next.js App Router, strict TypeScript, React and Tailwind.
- shadcn/ui-compatible button primitives and Lucide icons.
- PostgreSQL Prisma identity schema with UUID keys and cascading sessions/accounts.
- Better Auth registration, login/logout, database sessions and server-side guards.
- Read-only authenticated account endpoint and database readiness endpoint.
- Database auth rate limiting, origin checks and generic login errors.
- Local Docker database/app/migration/worker composition.
- Explicit two-demo-account seed, architecture and complete phased checklist.
- Unit, real-database integration and desktop/mobile browser test suites.

## Verification

Validated on November 13, 2026, using Docker Node 22 and real PostgreSQL 17:

- ESLint: passed without warnings.
- TypeScript: passed in strict mode.
- Vitest: 6 unit tests passed.
- Real-database integration: 3 tests passed, including identity isolation,
  hashed passwords, session revocation, forged cookies, input validation,
  untrusted origins and auth rate limits.
- Prisma migration: applied to development and fresh disposable test databases.
- Demo seed: both accounts created successfully.
- Dependency audit: zero known vulnerabilities in the locked dependency tree.
- Docker image build: passed. Compose migration ordering, app/database health
  and foundation worker startup passed.
- Production build: passed, including static generation and route tracing.
- Playwright: desktop and mobile Chromium registration/login/logout flows
  passed (2 tests), including protected navigation and layout overflow checks.

Build and browser verification use independent generated-file directories.
Browser tests use localhost as their origin, matching documented development.
The auth forms explicitly submit via POST even before client hydration.

## Handoff

No Phase 1 blockers remain. No live providers or later-phase features were
implemented. Changes are local and have not been committed or pushed.
Temporary test services/databases were removed after checks; the development
database volume and two demo accounts are preserved. Restart with
`docker compose up --build -d`. Local secrets are in the ignored .env file;
demo account passwords use its DEMO_PASSWORD value.

## Planned, not implemented

Shared spaces, invitations, provider connections, sharing authorization, event
queries, FullCalendar, SSE, durable synchronization jobs, credential encryption,
PWA, production deployment and CI remain in their documented future phases.
The foundation worker does not fetch or process events. No live provider
validation has been performed. Email verification and password recovery are
production-hardening gates.

## Resume

Read AGENTS.md and docs/ROADMAP.md. Do not begin Phase 2 until the user explicitly
authorizes it. Keep external calendars read-only and all privacy rules enforced
server-side.
