# Calendar Share

A shared calendar for users who connect their external calendars from Outlook,
Google, and Apple. The application will provide a strictly read-only combined
view: all event changes stay in the original provider.

**Current release: Phase 3 calendar dashboard.** Private spaces, invitations,
sharing permissions and the read-only calendar dashboard are implemented.
Open a space from your account dashboard to see its month, week, day or agenda
view. Mobile starts in agenda. Use space settings to invite someone or change
sharing, including a separate opt-in for descriptions.

The calendar supports person/provider/calendar filters, event detail dialogs,
person colors, persisted light/dark/system themes, local/UTC display, and
automatic view updates. Private or busy-only events are redacted by the server
before any response reaches another member.

Real Google, Outlook and Apple connections are not implemented yet. For local
testing, set `ENABLE_MOCK_CALENDARS=true` in `.env`, open a space's calendar and
choose **Load my sample calendars**. Samples are always labeled, belong only to
your account and start private. Each person must load and explicitly share
their own calendars. Loading samples never connects to a provider or changes a
sharing permission. It is idempotent and disabled in production.

After login, create a space from your account dashboard. Generate a private
invitation link from its settings page and share it with one other person.
Invitations expire in 24 hours and work once; issuing another link replaces the
previous one. The recipient can log in or register in the same tab before
accepting. Either member can rename or leave the space. Leaving removes their
shares and invalidates invitation links; the last departure deletes the space.

## Start with Docker

Requirements: Docker Engine/Desktop with Compose. No host Node installation is
required. Ports 3000 and 5432 must be free.

1. Copy configuration and generate independent local secrets:

   ```sh
   cp .env.example .env
   openssl rand -base64 32
   ```

   Put the generated value in `BETTER_AUTH_SECRET`. Set `DEMO_PASSWORD` to a
   separate password of at least 12 characters. Do not commit `.env`.
   `BETTER_AUTH_URL` must match the browser origin exactly; use
   `http://localhost:3000` consistently.

2. Build and start the database, migration task, app and foundation worker:

   ```sh
   docker compose up --build -d
   docker compose exec app npm run db:seed
   ```

3. Open http://localhost:3000. Register a personal account or log in with
   `alex@example.test` or `sam@example.test` using your `DEMO_PASSWORD`.
   Demo accounts contain no live calendars; sample calendars are loaded
   explicitly from the calendar sidebar.

Source changes under `src/` reload automatically. Rebuild after changing
dependencies, Prisma or configuration. Compose uses a persistent PostgreSQL
volume and waits for migration success before starting the app and worker.

```sh
docker compose logs -f app worker
docker compose exec app npm run db:migrate
docker compose down
```

`docker compose down -v` also destroys local database data; use only when you
intend to reset it. The worker currently verifies database connectivity and
waits for shutdown; it does not synchronize calendars.

## Native Node development

Use Node 22.12+ and PostgreSQL 17. Configure `.env`, then:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

In another terminal: `npm run worker`. Seed/worker commands also load .env through dotenv; `node --env-file=.env --import tsx prisma/seed.ts` and
`node --env-file=.env --import tsx src/worker/index.ts` are native equivalents.
Next.js and Prisma load `.env` automatically.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

Integration tests use the configured real PostgreSQL database and create/delete
uniquely named test users. **Use a disposable test database**, never production.
They exercise actual Better Auth request handlers, not provider mocks.
Supply `DATABASE_URL`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET` to the test
process. With Node 22, use
`node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`.
Do not run auth integration and browser tests concurrently: database rate limits
are intentionally shared. Allow the one-minute auth rate-limit window to reset
between runs or use a fresh disposable database.

Browser tests require a running app at `http://localhost:3000` and installed
Playwright Chromium:

```sh
npx playwright install --with-deps chromium
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
```

Use the same disposable database environment for the app and browser test
cleanup. Browser tests require a database name ending in `_browser`; they
reset auth rate-limit counters between cases to keep test users independent.
This reset is guarded against ordinary database names. Integration tests
exercise rate-limit enforcement separately. Desktop and mobile Chromium flows cover register/login/logout,
protected navigation, two separate users creating/joining/renaming/leaving a shared space, event
privacy, all four calendar views, filters, colors/themes and live data updates.
Use `ENABLE_MOCK_CALENDARS=true` on the test app for sample-loader checks.
Run browser tests after the production build, rather than concurrently, to
avoid development compilation competing for Docker resources. Browser traces may contain test input: use test-only
passwords and do not upload traces containing real credentials.

For Docker-only checks, `docker compose exec app npm run <script>` runs tooling
inside the app container. Browser testing uses the Playwright image matching the
locked `@playwright/test` version or a native browser installation.

## Live updates and limits

SSE sends invalidation signals only. The server polls a fingerprint of each
caller's authorized projection every three seconds, rechecks membership and
session validity, and never streams event details. Connections reconnect after
five minutes; the client also revalidates every minute and on focus. A manual
**Refresh calendar view** reloads the authorized data without altering events.
This is view synchronization with our database; provider ingestion and durable
background jobs arrive in Phases 4–6.

Queries are limited to 93 days and 2,000 events per response. Narrow the range
if a large calendar exceeds that limit. All-day end dates are exclusive.
Timed events retain original IANA timezone metadata and UTC instants; the
dashboard can display local time or UTC. Sample recurring instances are
materialized for eight weeks; provider recurrence expansion/exception handling
will be validated during the provider phases. No events, credentials or
invitation links are persisted in a browser query cache. Only the theme setting
is stored in localStorage.

## Production build

```sh
npm run build
npm start
```

Use HTTPS and a production origin before running in production; production
cookies are secure. The current Dockerfile is a **development image**.
Production images, reverse proxy, CI, backups and public-registration hardening
are Phase 7 deliverables. Email verification and password recovery are not yet
configured. Do not expose this foundation release as a public production
service.

The auth account table is used only for hashed application passwords. Calendar
credentials must use a separate encrypted provider-connection store when
provider phases begin. Never put secrets in `NEXT_PUBLIC_*` variables or logs.
Production secrets belong in a secret manager, with database credentials and
encryption keys managed separately.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Phase checklist](docs/ROADMAP.md)
- [Implementation status and handoff](docs/IMPLEMENTATION_STATUS.md)
- [Repository instructions](AGENTS.md)

Development stops after each phase until the user authorizes the next one.
