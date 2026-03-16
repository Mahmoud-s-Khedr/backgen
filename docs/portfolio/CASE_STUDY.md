# Backgen Case Study (Mahmoud Khedr)

## 1) Context / Problem
Developers repeatedly rebuild the same backend scaffolding (CRUD routes, validation, auth wiring, infra templates) whenever they start from a Prisma schema. This adds setup overhead and creates inconsistent project quality.

## 2) Solution Approach
Backgen converts Prisma schema definitions into a production-ready Express + TypeScript backend.

Core strategy:
- Parse schema + directives once.
- Build model metadata.
- Generate templates for routes/controllers/services/DTOs/tests/repository tests/infra.
- Generate Postman Collection v2.1 for API testing.
- Expose generation through both CLI and a web playground.

## 3) Architecture Decisions and Tradeoffs

### Decision A: Directive-driven schema extensions (`/// @bcm.*`)
- Why: keep source of truth close to Prisma model definitions.
- Tradeoff: requires strict parser and validation rules.

### Decision B: Fail-fast schema validation
- Why: detect invalid generation states before runtime.
- Tradeoff: stricter UX in CLI, but fewer runtime 500s.

### Decision C: CLI-backed web playground
- Why: keep one canonical generation path and avoid drift between browser and CLI behavior.
- Tradeoff: requires Node-hosted playground service (not pure static frontend).

### Decision D: Provider-aware generated infrastructure
- Why: support PostgreSQL/MySQL/SQLite/MongoDB patterns in generated templates.
- Tradeoff: additional matrix complexity in templates and tests.

## 4) Hard Technical Challenges Solved
1. Selector-aware generation for models using single/composite selectors.
2. Nested relation input handling with correct Prisma connect/create shapes.
3. Auth model typing + JWT claim consistency from schema directives.
4. Validation hardening for hidden/readonly required fields.
5. Playground migration to true CLI execution with structured JSON output.

## 5) Security and Reliability Posture
- RFC 7807 problem details in generated APIs.
- Rate limiting and CORS defaults in generated projects.
- CLI-backed playground API with request validation, payload caps, timeout, and fixed command invocation.
- Structured logging (request metadata without logging raw schema payload).

## 6) Measured Proof (Claim -> Evidence Source)

| Claim | Evidence Source |
|---|---|
| Root generator test suite passes | `pnpm test` -> `tests/*` passing summary (root) |
| Playground test suite passes | `pnpm --dir packages/playground test` |
| Typed checks pass | `pnpm run lint` and `pnpm --dir packages/playground run typecheck` |
| CLI JSON mode outputs file content for preview/download | `node dist/generator/cli.js generate --dry-run --json ...` |
| Example matrix is maintained through script | `scripts/run-examples.js` and `pnpm run examples` |
| Playground uses CLI path in monolithic service | `packages/playground/server/*` + `packages/playground/src/generator.ts` |
| Multi-provider support is implemented | Prisma provider-aware generation logic and templates (`src/generator/*`, `src/templates/infra/*`) |
| Repository unit tests generated per model | `src/templates/module/repository.test.ts.ejs` — 7 files per model |
| Postman collection export | `--only api-client` generates `postman-collection.json` (Postman v2.1) |
| Background job scaffolding | `--jobs bullmq` or `--jobs pg-boss` generates typed queue, worker, and example job files |
| WebSocket real-time support | `--ws` + `@bcm.ws` generates ws-server, ws-broadcast, ws-types; auto-enables event bus for marked models |

## 7) Future Roadmap
1. Add benchmark suite for generation throughput and memory profile.
2. Add e2e golden-file regression tests for major schema patterns.
3. Add authenticated/tenant-aware generation profiles.
4. Publish a hosted public demo URL with rate-limit telemetry dashboard.
