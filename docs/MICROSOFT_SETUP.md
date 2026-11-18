# Microsoft Outlook setup and validation

Phase 5 supports delegated read-only access to personal Outlook.com and Microsoft
365 work/school mailboxes through Microsoft Graph v1.0. Automated tests use mocked
provider responses, real JWT signatures and disposable PostgreSQL databases.
No real Microsoft app registration, account consent, refresh or webhook delivery
has been validated. Tenant policy compatibility remains a live acceptance check.

## Server configuration

1. Register an app in Microsoft Entra with the audience supporting organizational
   directories **and personal Microsoft accounts**. Add a **Web** redirect URI
   exactly matching `BETTER_AUTH_URL/api/providers/microsoft/callback`, for example
   `http://localhost:3100/api/providers/microsoft/callback` in the local sandbox.
2. Configure delegated Graph **Calendars.Read**. No application-wide or calendar
   write permissions are needed. Remove an unused default User.Read permission;
   this app identifies accounts from verified OpenID claims, not a profile API.
   Requests also include openid, profile, email and offline_access. ReadBasic is
   insufficient for the optional event descriptions supported by this application.
3. Create a client secret and configure `MICROSOFT_CLIENT_ID` and
   `MICROSOFT_CLIENT_SECRET` in the server environment. Keep them out of chat,
   source control, logs and NEXT_PUBLIC variables. Follow the existing Google
   setup guide for `PROVIDER_ENCRYPTION_KEYS` and `PROVIDER_ENCRYPTION_KEY_ID`;
   both providers use the same server keyring with per-record authenticated context.
4. Optionally configure `MICROSOFT_WEBHOOK_URL` as the public HTTPS URL ending in
   `/api/providers/microsoft/webhook`. It must be reachable by Microsoft without
   authentication, a proxy password or an interstitial. Its POST validation
   challenge returns plain text; notifications are authorized by subscription
   state and a random clientState secret. Omit the URL for 15-minute reconciliation.
5. Migrate and restart app/worker together (`docker compose up --build -d`). A
   running worker is required for discovery, sync, subscription renewal and cleanup.
   Register a separate client for each environment. Use HTTPS outside localhost.

See Microsoft's [authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
and [ID-token validation](https://learn.microsoft.com/en-us/entra/identity-platform/id-tokens).
The server verifies signature, signing-key issuer scope, tenant, issuer, audience,
nonce, version and lifetime. Account identity uses tenant + object ID, never email.
Conditional access, MFA and organization consent policies can require additional
sign-in or administrator approval. Reconnect or contact your administrator.

## Import, sharing and sync behavior

Open Manage calendar accounts, connect Microsoft Outlook, then select calendars
to import. Import selection remains separate from sharing. Calendar details stay
private until explicitly shared inside each space. Busy-only/private-event
redaction and optional description sharing are enforced by the server.

Discovery includes calendars owned by the signed-in mailbox. Shared, delegated,
Microsoft 365 group and other mailbox calendars are excluded. No broader
permissions are silently requested. Primary calendar changes use bounded
calendarView delta; secondary calendars use periodic calendarView snapshots with
pagination and deletion pruning. Microsoft documents the stable delta contract
for the [primary calendar](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0).
Secondary calendars are explicitly labeled as snapshot reconciliation in the UI.

All Microsoft event coverage is bounded to 183 days behind and 548 days ahead;
the UI shows exact dates. A daily window change performs a replacement snapshot.
Graph supplies expanded recurrence instances/exceptions. UTC response instants,
original Windows/IANA zones and exclusive all-day dates are normalized with
Unicode CLDR mappings. Unknown custom timezone definitions fail visibly rather
than inventing dates. HTML descriptions returned despite the plain-text request
are omitted; descriptions are never inserted as HTML. Cancellations and @removed
records delete local events. Expired delta cursors clear local state and rebuild.

Checkpoints and delta links are encrypted, resource-bound and committed only after
materialization. An initial import stays hidden until completion. Limits match
Google: 50,000 source rows and 20,000 normalized events; unsupported/oversized data
hides that calendar with a visible error. Existing 93-day/2,000-event view limits
still apply. Retry-After and persisted worker backoff handle quota responses.

Selected calendars each maintain a basic mailbox-events subscription for cache
invalidation. Notifications never supply authoritative event contents. Secrets,
subscription IDs, tenant/resource identity, connection ownership and selection are checked;
duplicate notifications coalesce into durable jobs. Renewal starts an hour before
the requested 24-hour expiry. Missed/removed/reauthorization lifecycle notices
schedule recovery. Uncertain create outcomes retain pending channels until a
verified notification or expiry, while periodic polling continues. Microsoft sets
[mailbox subscription limits](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview);
if a mailbox's quota is exhausted, the UI reports errors and reconciliation remains.

## Disconnect and consent

Stopping import immediately removes cached events, cursors and space-sharing
permissions. Disconnect immediately hides/purges local data, then stops known
subscriptions and removes encrypted credentials through the worker. Failed remote
cleanup is retried with a bound; unknown/expired channels can expire remotely.
Reconnection after revoked access requires selecting and sharing calendars again.

Disconnect does **not** revoke every Microsoft login session. Calendar Share never
calls revokeSignInSessions/signOut or requests the wider permissions for those
operations. Remove the app's remaining grant in [personal-account permissions](https://account.live.com/consent/Manage),
or your work organization's My Apps portal/administrator. The UI explains this
separately from local disconnection. No event writes, copies or calendar changes
are made by this application.

## Pending live acceptance

With a test app, dedicated personal and work/school accounts, and public HTTPS:

- Grant/decline consent; confirm read-only permissions and correct redirect URI.
- Check default privacy, calendar selection and sharing from a second app user.
- Create, move, edit and delete events in Outlook, including a private recurring
  exception and all-day/DST examples; observe both primary and secondary calendars.
- Confirm actual token refresh/rotation, external consent revocation and reconnect.
- Observe initial validation, verified notifications, subscription renewal and
  lifecycle recovery. Interrupt notifications and verify polling recovery.
- Disconnect; confirm local access/sharing disappears and remote subscriptions
  stop or expire. Remove the remaining Microsoft grant externally.

Do not mark these checks passed from mocked tests. Configure upstream access/APM
logs to exclude provider callback queries, headers, notification bodies and cookies;
Next's development logger excludes Microsoft callback/webhook URLs. Protect
source-event data and database backups separately from encryption keys.
