# Implementation status

## Active scope

Phase 4 is committed/pushed as `f1fc362` on origin/master. Phase 5 Microsoft
integration is implemented with mocked provider verification.
Stop before Phase 6 until explicitly authorized.
Neither Google nor Microsoft has credentialed live acceptance validation.

## Phase 5 implemented

- Microsoft personal/work delegated read-only OAuth with S256 PKCE, provider-bound
  single-use state, hashed browser/nonce secrets and session checks after exchange.
- Real RS256 ID-token verification: signing-key issuer scope, tenant, issuer,
  audience, object ID, nonce, version and lifetime. Email is display-only.
- Versioned authenticated encryption for credentials/cursors; refresh rotation,
  read-only scope validation and revoked/organization-policy handling.
- Owned calendar discovery/import selection, default privacy, manual sync,
  per-provider account controls, setup/status/help and disconnect confirmations.
- Provider-dispatched durable worker, connection leases/heartbeat/fencing,
  coalesced jobs, checkpointed pages, backoff/Retry-After and quota recovery.
- Primary calendar Graph v1.0 delta, secondary calendarView snapshot reconciliation,
  expanded recurrence/exceptions, sensitivity and deletion/cancellation handling.
- UTC instants, original Windows/IANA zones via Unicode CLDR, exclusive all-day
  dates/DST and a visible 183-day past/548-day future coverage window.
- Verified bounded webhook ingestion and validation challenges, subscription
  renewal, lifecycle recovery, uncertain create handling and 15-minute fallback.
- Immediate local event/share removal on deselection/disconnect; durable bounded
  subscription cleanup and token purge, with separate external consent guidance.
- Recovery when the primary designation changes or invalid source data is fixed.
- Scheduler and notification job inserts serialize connection-before-job locks,
  including foreign-key lock acquisition, preventing a reproducible insertion race.

Shared/delegated/group mailboxes are excluded; only the signed-in user's owned
mailbox calendars are eligible. There are no event-write methods, application-wide
permissions, global Microsoft sign-out/revokeSignInSessions calls, or fake live
provider switches. See MICROSOFT_SETUP.md for configuration and exact limitations.

## Phase 5 verification

- Lint and strict TypeScript passed.
- All 39 unit tests passed, including gateway, JWT signatures/claims, encryption,
  privacy and timezone/all-day normalization cases.
- All 57 real-database/API tests passed, including Google regressions, Microsoft
  OAuth binding/replay/isolation, refresh, page resume, delta/snapshot/deletion,
  expired cursors, quota/backoff, revocation, notifications/lifecycle/renewal,
  uncertain creation, privacy, cleanup, correction recovery and concurrent inserts.
- All 14 desktop/mobile browser/HTTP cases passed: authentication, sharing,
  calendar views/live updates/privacy, Google and Microsoft account controls,
  and both providers' real Next callback privacy headers/redirects.
- Two desktop navigation cases timed out during cold development compilation;
  both passed in a focused warm rerun without application or test changes.
- Desktop/mobile Microsoft account screenshots were visually reviewed.
- Production build and production dependency audit passed (zero vulnerabilities).
  The final build of the queue/recovery changes also passed.

Provider network responses are mocked; identity tests verify real JWT signatures.
No live Google/Microsoft consent, refresh, provider read, notification delivery or
subscription renewal is claimed. Follow each setup guide's pending live checklist.

## Existing Phase 4 behavior retained

Google OAuth, encrypted credentials, discovery, read-only recurrence/incremental
sync, push channel verification/renewal, durable retries and disconnection remain
implemented. Existing source/privacy, bounded API reads, preferences, membership,
invitation, sample-loader and authenticated SSE regressions continue to pass.

## Local sandbox and handoff

The existing sandbox remains available at http://localhost:3100 in
/private/tmp/calendar-share-sandbox-luk8kcc9. Both original demo logins, calendar
pages/event APIs, private reads, unauthorized rejection, logout and callback
headers passed the pre-Phase-5 check. Credentials remain in its SANDBOX.md.
The sandbox uses Phase 5 source with existing accounts/data retained. Post-upgrade
checks passed for both original logins, calendar/event reads, account pages,
unauthenticated rejection, logout, both callback privacy headers, unconfigured
Microsoft start rejection and Microsoft webhook validation. App/database health
and the durable worker startup also passed.
No real provider credentials or test-provider records are installed there.

Before upgrade, the database was backed up with restricted permissions to
/private/tmp/calendar-share-sandbox-luk8kcc9-backups/before-phase5.sql.
The prior image is retained as calendar-share-sandbox:luk8kcc9-phase4.
Older backups/images remain available. Disposable verification databases/services
are removed after checks; the user sandbox remains running.

Apple/CalDAV is Phase 6. Account deletion, public production deployment, email
verification/reset, PWA, recovery and further hardening remain Phase 7.
