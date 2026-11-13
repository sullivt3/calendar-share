> Execution override: the user requires stopping after each phase and waiting for explicit authorization. This takes precedence over the original brief’s automatic continuation instructions.

# MASTER CODEX PROMPT — Shared Calendar Application

You are a principal software architect, senior full-stack engineer, UI/UX designer, security engineer, and DevOps engineer.

Your task is to design and build a complete, production-quality shared calendar application for two people who want to view each other's schedules in one unified calendar.

Build this as a real, functional application intended for daily use, not a prototype or mockup.

The application should be simple, modern, fast, secure, mobile-friendly, and easy to maintain.

Make reasonable technical decisions independently, document them, and implement the project incrementally.

# 1. PROJECT OVERVIEW

Build a shared, read-only calendar application where two people can connect their existing calendar accounts and see all their schedules combined into one calendar.

Supported calendar providers:

- Apple iCloud Calendar
- Google Calendar
- Microsoft Outlook Calendar

Each person must have their own account and be able to connect multiple calendar accounts.

Example:

Person A connects:
- Personal Apple Calendar
- Work Outlook Calendar
- Personal Google Calendar

Person B connects:
- Personal Apple Calendar
- Personal Google Calendar

The application combines events from all selected calendars into one shared view.

Events must be color-coded so users can immediately identify whose schedule they belong to.

The application must automatically detect events added, modified, or deleted in connected calendars and update the shared calendar accordingly.

IMPORTANT:

This application is STRICTLY READ-ONLY.

Users must NOT be able to create, edit, delete, reschedule, or otherwise modify events through this application.

All event management happens in the original calendar provider.

Do not implement event creation, editing, deletion, RSVP management, reminders, push notifications to users, email event notifications, or event invitations.

Provider change notifications used internally for synchronization ARE required.

# 2. CORE USER EXPERIENCE

The application must support:

1. Two separate user accounts.
2. Secure registration and login.
3. A private shared calendar space.
4. Invitation of the second user into that space.
5. Connecting multiple calendar accounts per user.
6. Selecting which calendars to share.
7. Combining shared calendars into one unified view.
8. Color-coding events by person.
9. Filtering events by person, provider, or individual calendar.
10. Month, week, day, and agenda views.
11. Viewing event details when authorized.
12. Busy-only visibility for private events.
13. Automatic background synchronization.
14. Automatic frontend updates without page refresh.
15. Manual synchronization when desired.
16. Displaying connection and synchronization status.
17. Responsive mobile and desktop interfaces.
18. Dark mode.
19. Secure provider disconnection.
20. Account deletion and removal from shared spaces.

Design the application primarily for two users, but structure the database so supporting additional members later does not require a complete redesign.

# 3. TECHNOLOGY STACK

Use the following technology stack:

Frontend:
- Next.js with App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide icons
- FullCalendar
- TanStack Query
- Zod

Backend:
- Node.js
- TypeScript
- Next.js server-side API routes or a lightweight standalone API if justified
- REST endpoints
- Server-Sent Events for live frontend updates

Database:
- PostgreSQL
- Prisma ORM

Authentication:
- Auth.js or another well-maintained authentication solution
- Secure HTTP-only sessions
- OAuth 2.0 and PKCE for calendar provider connections

Background synchronization:
- Dedicated Node.js worker
- Redis and BullMQ if justified
- Scheduled jobs
- Retry and recovery mechanisms

Deployment:
- Docker
- Docker Compose
- GitHub Actions
- Environment-based configuration

Testing:
- Vitest
- Playwright
- Integration tests

Prefer a simple modular monolith.

Do not introduce Kubernetes, microservices, or unnecessarily complex infrastructure.

Build the application as a responsive Progressive Web App (PWA) that can be installed on an iPhone or Android home screen.

# 4. AUTHENTICATION AND SHARED SPACE

Implement secure account registration and login.

Each user must have their own account.

User A can create a private shared space and generate a secure invitation link.

User B can accept the invitation and join the shared space.

Both users can:

- Connect their own calendar accounts.
- Choose which calendars to share.
- Configure sharing permissions.
- Disconnect their own calendars.
- View the combined shared schedule.
- Leave the shared space.

Use secure, expiring, single-use invitation tokens.

Do not share provider credentials between users.

The shared space must not expose calendars that a user has not explicitly selected for sharing.

# 5. GOOGLE CALENDAR INTEGRATION

Implement Google Calendar integration using Google's supported Calendar API.

Required features:

- OAuth 2.0 authorization.
- Read-only calendar permissions.
- Secure token storage.
- Token refresh.
- Calendar discovery.
- Selection of calendars to synchronize.
- Retrieval of events.
- Recurring event support.
- Incremental synchronization.
- Google Calendar push notification channels.
- Automatic renewal of expiring channels.
- Handling of deleted events.
- Handling of modified events.
- Recovery from invalid sync tokens.
- API rate-limit handling.
- Provider disconnection.

Use the minimum necessary OAuth scopes.

Never request calendar write permissions.

# 6. MICROSOFT OUTLOOK INTEGRATION

Implement Microsoft Outlook integration using Microsoft Graph.

Required features:

- Microsoft OAuth authorization.
- Read-only calendar permissions.
- Support for personal Microsoft accounts.
- Support for work/school accounts when permitted.
- Calendar discovery.
- Event retrieval.
- Recurring event support.
- Delta synchronization.
- Microsoft Graph change notifications.
- Subscription renewal.
- Handling of deleted events.
- Handling of modified events.
- Token refresh.
- Rate-limit handling.
- Provider disconnection.

Display clear errors if organizational policies block calendar access.

Never request calendar write permissions.

# 7. APPLE ICLOUD CALENDAR INTEGRATION

Implement Apple iCloud Calendar integration through CalDAV.

Required features:

- Secure iCloud connection workflow.
- Clear instructions for any required app-specific passwords.
- CalDAV calendar discovery.
- Calendar selection.
- Read-only event retrieval.
- Recurring event support.
- Sync tokens and ETags where supported.
- Scheduled background polling.
- Detection of added, modified, and deleted events.
- Credential failure handling.
- Provider disconnection.

Apple iCloud does not provide the same general-purpose cloud calendar OAuth integration as Google.

Do not assume Apple supports Google-style webhook subscriptions.

Implement CalDAV polling every five minutes by default, subject to provider behavior and rate limits.

Use secure encrypted credential storage.

Never expose Apple credentials to the browser after submission.

If an Apple capability is unavailable, document the limitation and implement the closest secure supported behavior.

# 8. AUTOMATIC SYNCHRONIZATION ENGINE

Automatic synchronization is a CRITICAL requirement.

The application must detect when events are:

- Created
- Modified
- Rescheduled
- Deleted
- Canceled
- Updated as part of a recurring series

These changes must automatically appear in the shared calendar without requiring users to manually refresh.

Implement the following synchronization strategies:

GOOGLE:
- Push notification webhooks.
- Incremental synchronization.
- Subscription renewal.
- Periodic fallback reconciliation.

MICROSOFT:
- Microsoft Graph change notifications.
- Delta synchronization.
- Subscription renewal.
- Periodic fallback reconciliation.

APPLE:
- CalDAV polling.
- Sync tokens and ETags where supported.
- Five-minute default polling target.
- Configurable polling interval.
- Rate-limit-aware retries.

BACKEND:
- Durable synchronization jobs.
- Idempotent event processing.
- Deduplication.
- Retry with exponential backoff.
- Provider-specific rate limiting.
- Sync cursor persistence.
- Deletion detection.
- Recurrence exception handling.
- Timezone normalization.
- Last successful synchronization timestamps.
- Connection health status.
- Recovery from missed notifications.
- Recovery from expired or invalid sync tokens.
- Reauthentication handling.
- Protection against concurrent duplicate sync jobs.

FRONTEND:
- Server-Sent Events for live update signals.
- Automatic calendar data revalidation.
- No page reload required.
- Connection status indicators.
- Last synchronized timestamps.
- Clear errors when a provider disconnects.

IMPORTANT:

Provider webhooks indicate that changes may exist. Fetch the authoritative changes from the provider rather than assuming the webhook contains complete event data.

Changes should normally appear shortly after provider notification and processing, but do not promise guaranteed instantaneous synchronization.

Never synchronize events from one external provider into another external provider.

The application only maintains its own read-only aggregated representation.

# 9. CALENDAR USER INTERFACE

Create a polished, modern, premium-looking calendar interface.

The UI should feel like a professional consumer productivity application, not a generic administration dashboard.

Main calendar dashboard:

- Left sidebar with connected calendars.
- Shared space name.
- User profile controls.
- Month/week/day/agenda view selector.
- Today button.
- Previous/next date navigation.
- Calendar filtering.
- Person filtering.
- Provider filtering.
- Color-coded events.
- Event detail popovers.
- Sync status.
- Manual refresh.
- Settings access.

Default colors:

Person A: Blue.
Person B: Purple.

Allow users to customize their display colors.

Use additional subtle indicators to identify Google, Apple, and Outlook sources.

On mobile:

- Responsive layout.
- Collapsible sidebar.
- Touch-friendly navigation.
- Readable event cards.
- Mobile-optimized agenda view.
- PWA installation support.

Support light and dark themes.

Implement accessible controls and keyboard navigation.

Do not display event editing controls.

# 10. EVENT DISPLAY

Each event should display the information authorized by the owner.

Supported event information:

- Title
- Start time
- End time
- All-day status
- Timezone
- Location
- Description, if shared
- Calendar owner
- Source provider
- Source calendar
- Busy/free status

For busy-only events:

Display "Busy" with the appropriate time range.

Do not expose private titles, descriptions, locations, attendees, or meeting links.

Users must be able to see their own event details while another member sees only the information that was shared.

# 11. PRIVACY AND SHARING

Privacy is a fundamental requirement.

Connected calendars must be private by default.

Users explicitly choose which calendars to share.

Implement calendar-level sharing modes:

NOT SHARED:
The calendar is visible only to its owner.

BUSY ONLY:
Other shared-space members see occupied time without event details.

FULL DETAILS:
Other authorized members see permitted event information.

Preserve provider-level event privacy restrictions.

Implement server-side authorization for all calendar and event queries.

Never trust frontend filtering as a security mechanism.

Prevent private information leakage through:

- API responses.
- Server-Sent Events.
- Logs.
- Cached queries.
- Search results.
- Error messages.
- Database access paths.

Revoking sharing must immediately prevent further authorized access to the revoked calendar, even if cached events have not yet been deleted.

# 12. DATABASE DESIGN

Use PostgreSQL and Prisma.

Create tables including:

users
shared_spaces
shared_space_members
invitations
provider_connections
calendars
calendar_shares
events
sync_states
sync_subscriptions
user_preferences
audit_logs

Use UUID primary keys.

Implement foreign keys, unique constraints, indexes, and appropriate cascade or controlled deletion behavior.

Store provider-specific event IDs.

Preserve original event timezones.

Preserve recurring event rules and exceptions.

Track event source and provider version information.

Track synchronization cursors and status.

Encrypt provider credentials at rest.

Create database migrations and development seed data.

# 13. APPLICATION PAGES

Implement:

1. Landing page.
2. Registration page.
3. Login page.
4. Shared calendar dashboard.
5. Connect calendar accounts page.
6. Calendar selection and sharing settings.
7. Shared space invitation page.
8. Shared space settings.
9. Account settings.
10. Connection status and troubleshooting page.

All navigation must work.

Do not implement nonfunctional placeholder buttons.

Use realistic mock calendar data for local development when live provider credentials are unavailable.

# 14. SECURITY REQUIREMENTS

Implement:

- Secure user authentication.
- Secure sessions.
- OAuth state validation.
- PKCE where applicable.
- CSRF protection where needed.
- Read-only provider permissions.
- Encrypted credentials.
- Server-side authorization.
- Secure invitation links.
- Rate limiting.
- Input validation.
- Secure error handling.
- HTTPS production configuration.
- No secrets in logs.
- No credentials in source control.
- Provider token revocation where supported.
- Account deletion.
- Secure data cleanup.
- Cross-user access isolation tests.

Use environment variables and a documented secret management strategy.

# 15. LOCAL DEVELOPMENT

Create a complete local development environment.

Include:

- Next.js application.
- PostgreSQL database.
- Background synchronization worker.
- Redis if needed.
- Mock calendar providers.
- Docker Compose configuration.

Provide:

- README.md
- .env.example
- Setup instructions
- Development commands
- Database migration commands
- Seed scripts
- Test commands
- Production build commands
- Provider setup instructions

The application must be usable locally with two demo accounts and sample calendar events.

Mock events must be clearly distinguishable from live provider data.

# 16. TESTING

Implement automated tests covering:

- User registration and login.
- Shared space creation.
- Invitation acceptance.
- Calendar connection workflows.
- Calendar sharing permissions.
- Provider event normalization.
- Event creation detection.
- Event modification detection.
- Event deletion detection.
- Recurring events.
- Timezone differences.
- Daylight saving time transitions.
- Duplicate prevention.
- Synchronization retries.
- Provider failures.
- Credential expiration.
- Private event visibility.
- Cross-user authorization.
- Cross-space isolation.
- Live frontend updates.
- Responsive calendar UI.

Use mock provider adapters for automated tests.

Clearly distinguish mocked integration tests from live-provider validation.

# 17. DEPLOYMENT

Prepare the application for deployment to a small VPS or managed cloud platform.

Include:

- Production Dockerfiles.
- Docker Compose deployment option.
- Environment configuration.
- Database migration process.
- HTTPS/reverse proxy guidance.
- Background worker deployment.
- Persistent database storage.
- Secure secret management.
- Health checks.
- Structured logs.
- Backup and recovery instructions.
- GitHub Actions CI.

Do not introduce Kubernetes or microservices unless there is a demonstrated need.

# 18. DEVELOPMENT ROADMAP

Implement the project in phases.

PHASE 1 — FOUNDATION
- Initialize repository.
- Configure Next.js and TypeScript.
- Configure PostgreSQL and Prisma.
- Implement authentication.
- Create Docker development environment.
- Establish shared types and architecture.

PHASE 2 — SHARED ACCOUNTS
- Implement private shared spaces.
- Implement invitation links.
- Implement membership management.
- Implement calendar sharing permissions.

PHASE 3 — CALENDAR DASHBOARD
- Build responsive calendar interface.
- Implement month/week/day/agenda views.
- Implement filtering.
- Implement event details.
- Implement mock data.

PHASE 4 — GOOGLE INTEGRATION
- OAuth.
- Calendar discovery.
- Read-only event retrieval.
- Incremental synchronization.
- Webhooks.
- Automatic updates.

PHASE 5 — MICROSOFT INTEGRATION
- OAuth.
- Calendar discovery.
- Read-only event retrieval.
- Delta synchronization.
- Change notifications.
- Automatic updates.

PHASE 6 — APPLE INTEGRATION
- CalDAV authentication.
- Calendar discovery.
- Read-only event retrieval.
- Scheduled synchronization.
- Automatic updates.

PHASE 7 — PRODUCTION HARDENING
- Security testing.
- Performance optimization.
- Error recovery.
- PWA support.
- Deployment configuration.
- Documentation.

# 19. CODEX EXECUTION INSTRUCTIONS

Before implementing:

1. Inspect the repository.
2. Preserve useful existing code.
3. Create architecture documentation.
4. Create AGENTS.md containing repository instructions.
5. Create docs/IMPLEMENTATION_STATUS.md.
6. Create a detailed development checklist.
7. Begin Phase 1.

Work autonomously through the phases.

After each phase:

- Run tests.
- Fix failures.
- Run linting.
- Run TypeScript checks.
- Verify the production build.
- Update implementation status.
- Document blockers.
- Continue to the next phase when possible.

Do not stop after Phase 1 unless blocked by execution limits or required user input.

If the session ends, preserve enough documentation to resume development.

Do not pretend unavailable external integrations are working.

If provider credentials are missing, use mocks and continue building independent functionality.

# 20. DEFINITION OF DONE

The application is complete when:

1. Two users can securely create accounts.
2. One user can invite the other to a shared space.
3. Both can connect supported calendar accounts.
4. Both can select calendars to share.
5. Shared events appear in one combined calendar.
6. Events are color-coded by person.
7. Users can filter calendars and members.
8. New events automatically appear after synchronization.
9. Modified events automatically update.
10. Deleted events automatically disappear.
11. Recurring events and timezones work correctly.
12. Privacy settings are enforced.
13. The application is strictly read-only.
14. The frontend updates without page reloads.
15. The application works well on mobile and desktop.
16. Tests pass.
17. Production deployment is documented.
18. Live provider integrations are validated when credentials are available.

# FINAL INSTRUCTION

Begin building the application now.

Inspect the repository, create the architecture and implementation plan, and start Phase 1.

Continue through the remaining phases systematically.

Make reasonable technical decisions independently.

Prioritize reliability, privacy, automatic synchronization, and a beautiful calendar interface.

The finished product should make it effortless for two people to see each other's schedules in one place without changing how they currently use Apple Calendar, Google Calendar, or Outlook Calendar.