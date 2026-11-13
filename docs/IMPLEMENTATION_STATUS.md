# Implementation status

## Active scope

Phase 3 was committed and pushed as `dfa39f0` to origin/master. Phase 4 Google
integration is implemented with mocked provider verification. The user requested
mocked provider tests because no Google OAuth client/public HTTPS endpoint exists.
Stop before Phase 5 until explicitly authorized.

## Phase 4 implemented

- Owner-only Google account page, calendar discovery/import selection, manual sync,
  clear setup/error/coverage status and disconnect confirmations.
- Read-only OAuth with offline access, single-use state, PKCE, browser/session
  binding, verified Google identity and fixed safe callback outcomes.
- Versioned authenticated credential/cursor/verifier encryption, context binding,
  token refresh and revoked-grant handling. No browser credentials or event writes.
- Durable PostgreSQL jobs with deduplication, connection serialization, expiring
  leases/heartbeat/fencing, retries, quota backoff and crash-resumable pagination.
- Full/incremental Google source ingestion and normalized event projection,
  authoritative recurrence instances/exceptions, timezone/DST/all-day handling,
  updates/deletions and invalid-cursor replacement imports.
- Verified early/replayed notifications, channel renewal/retirement, pending
  transport-outcome handling and periodic polling/discovery reconciliation.
- Immediate local event/share removal on deselection/disconnect, durable remote
  revocation and bounded failure cleanup with explicit guidance.
- Existing sharing/privacy and dashboard SSE invalidations apply to imported data.

Recurring coverage is bounded to 183 days behind/548 days ahead, shown in the UI.
Source/materialization limits fail visibly. See GOOGLE_SETUP.md for exact
configuration, operating limits, key rotation and live acceptance checks.

## Verification

- Lint and strict TypeScript checks passed.
- All 24 unit tests passed, including encryption, read-only gateway/scopes and normalization.
- All 37 database/API tests passed, including OAuth binding/replay, encrypted refresh,
  resumable pagination, recurrence/DST/updates/deletions, expired cursors, quota
  backoff, leases/fencing, notification verification/replay/renewal and cleanup races.
- All 10 desktop/mobile browser/HTTP cases passed: 6 existing regression cases,
  both account-management cases in a focused rerun after correcting asynchronous
  checkbox assertions, and both real callback-header/redirect checks. Desktop/mobile
  account screenshots were visually reviewed.
- Dependency audit reported zero known vulnerabilities.
- Production build passed, including a final build of the privacy fixes. A later
  callback-specific global-header override passed real Next HTTP checks; the route
  handler test alone did not detect the original global override.

The first Docker browser run required a QA-container-only Next dev-origin setting;
repository origin controls were unchanged. Google requests use injected test
fixtures; runtime endpoints remain fixed to Google. No live Google consent, token exchange/refresh, calendar
read, notification delivery or channel renewal has been validated.

## Local use

The existing sandbox is upgraded to Phase 4 at http://localhost:3100, with preserved
accounts/data and labeled sample calendars. Its location is
/private/tmp/calendar-share-sandbox-luk8kcc9; credentials are in SANDBOX.md there.
Both original demo logins, private-space reads, account pages and logout passed
post-upgrade checks. App/database health and the durable worker startup passed.
No real Google credentials or test-provider records were installed in this sandbox.

Before migration, the database was backed up with restricted permissions to
/private/tmp/calendar-share-sandbox-luk8kcc9-backups/before-phase4.sql.
The previous image is retained as calendar-share-sandbox:luk8kcc9-phase3.
Earlier backups/images remain available. Disposable verification services and
databases are removed after checks; the user sandbox remains running.

Google setup is optional. An unconfigured installation reports that state and
cannot initiate consent. Samples never authorize a provider. To enable Google,
follow docs/GOOGLE_SETUP.md; credentials must be configured in both app and worker.

## Remaining phases

Microsoft is Phase 5; Apple is Phase 6. Public production deployment, recovery,
email verification/reset, account deletion and PWA hardening remain Phase 7.
