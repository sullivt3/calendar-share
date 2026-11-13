# Architecture

## Foundation decisions

A Next.js App Router modular monolith serves React pages and REST endpoints.
PostgreSQL is the source of truth; Prisma owns schema and versioned migrations.
Better Auth provides email/password authentication, scrypt password hashing,
database-backed opaque HTTP-only sessions, origin/CSRF validation and database
rate limits. Application login is separate from calendar-provider authorization.
Prisma 7 is pinned to a patched stable release with the PostgreSQL driver
adapter; upgrades require migration review. Node 22 is the reproducible runtime.

Server modules live in src/server, UI in src/components, route composition in
src/app, shared contracts in src/shared. Browser modules must never import
server credential or database code. Session checks belong on every protected
page and endpoint, with no public cookie cache. Account existence should not be
exposed through login errors. Passwords have a 12-character minimum.

Phase 1 creates auth tables only. Domain tables are introduced with the phase
that exercises their invariants, rather than unused speculative migrations.

## Planned domain

users (auth User), sessions, accounts, verifications and rate_limits form identity.
shared_spaces, shared_space_members and hashed single-use invitations establish
membership in Phase 2. UUID foreign keys support more than two future members;
the initial service enforces two members transactionally.
provider_connections belong to users; calendars belong to connections.
calendar_shares links calendars to spaces with NOT_SHARED, BUSY_ONLY or
FULL_DETAILS. Revocation is enforced on every read, independent of cached events.
events preserve provider IDs, versions, original timezones, recurrence rules and
exceptions; unique provider/calendar/event keys prevent duplicate ingestion.
sync_states and sync_subscriptions persist cursors, leases and expiry times.
user_preferences and audit_logs support appearance and safe security history.
Cascade identity sessions/accounts on deletion; explicitly revoke provider
access before domain cleanup when account deletion is implemented.

## Planned synchronization

A separate Node process executes durable PostgreSQL jobs using row locks,
leases, idempotent upserts and bounded retry/backoff. Start without Redis/BullMQ;
add them only if measured queue volume justifies another dependency.
Google notifications trigger incremental reads; Graph notifications trigger
delta reads. Renew subscriptions and periodically reconcile missed changes.
Apple uses CalDAV sync tokens/ETags and configurable five-minute polling.
Webhooks signal work; provider reads supply authoritative events. Never copy
events between providers. Encrypt credentials with versioned authenticated
encryption and deploy keys separately from database backups.

SSE carries space-scoped invalidation signals only, never event data. Clients
revalidate through authorized REST reads. Query cache keys include user and
space; logout clears browser caches. FullCalendar, TanStack Query, filters and
busy-only event projection arrive in Phase 3.

## Security and operations

Local HTTP is development only. Production requires HTTPS, secure cookies,
validated public origin, protected database networking and a reverse proxy
which replaces trusted IP headers. Phase 1 deliberately uses a shared database
rate counter rather than trusting arbitrary forwarded IP headers.
Production email verification/reset delivery, distributed abuse review, CSP,
provider secret rotation, backups, PWA caching boundaries and deployment
hardening remain explicit Phase 7 gates. Authenticated responses must not enter
shared caches. No user notifications or event write endpoints are planned.

## Sources

- https://nextjs.org/docs/app/getting-started/installation
- https://better-auth.com/docs/authentication/email-password
- https://better-auth.com/docs/adapters/prisma
- https://better-auth.com/docs/integrations/next
- https://better-auth.com/docs/concepts/rate-limit

## Dependency maintenance

The initial audit found issues in older Prisma configuration and test tooling.
Use patched Prisma 7.10.1, Vitest 5 and a scoped minimatch override for the
TypeScript ESLint parser dependency. Retain the override until its upstream
range includes the patched release, then remove it and re-run lint/audit.
The lockfile is required; use npm ci for reproducible installation.
