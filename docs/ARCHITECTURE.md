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

## Phase 2 — shared accounts

Private spaces have equal members, with a two-person service limit and UUID
membership keys ready for a future larger limit. Either member can rename the
space or leave; members cannot remove someone else. Leaving removes the
departing owner's shares, invalidates every outstanding invitation, and deletes
the space if no members remain.

All membership, invitation and sharing operations serialize on the space row
with PostgreSQL SELECT FOR UPDATE, then re-check membership inside the same
transaction. Concurrent invitation acceptance cannot admit a third member or
consume a token twice. Reads of private space/calendar metadata use the same
lock, so successful revocation is reflected in subsequent queries.
See https://www.postgresql.org/docs/current/explicit-locking.html.

Invitations use 256-bit random bearer tokens. Only a SHA-256 hash is persisted.
Links expire after 24 hours, are single-use, and new issuance replaces old links.
The raw token is returned only at issuance, in a no-store response. It travels
in the invitation URL fragment so HTTP access logs/referrers do not receive it.
The invitation page moves it to same-tab sessionStorage and removes the
fragment. Login/registration accept only the fixed /invite return destination;
no external redirect targets are accepted. Successful acceptance clears the
stored token. Send invitation links through a private channel.

Phase 2 creates provider_connections and calendars as metadata tables only,
plus per-space calendar_shares. Provider credentials and connection workflows
remain unimplemented. No share row means NOT_SHARED. Only the owner can change
a calendar's sharing. Peer queries require current membership for both caller
and owner and a non-private share in this specific space. There is no event
data yet: server-side private-event redaction is a Phase 3 requirement.
Automated sharing tests create clearly labeled MOCK metadata directly in their
disposable database; the production UI does not invent connected calendars.

Space REST routes validate sessions, UUIDs and Zod request schemas; mutations
require the configured request origin and JSON. Responses are private/no-store.
No invitation, calendar or membership credential is accepted as an actor ID
from the browser; the actor always comes from the verified session.

Space creation navigates directly to its new URL. Membership acceptance and
departure reload the destination from the server, discarding client page state
from before the membership change. Ordinary name/sharing changes refresh the
current page. Calendar event updates will use SSE/query invalidation in Phase 3.

## Phase 3 — calendar and privacy

Events preserve UTC instants, all-day exclusive date bounds, original timezone,
privacy, source IDs/versions and recurrence metadata. Provider normalization
and full recurrence expansion remain provider-phase tasks. The browser gets a
purpose-built projection, never raw database records. Owner events expose own
details; peer events require current membership, a selected calendar share and
PUBLIC provider privacy. BUSY_ONLY/PRIVATE/CONFIDENTIAL projections omit title,
location, description and recurrence metadata. Full-detail descriptions require
a separate includeDescription opt-in. No event write endpoints exist.

The REST event service enforces membership and sharing inside a transaction
locked on the space, then applies bounded date filters (93 days/2,000 events).
All-day queries compare calendar dates; timed queries compare UTC instants.
Filters never grant visibility. Metadata includes source labels and person
colors, with blue/purple defaults and validated, per-user color preferences.

SSE is an authenticated stream of empty invalidation signals. It polls a hash of
the same authorized projection every three seconds. The hash is never sent to
the browser. A private title change that does not change the peer projection
does not trigger an invalidation for that peer. Every poll checks session and
membership again. A revoked connection clears browser state and leaves the
space view. Abort/cancel removes timers; five-minute connection lifetimes force
regular reconnects. There is no process-local message bus to lose updates across
web/worker processes. PostgreSQL is the shared source of truth. This polling
approach suits the initial two-person app; optimize transport fanout only after
measuring load. Reverse proxies must disable buffering on stream routes.

TanStack Query caches are memory-only, scoped to user, space, range and filters,
and destroyed on unmount/logout. Invalidations reset data before revalidation,
including open detail dialogs. Errors never render stale event details. A
one-minute/focus refetch recovers missed stream messages. FullCalendar 6 provides
month/week/day/list views with all editing/dragging/selection disabled. Native
event buttons and Radix dialogs provide keyboard access, focus trapping, Escape
and focus restoration. Event descriptions/locations render as escaped text.
Theme preferences are server-owned; only the selected theme is in localStorage.

Mock loading is explicitly enabled by ENABLE_MOCK_CALENDARS and always blocked
in production. It upserts marked owner-only MOCK connections and sample Google,
Outlook and Apple calendar metadata with materialized weekly instances and
private appointments. It never creates shares or touches a live provider.
Calendar.mockProvider is only a display label on MOCK connections.
The worker remains a foundation process: no external provider sync is claimed.

Sources:
- https://fullcalendar.io/docs/react
- https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation
- https://www.radix-ui.com/primitives/docs/components/dialog

## Phase 4 — Google ingestion

Google is the first implemented provider. Application sessions and provider
identity remain separate. OAuth uses a short-lived, single-use state record bound
to the actual user/session and an HTTP-only browser nonce. PKCE verifiers,
credentials and sync cursors use versioned AES-256-GCM with purpose/record AAD.
The callback redirects only to fixed account-page outcomes, without reflecting
provider errors or codes. OAuth callback query logging is suppressed locally.

Owner-only account endpoints handle discovery, import selection and disconnect.
Sharing writes lock the owning connection after the space, serializing with
provider cleanup so concurrent requests cannot restore removed permissions.
Selection never creates a share. Authorization reads exclude unselected,
disconnected, revoked or invalid-data calendars, and initial event imports stay
hidden until successful completion. Existing server-side sharing/private-event
projection and SSE invalidation apply to Google events too.

The worker claims PostgreSQL jobs with SKIP LOCKED and a connection-wide lease,
serializing token refresh and provider operations per connection. All writes
recheck a fencing token and lease expiry. Lock order is connection then job.
Heartbeats extend two-minute leases; a crashed worker can be reclaimed.
Request/claimed versions preserve notifications arriving while a job runs.
Failures persist bounded exponential jitter/backoff and provider Retry-After.

SourceEvent stores allowlisted Google source records, including recurrence
masters/exceptions/tombstones. Event stores the normalized view. Page checkpoints
survive worker failure; the new sync cursor is committed only after successful
materialization. Recurrences expand through Google's authoritative instances API
within a rolling 183-day past/548-day future window. An expired cursor clears
local data and performs a full replacement import. Full imports prune absent
records; delta updates delete cancelled instances/series idempotently.

Notifications verify channel ID, hashed secret, resource ID, expiry, account and
calendar state, and increasing message numbers. A pending channel exists before
the watch request, accepting Google's early sync callback. Renewal retires old
channels. Unknown transport outcomes retain pending IDs to avoid duplicates;
periodic sync continues. Scheduling reconciles every 15 minutes and discovers
calendars every six hours. Disconnect hides/purges local event access immediately,
then durably stops channels/revokes the grant and purges credentials. Terminal
revocation failures purge local credentials and surface external-removal guidance.

The GoogleGateway interface is injectable in automated tests; runtime provider
URLs are fixed to Google. There is no runtime fake-Google switch. No Google
credentials/public notification endpoint were available, so live provider
acceptance remains pending. See GOOGLE_SETUP.md for configuration, limits,
key rotation and credentialed acceptance checks. This supersedes the earlier
phase-specific statements that all provider ingestion is future work.

## Phase 5 — initial Microsoft protocol foundation

The server-only Microsoft client uses delegated Calendars.Read, fixed public-cloud
Microsoft authorities, S256 PKCE authorization and POST-only token exchange/refresh.
Graph continuation links must retain the exact original resource path and HTTPS
origin before requests or persistence. Redirects cannot forward bearer credentials.
Primary calendar delta and secondary calendarView reconciliation remain distinct;
mailbox-wide basic subscriptions invalidate caches without accepting event bodies.
The adapter strips unused response fields and returns sanitized failure codes.
The full OAuth, durable worker, webhook and account-control integration built on
this boundary is described below; see PHASE5_PLAN.md for verification.

## Phase 5 — Microsoft integration

The initial protocol foundation is now wired through OAuth, account controls,
worker jobs, verified webhook ingestion and normalization. OAuthAttempt records
carry a provider discriminator (default GOOGLE for existing attempts) and hashed
Microsoft OIDC nonce. PKCE contexts are provider-bound. Code exchange is single-use,
and the actual session is checked again before installing encrypted credentials.
Microsoft identity is the verified tenant/object-ID pair; email is display only.

The common worker dispatches by provider while retaining existing connection
leases, fencing, request-version coalescing and persisted backoff. Primary calendars
use Graph v1.0 calendarView delta; secondary calendars use bounded replacement
snapshots. Source pages and encrypted continuation checkpoints survive interruption;
committed delta links advance only after materialization. Invalid cursors rebuild.
The rolling coverage is 183 days past/548 future for all Microsoft events, with
fresh snapshots as the daily window changes. Immutable IDs are requested consistently.
Unicode CLDR maps Windows zones; all-day dates are recovered in the original zone.

Basic subscriptions are attached to selected calendars and watch the owned mailbox's
events for invalidation. Stored clientState hashes, remote subscription IDs,
tenant/resource identities, account status and calendar selection gate notifications.
Validation challenges are bounded plain text; notification bodies are bounded to
64 KiB/100 notices. Lifecycle events trigger reconciliation/replacement. Unknown
subscription create outcomes retain pending state to avoid duplicate subscriptions;
15-minute polling continues. No notification payload is accepted as event data.

Microsoft disconnect stops known subscriptions and purges local credentials; it
never revokes all user sessions. Remaining consent removal is explicitly guided
in the UI. All owner mutations and existing privacy/sharing checks are reused.
No real provider credentials are present: live personal/work tenant acceptance is
pending and must not be inferred from the mocked integration suite. See
MICROSOFT_SETUP.md for exact configuration, fallback behavior and limitations.
