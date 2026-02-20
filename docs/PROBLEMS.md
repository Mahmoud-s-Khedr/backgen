# Backend Creator (bcm) — Problems & Issues

> **Status as of v1.0.0 (2026-02-19):** All 24 issues have been resolved.

## Critical

### 1. ✅ FIXED — Auth middleware export name mismatch — Runtime crash

**Files**: `src/templates/middleware/auth.middleware.ts.ejs`, `src/templates/module/routes.ts.ejs`

The auth middleware now exports `authenticate`, matching the import in `routes.ts.ejs`.

---

## High Priority

### 2. ✅ FIXED — Query builder accepts arbitrary filter keys — Security risk

**File**: `src/templates/utils/query-builder.ts.ejs`

`buildQueryOptions()` now accepts `allowedFilterFields` and `searchableFields` parameters. Controllers define `ALLOWED_FILTER_FIELDS` (scalar, non-hidden, non-writeOnly fields) and pass them to the query builder. Unknown filter keys and sort fields are rejected.

### 3. ✅ FIXED — Enum fields incorrectly marked as relations

**Files**: `src/parser/types.ts`, `src/parser/prisma-ast-parser.ts`

Added `isEnum: boolean` to `FieldDefinition`. The parser now uses a two-pass approach: first collects enum names, then correctly sets `isEnum: true, isRelation: false` for enum fields. Templates no longer need `enumNames.has(f.type)` workarounds.

### 4. ✅ FIXED — Scalar type definitions not synchronized

**Files**: `src/parser/prisma-ast-parser.ts`, `src/generator/template-engine.ts`

A shared `PRISMA_SCALAR_TYPES` Set is exported from `template-engine.ts` and used by both the parser's `isNonScalarType()` and the type mapping functions.

### 5. ✅ FIXED — Response helpers and service return types use `any`/`unknown`

**Files**: `src/templates/utils/response.ts.ejs`, `src/templates/module/service.ts.ejs`

Response helpers now use generics (`sendSuccess<T>`, `sendCreated<T>`). Services use Prisma's generated types (`Promise<{ data: Model[]; total: number }>`, `Promise<Model | null>`, `Promise<Model>`).

### 6. ✅ FIXED — Only 3 Prisma error codes handled

**File**: `src/templates/middleware/error.middleware.ts.ejs`

Error middleware now uses a `PRISMA_ERROR_MAP` object handling 9 error codes: P2000, P2002, P2003, P2005, P2006, P2011, P2014, P2021, P2025.

---

## Medium Priority

### 7. ✅ FIXED — `init` command package.json doesn't match generated output

**File**: `src/commands/init.ts`

The starter `package.json` now uses `jest` for the test script (matching `package.json.ejs`) and includes the `generate` script.

### 8. ✅ FIXED — Project name extraction fails with `--output .`

**File**: `src/generator/generators/infra-generator.ts`

Now uses `path.resolve()` before `basename()`: `const resolvedPath = resolve(options?.output || '.'); const projectName = basename(resolvedPath) || 'api-server';`

### 9. ✅ FIXED — Silent fallback to `z.string()` for unknown Prisma types

**File**: `src/generator/template-engine.ts`

Now logs `console.warn()` when an unknown Prisma type is encountered, before falling back to `z.string()`.

### 10. ✅ FIXED — CORS silently disabled in production

**File**: `src/templates/config/cors.ts.ejs`

Now logs a warning at startup when `CORS_ORIGIN` is not set in production.

### 11. ✅ VERIFIED — `pluralize` uses default import (not a bug)

**File**: `src/generator/template-engine.ts`

The `pluralize` package is CJS with `module.exports = pluralize` — it has no named exports. Default import is the only option and works correctly with both Node.js ESM interop and esbuild's bundled output. Verified at runtime: `pluralizeLib.plural('User')` → `'Users'`, `pluralizeLib.plural('Category')` → `'Categories'`. A comment in the source explains the import choice.

### 12. ✅ FIXED — Orphaned directives silently ignored

**File**: `src/parser/directive-parser.ts`

Field directives outside model blocks now emit a warning message instead of being silently ignored.

### 13. ✅ FIXED — Docker Compose falls back to weak credentials

**File**: `src/templates/infra/docker-compose.yml.ejs`

Uses environment variable references (`${POSTGRES_PASSWORD:-postgres}`) and includes a comment warning to change default credentials before production deployment.

### 14. ✅ FIXED — JSON body limit hardcoded at 10 MB

**File**: `src/templates/app.ts.ejs`

Now configurable via `JSON_LIMIT` env var with a default of `1mb` (lowered from 10mb).

### 15. ✅ FIXED — Validation middleware exists but isn't used in routes

**Files**: `src/templates/module/routes.ts.ejs`, `src/templates/module/controller.ts.ejs`

Routes now import DTO schemas and use `validate()` middleware at the route level for POST, PUT, and PATCH. Controllers no longer do inline `Schema.parse()` calls.

### 16. ✅ FIXED — Seed script directive cleanup leaves blank lines

**File**: `src/generator/generators/prisma-generator.ts`

Added `.replace(/\n{3,}/g, '\n\n')` after directive stripping to collapse multiple blank lines.

### 17. ✅ FIXED — Response schema optionality may cause validation errors

**File**: `src/templates/module/dto.ts.ejs`

Fields with `hasDefault: true` in the response schema now use `.optional()` to tolerate nulls.

---

## Low Priority

### 18. ✅ FIXED — Documentation references removed tooling

**Files**: `docs/idea.md`

`idea.md` tech stack table now correctly lists `swagger-ui-express + programmatic OpenAPI spec` (not `swagger-jsdoc`) and `Supertest + Jest (generated) / Vitest (CLI)` for testing.

### 19. ✅ FIXED — Zero test coverage

92 tests across 4 test files now cover the CLI's core modules:
- `tests/directive-parser.test.ts` — 17 tests: field/model directives, conflicts, warnings, unknown directives
- `tests/prisma-ast-parser.test.ts` — 22 tests: datasource, models, fields, relations, enums, directive integration
- `tests/template-engine.test.ts` — 33 tests: helpers, type mappings, PRISMA_SCALAR_TYPES, EJS rendering
- `tests/generator.test.ts` — 20 tests: full generation, `--only` flag, file content validation (DTOs, routes, auth, soft delete, search)

### 20. ✅ FIXED — Missing repository files

`LICENSE` (MIT), `CHANGELOG.md` (v1.0.0), and `CONTRIBUTING.md` (dev setup, conventions) now exist in the repo root.

### 21. ✅ FIXED — Seed count hardcoded

**File**: `src/templates/prisma/seed.ts.ejs`

Now configurable via `SEED_COUNT` env var (default: 5).

### 22. ✅ FIXED — Server shutdown timeout may be too short

**File**: `src/templates/server.ts.ejs`

Now configurable via `SHUTDOWN_TIMEOUT` env var (default: 30000ms, increased from 10000ms).

### 23. ✅ FIXED — Swagger generator doesn't handle nullable/optional correctly

**File**: `src/generator/generators/swagger-generator.ts`

Optional fields now include `nullable: true` in the OpenAPI spec.

### 24. ✅ FIXED — `test.ts.ejs` template is a placeholder

**File**: `src/templates/module/test.ts.ejs`

Test scaffold now includes POST, PUT, PATCH, DELETE tests, a validation error test (422 for empty body), and a `validPayload()` helper function.
