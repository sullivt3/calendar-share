# Phase 5 — Microsoft Outlook

Authorized on November 14, 2026. Stop before Phase 6.
See MICROSOFT_SETUP.md for configuration and live acceptance.

## Implemented sequence

1. Read-only Graph adapter for common-account authorization, PKCE, token
   exchange/refresh, owned calendar discovery, primary delta/secondary snapshots,
   subscription creation/renewal/stopping, strict continuation links and safe errors.
2. Provider-bound OAuth attempts with encrypted verifiers, hashed nonce/browser
   secrets, single-use state and session revocation checks after code exchange.
   Signed ID-token verification checks tenant, object ID, key issuer scope,
   issuer, audience, nonce, version and lifetime. Email remains display-only.
3. Shared durable worker dispatches by provider with lease fencing/heartbeat,
   coalescing, checkpoint recovery, encrypted cursors, backoff and quota delays.
   Scheduler/job inserts acquire connection locks before job rows, avoiding
   a foreign-key lock-order race with notifications. Existing Google tests remain.
4. Microsoft normalization uses immutable IDs, UTC instants, original Windows/IANA
   zones, CLDR mappings, private sensitivity, all-day dates, expanded recurrence
   exceptions, cancellations and deleted-record tombstones. Coverage/window changes,
   expired cursors and corrected provider data trigger safe rebuild/retry paths.
5. Basic mailbox-event subscriptions, bounded plain-text validation challenges,
   clientState/subscription/tenant/resource checks, renewal, lifecycle recovery,
   duplicate coalescing and polling fallback. Unknown create outcomes retain pending
   state. Local disconnect hides/purges immediately; remote cleanup has bounded
   retries. No event writes or global Microsoft session revocation.
6. Owner-only account controls, optional setup/status notices, privacy integration,
   troubleshooting/configuration docs and isolated database/browser verification.

## Scope and limits

Delegated Calendars.Read supports personal and work/school mailboxes. ReadBasic
omits descriptions; no write or application-wide permissions are requested.
The public-cloud Graph v1.0 primary-calendar delta API and secondary-calendar
snapshot paths remain distinct. Shared/delegated/group mailboxes are excluded.
Coverage is 183 days past/548 days future; event/source and view safety limits are
explicit. Microsoft consent removal is separate from deleting this app's local
tokens and subscriptions. The app never revokes every user login session.

Protocol/database tests mock Microsoft network responses and verify real JWT
signatures. They cannot establish real tenant policy compatibility, consent,
refresh or delivery/renewal. Credentialed personal/work acceptance remains pending.

## Verification

- Lint and strict TypeScript pass.
- All 39 unit tests pass, including Microsoft gateway, signatures/claims and dates.
- Database/API tests include Google regressions, OAuth binding/replay/isolation,
  checkpoint resume, primary delta/secondary reconciliation, quota/revocation,
  notification spoofing/lifecycle/renewal, uncertain creation, privacy and cleanup.
- All 14 browser/HTTP cases pass. Two desktop navigation cases timed out during
  cold development compilation and passed in a focused warm rerun without code
  changes. Both desktop and mobile Microsoft account screenshots were reviewed.
- Production build passes; production dependency audit reports zero vulnerabilities.
- All 57 database/API tests and the final queue/recovery production build pass.
- Verification totals 110 passing unit, database/API and browser cases.

## Primary references

- [Calendar discovery](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0)
- [CalendarView delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0)
- [Outlook notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview)
- [Subscriptions and lifetimes](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)
- [OAuth authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [ID-token validation](https://learn.microsoft.com/en-us/entra/identity-platform/id-tokens)
- [Immutable identifiers](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
