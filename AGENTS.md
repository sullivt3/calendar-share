# Repository instructions

Work in the existing Next.js modular monolith. Read docs/ARCHITECTURE.md,
docs/ROADMAP.md and docs/IMPLEMENTATION_STATUS.md before changing scope.

The user controls phase progression. Phase 2 is authorized. Stop before Phase 3 until explicitly authorized. Do not deploy or push without instruction.

External calendars are strictly read-only. Never request write scopes or send
event mutations to providers. Provider credentials belong only on the server,
encrypted at rest. All authorization and busy-only redaction happen server-side.
Never log tokens, passwords, invitation secrets or event contents.

Use strict TypeScript, Zod at input boundaries, UUID IDs, and Prisma migrations.
Keep server code under src/server and provider adapters independent of UI.
No Kubernetes or microservices. No fake working integrations or inert controls.
Run lint, typecheck, unit/integration tests and production build for each phase.
Document verification limits and remaining work honestly. Never run integration
tests against production: they create and delete isolated test accounts.
