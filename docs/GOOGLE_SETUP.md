# Google Calendar setup and validation

Phase 4 implements Google authorization and ingestion. Automated provider tests
use protocol fixtures with a real disposable PostgreSQL database. No Google
Cloud OAuth client or public HTTPS endpoint was available for this phase, so
real consent, Google token exchange/refresh, delivery and renewal are **not live
validated**. Mock tests do not establish Google project approval or account-policy
compatibility. Outlook and Apple remain later phases.

## Configure the server

1. Create a Google Cloud project, enable the Google Calendar API, and configure
   the OAuth consent screen/audience. Add your accounts as test users while the
   project is in Testing. Organization policies can prevent authorization.
2. Create an OAuth **Web application** client. Register the exact redirect URI
   `BETTER_AUTH_URL/api/providers/google/callback`, for example
   `http://localhost:3100/api/providers/google/callback` for the local sandbox.
   Use the actual origin, without a trailing path. HTTPS is required outside
   local development. Client credentials belong only in the server environment.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
4. Generate an independent encryption key with `openssl rand -base64 32`. Set
   `PROVIDER_ENCRYPTION_KEY_ID=v1` and
   `PROVIDER_ENCRYPTION_KEYS='{"v1":"YOUR_BASE64_32_BYTE_KEY"}'`.
   Retain the single quotes when writing this JSON to a dotenv file. Keep keys
   outside database backups; losing a key requires reconnecting affected accounts.
5. Optionally set `GOOGLE_WEBHOOK_URL` to a publicly reachable HTTPS URL ending
   exactly in `/api/providers/google/webhook`. Google must reach it without a
   browser login, proxy password or interstitial. It accepts only verified
   channel headers. Localhost cannot receive Google callbacks. Leave it blank
   to use 15-minute polling. Do not put secrets in its URL.
6. Restart both app and worker after environment changes; run migrations first.
   The worker must remain running for discovery, imports, retries and revocation.
   In Docker: `docker compose up --build -d`. Use independent secrets for each
   environment. Do not paste provider secrets into chat or commit `.env`.

Requested scopes are `openid`, `email`,
`https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and
`https://www.googleapis.com/auth/calendar.events.readonly`. Authorization uses
state, PKCE and offline consent. The integration rejects broad event-write
scopes. It has no provider event mutation API. Watch creation/stopping and
OAuth grant revocation are the only provider operations besides reads/auth.

Google documents offline refresh access in its [web server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).
Testing-mode grants can expire and require reconnecting; see Google's
[audience guidance](https://support.google.com/cloud/answer/15549945).

## Use and operating limits

Open **Manage calendar accounts**, connect Google, then select individual
calendars to import. Discovery does not select or share anything. Free/busy-only
Google permissions cannot supply readable events and are excluded. Choose
busy-only or full details separately in each shared space's settings.

Initial imports become visible only after successful completion. One-off events
are imported from the authoritative source; recurring instances are materialized
from Google's instances API for roughly six months behind and eighteen months
ahead. The UI displays the exact rolling coverage. Recurrence exceptions,
cancellations, source privacy and IANA timezones are retained. Large calendars
fail visibly at 50,000 source records or 20,000 materialized records per sync;
the calendar is hidden on data-limit/normalization errors. API view queries
retain their separate 93-day/2,000-event limits.

Verified notifications enqueue incremental reads; their body is never event
input. Replay message numbers coalesce safely. Channels renew before expiry;
15-minute reconciliation also recovers missed messages and rolls coverage
forward. Calendar discovery repeats every six hours. An uncertain watch request
keeps its pending channel until confirmation/expiry to avoid duplicate channels.
Polling continues meanwhile. See Google's [push guide](https://developers.google.com/workspace/calendar/api/guides/push).

Invalid sync cursors clear local source/materialized data and trigger a full
import. Cursor commits wait for successful normalization. Quota/transient errors
persist retry/backoff, including Retry-After. Revoked grants hide calendars and
purge credentials, requiring authorization again. This follows Google's
[incremental synchronization contract](https://developers.google.com/workspace/calendar/api/guides/sync).

Stopping import removes events, cursors and every sharing permission immediately.
Disconnect also hides calendars immediately and queues channel stopping/grant
revocation, then removes encrypted tokens. If remote revocation cannot be
confirmed after bounded retries, local tokens are purged and the UI directs you
to Google account permissions. A disconnect needs the worker to complete.

## Encryption rotation and logs

Ciphertexts include a key version, random nonce and authentication tag. AAD binds
credentials to a connection and cursors/verifiers to their specific purpose.
To rotate, add a new key to the JSON keyring, change the active key ID and restart
app/worker together. Existing ciphertext still needs old keys; successful refresh
and sync write the active version. There is no bulk re-encryption command yet.
Retain old keys until all dependent values are retired or re-encrypted.

App logs contain sanitized job kinds/status/error codes. The Next development
request logger excludes OAuth callbacks. Configure upstream access/APM logs to
omit OAuth callback queries, cookies, authorization headers, channel tokens and
request/response bodies. Restrict database and backups: source event payloads
contain private calendar data even though provider credentials are encrypted.

## Pending live acceptance checks

When credentials and HTTPS are available, use test-only calendars/accounts:

- Complete/decline consent and verify the exact scopes/redirect URI.
- Import selected calendars; verify default privacy and sharing from a second user.
- Create/edit/delete in Google, including an all-day event, private recurrence,
  moved/cancelled occurrence and a DST transition; observe database/dashboard updates.
- Confirm actual token refresh, revoke access externally and reconnect.
- Receive an early sync notification, observe incremental changes and channel
  renewal; interrupt notifications and confirm polling recovery.
- Disconnect and verify Google's grant removal; ensure local events/shares vanish.

Never mark these checks passed based on the mocked test suite.
