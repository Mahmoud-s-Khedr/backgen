# Backend Creator (bcm) — Suggestions for Improvement

> **Status as of v1.1.0 (2026-02-19):** Items marked ✅ are implemented. Remaining items are still open.

## Immediate Fixes (Bug Fixes)

### 1. ✅ DONE — Fix auth middleware export name

Renamed `authMiddleware` → `authenticate` in `auth.middleware.ts.ejs`.

### 2. ✅ DONE — Add field whitelist to query builder

`buildQueryOptions()` now accepts `allowedFilterFields` and `searchableFields`. Controllers define allowed fields from model metadata. Unknown filter keys are silently skipped.

### 3. ✅ DONE — Fix enum field `isRelation` flag

Added `isEnum: boolean` to `FieldDefinition`. Parser checks against enum names before marking fields as relations.

### 4. ✅ DONE — Centralize scalar type definitions

Shared `PRISMA_SCALAR_TYPES` Set exported from `template-engine.ts`, used by parser and type mappers.

### 5. ✅ DONE — Use generic types in response helpers

`sendSuccess<T>()`, `sendCreated<T>()` now use generics instead of `any`.

### 6. ✅ DONE — Add proper return types to services

Services now import `type { Model } from '@prisma/client'` and use typed return values.

---

## Short-Term Improvements

### 7. ✅ DONE — Write a test suite

119 tests across 4 Vitest test files:
- `tests/prisma-ast-parser.test.ts` (25 tests): models, fields, relations, enums, directives, auth roles
- `tests/directive-parser.test.ts` (21 tests): conflict detection, model/field-level parsing, auth, nested, warnings
- `tests/generator.test.ts` (40 tests): full generation, `--only` flag, RBAC, multi-db, nested relations
- `tests/template-engine.test.ts` (33 tests): type mappings, helpers, EJS rendering

### 8. ✅ DONE — Use validation middleware in routes

Routes now import DTO schemas and apply `validate()` middleware at the route level for POST, PUT, and PATCH.

### 9. ✅ DONE — Handle more Prisma error codes

Error middleware now uses a `PRISMA_ERROR_MAP` object with 9 error codes (P2000, P2002, P2003, P2005, P2006, P2011, P2014, P2021, P2025).

### 10. ✅ DONE — Fix project name extraction

Uses `path.resolve()` before `basename()` to handle `--output .` correctly.

### 11. ✅ DONE — Align `init` command with generated output

Updated init's starter `package.json` to use `jest` for tests and `type: "module"`, matching the generated project's `package.json.ejs`. Also added the `generate` script.

### 12. OPEN — Add CI/CD to the CLI project itself

Create `.github/workflows/ci.yml` for the backgen repository with: lint (`tsc --noEmit`), test (`vitest run`), build (`npm run build`), and a smoke test (generate from example schema and verify output compiles).

### 13. ✅ DONE — Add missing repository files

`LICENSE` (MIT), `CHANGELOG.md` (v1.0.0), and `CONTRIBUTING.md` (dev setup, conventions) now exist.

### 14. ✅ DONE — Warn on unknown Prisma types

`prismaToZodType()` now logs `console.warn()` when a type isn't in the mapping.

### 15. ✅ DONE — Log CORS status in production

CORS template now logs a warning when `CORS_ORIGIN` is not set in production.

---

## Medium-Term Enhancements

### 16. ✅ DONE — Configurable seed count

Seed script uses `SEED_COUNT` env var (default: 5).

### 17. ✅ DONE — Make JSON body limit configurable

`express.json({ limit: process.env.JSON_LIMIT || '1mb' })` — default lowered from 10mb.

### 18. OPEN — Request ID propagation with AsyncLocalStorage

Use Node.js `AsyncLocalStorage` to propagate the `X-Request-ID` through async contexts so that Pino logs inside services and Prisma queries include the request ID automatically.

### 19. ✅ DONE — Add `@bcm.searchable` directive

Fields marked `@bcm.searchable` are included in full-text search via `?search=term` query parameter. Query builder builds `OR` conditions across searchable fields.

### 20. ✅ DONE — Add `@bcm.softDelete` directive

Models with `@bcm.softDelete` use `deletedAt` timestamp pattern. DELETE sets timestamp instead of hard delete, all queries filter out soft-deleted records.

### 21. ✅ DONE — Improve OpenAPI spec for optional fields

Optional Prisma fields now include `nullable: true` in the OpenAPI spec. Search query parameter documented on list endpoints.

### 22. ✅ DONE — Improve Prisma error messages with field details

Error middleware now extracts field info from `PrismaClientKnownRequestError.meta`: reads `meta.target` (P2002 unique violations) and `meta.field_name` (P2003 FK violations), appending the field name to the detail message and including a `fields` array in the response when available.

### 23. ✅ DONE — Warn on orphaned directives

Field directives outside model blocks now emit a warning.

### 24. ✅ DONE — Increase shutdown timeout and make it configurable

`SHUTDOWN_TIMEOUT` env var (default: 30000ms, increased from 10000ms).

---

## Long-Term Vision

### 25. OPEN — Plugin / hook system

Allow users to extend the generation pipeline with custom templates or post-processing hooks.

### 26. OPEN — Multiple output targets

Support generating Fastify, GraphQL, or tRPC endpoints from the same Prisma schema.

### 27. OPEN — Composite key support

Support `@@id([field1, field2])` composite primary keys with appropriate route parameters, service methods, and DTOs.

### 28. OPEN — Custom template overrides

Allow users to place custom templates in a `.bcm/templates/` directory that override the defaults.

### 29. OPEN — Watch mode for development

`bcm watch` command that monitors the Prisma schema file and re-generates on changes.

### 30. OPEN — Interactive schema builder

`bcm add-model` command that interactively prompts for model name, fields, types, and directives.
