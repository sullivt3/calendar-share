# Calendar Share

A shared calendar for users who connect their external calendars from Outlook,
Google, and Apple. The application will provide a strictly read-only combined
view: all event changes stay in the original provider.

**Current release: Phase 2 shared accounts.** Registration, login/logout,
private shared spaces, invitations, membership and calendar-sharing permissions
are implemented. Events and provider connections are planned; this release does
not connect to live calendars.

After login, create a space from your account dashboard. Generate a private
invitation link from its settings page and share it with one other person.
Invitations expire in 24 hours and work once; issuing another link replaces the
previous one. The recipient can log in or register in the same tab before
accepting. Either member can rename or leave the space. Leaving removes their
shares and invalidates invitation links; the last departure deletes the space.

Calendar sharing settings start empty until provider integrations arrive.
When calendars exist, their owner can choose Not shared, Busy only or Full
details independently for each space. Calendars are private by default.
Phase 2 tests exercise these rules using MOCK metadata, without pretending
that provider connections or an event dashboard are available.

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
   Demo accounts contain no live calendars. Realistic mock calendar events
   arrive in Phase 3.

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
protected navigation, and two separate users creating/joining/renaming/leaving
a shared space. Browser traces may contain test input: use test-only
passwords and do not upload traces containing real credentials.

For Docker-only checks, `docker compose exec app npm run <script>` runs tooling
inside the app container. Browser testing uses the Playwright image matching the
locked `@playwright/test` version or a native browser installation.

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
