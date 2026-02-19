# Backend Creator (bcm) — Problems & Issues

## Critical

### 1. Auth middleware export name mismatch — Runtime crash

**Files**: `src/templates/middleware/auth.middleware.ts.ejs`, `src/templates/module/routes.ts.ejs`

The auth middleware exports the function as `authMiddleware`, but the routes template imports it as `authenticate`:

```typescript
// auth.middleware.ts.ejs — exports:
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void { ... }

// routes.ts.ejs — imports:
import { authenticate } from '../../middlewares/auth.middleware.js';
```

**Impact**: Any model with `/// @bcm.protected` will generate code that crashes at runtime with `authenticate is not defined`. This is a blocking bug for the protected routes feature.

---

## High Priority

### 2. Query builder accepts arbitrary filter keys — Security risk

**File**: `src/templates/utils/query-builder.ts.ejs`

The `buildQueryOptions()` function accepts any query parameter as a filter key without validating it against the model's actual fields. A user can filter on sensitive fields:

```
GET /api/users?filter[password]=test
GET /api/users?filter[internalToken]=abc
```

Fields marked `@bcm.hidden` or `@bcm.writeOnly` are excluded from response DTOs but can still be used as filter criteria since the query builder has no field whitelist.

### 3. Enum fields incorrectly marked as relations

**File**: `src/parser/prisma-ast-parser.ts:145-146`

```typescript
const isImplicitRelation = !isRelation && (isList || isNonScalarType(fieldType));
```

Enum field types pass `isNonScalarType()` (they're not in the scalar type set), so they get `isRelation: true`. Templates work around this with `enumNames.has(f.type)` checks, but the underlying data model is semantically wrong. This creates a brittle dependency where every consumer must know to double-check against the enum list.

### 4. Scalar type definitions not synchronized

**Files**: `src/parser/prisma-ast-parser.ts:207-213`, `src/generator/template-engine.ts:70-98`

Scalar types are defined in three separate locations:
- `isNonScalarType()` in the parser (negative check)
- `prismaToZodType()` in template-engine (Prisma → Zod mapping)
- `prismaToTsType()` in template-engine (Prisma → TypeScript mapping)

If a new Prisma type is added, all three must be updated independently. There's no shared source of truth.

### 5. Response helpers and service return types use `any`/`unknown`

**Files**: `src/templates/utils/response.ts.ejs`, `src/templates/module/service.ts.ejs`

Response helpers use `any`:
```typescript
export function sendSuccess(res: Response, data: any, meta?: PaginationMeta): void { ... }
```

Service methods return `unknown`:
```typescript
async findMany(...): Promise<{ data: unknown[]; total: number }>
async findById(...): Promise<unknown | null>
```

This defeats TypeScript's type safety through the entire response pipeline. Consumers get no type information about what the service returns.

### 6. Only 3 Prisma error codes handled

**File**: `src/templates/middleware/error.middleware.ts.ejs`

The error middleware maps only P2002 (unique constraint), P2003 (foreign key), and P2025 (record not found). Many common errors return a generic 500:

- P2005: Field value too long
- P2006: Invalid field value
- P2011: Null constraint violation
- P2014: Required relation violation
- P2021: Table/column doesn't exist

---

## Medium Priority

### 7. `init` command package.json doesn't match generated output

**File**: `src/commands/init.ts:35-48`

The starter `package.json` created by `bcm init` uses different scripts and dependencies than what `bcm generate` produces. For example, init references `tsx watch` and `jest`, while the generated project uses different tooling.

### 8. Project name extraction fails with `--output .`

**File**: `src/generator/generators/infra-generator.ts:10`

```typescript
const projectName = options?.output ? basename(options.output) : 'api-server';
```

When `--output .` is used, `basename('.')` returns `'.'`, which becomes the project name in `package.json`, Docker image names, and other templates. Should use `path.resolve()` first.

### 9. Silent fallback to `z.string()` for unknown Prisma types

**File**: `src/generator/template-engine.ts:81`

```typescript
return map[prismaType] || `z.string()`;
```

If a Prisma type isn't in the mapping (e.g., a custom type or new Prisma addition), the generator silently falls back to `z.string()`. This masks schema errors that would be caught at build time if the function threw instead.

### 10. CORS silently disabled in production

**File**: `src/templates/config/cors.ts.ejs:6`

```typescript
origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*'),
```

If `CORS_ORIGIN` isn't set in production, CORS is completely disabled. Frontend applications will get cryptic CORS errors with no indication that the backend is intentionally blocking them. No warning is logged.

### 11. `pluralize` uses default import

**File**: `src/generator/template-engine.ts:10`

```typescript
import pluralizeLib from 'pluralize';
```

With `moduleResolution: "Node16"`, default imports from CJS packages resolve to the module namespace object (not callable). The project's own convention (documented in MEMORY.md) is to use named imports. While this works due to ESM interop, it's inconsistent with the pattern enforced elsewhere (pino, pino-http).

### 12. Orphaned directives silently ignored

**File**: `src/parser/directive-parser.ts:125`

Field directives (`/// @bcm.readonly`, etc.) placed outside a model block are silently ignored. Users get no warning that their directive has no effect, which can lead to confusion when fields appear in the API despite being marked.

### 13. Docker Compose falls back to weak credentials

**File**: `src/templates/infra/docker-compose.yml.ejs`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
```

Default credentials of `postgres:postgres` are used if environment variables aren't set. In production deployments, this creates a security risk if `.env` isn't properly configured.

### 14. JSON body limit hardcoded at 10 MB

**File**: `src/templates/app.ts.ejs`

```typescript
app.use(express.json({ limit: '10mb' }));
```

10 MB is unusually high for a JSON API (most APIs use 1 MB or less). This could be exploited for memory exhaustion attacks. The limit isn't configurable via environment variable.

### 15. Validation middleware exists but isn't used in routes

**Files**: `src/templates/middleware/validation.middleware.ts.ejs`, `src/templates/module/routes.ts.ejs`

A validation middleware template exists and is generated, but routes don't use it. Instead, controllers do inline `Schema.parse()` calls. This means:
- Request validation happens late (inside the controller, not at the route level)
- The validation middleware is dead code in every generated project

### 16. Seed script directive cleanup leaves blank lines

**File**: `src/generator/generators/prisma-generator.ts:5`

```typescript
const BCM_DIRECTIVE_REGEX = /^\s*\/\/\/\s*@bcm\.\w+.*\n?/gm;
```

When stripping `@bcm.*` directives from the schema before writing to the generated project, the regex removes the directive lines but leaves blank lines behind. The `eject` command handles this with consecutive blank line cleanup, but the generator doesn't.

### 17. Response schema optionality may cause validation errors

**File**: `src/templates/module/dto.ts.ejs:45-51`

Fields with `hasDefault: true` (like `createdAt`) are marked as required in the response Zod schema. If the database returns `null` for any of these fields (e.g., due to a migration or data inconsistency), response validation will fail.

---

## Low Priority

### 18. Documentation references removed tooling

**Files**: `docs/USAGE.md`, `docs/idea.md`

Multiple docs reference `tsx` for the dev server and `Jest` for testing. The build system was migrated to esbuild and the test runner is Vitest. These references are outdated and could confuse users.

### 19. Zero test coverage

No test files exist despite Vitest being configured in `package.json`. The implementation plan specifies a Phase 7 test suite covering parser unit tests, generator unit tests, and integration tests — none of which were completed.

### 20. Missing repository files

- **LICENSE**: MIT is declared in `package.json` but no `LICENSE` file exists in the repo root
- **CHANGELOG.md**: No version history documenting v1.0.0 features or the Feb 2026 improvements
- **CONTRIBUTING.md**: No contribution guidelines
- **.github/workflows/ci.yml**: Referenced in docs and generated for output projects, but the CLI project itself has no CI

### 21. Seed count hardcoded

**File**: `src/templates/prisma/seed.ts.ejs`

The seed script always creates exactly 5 records per model. This isn't configurable via environment variable or CLI flag.

### 22. Server shutdown timeout may be too short

**File**: `src/templates/server.ts.ejs`

```typescript
setTimeout(() => {
  logger.error('Forced shutdown after timeout');
  process.exit(1);
}, 10_000);
```

10 seconds may not be enough for long-running database operations to complete. If `prisma.$disconnect()` is still running when the timeout fires, connections may be left dangling.

### 23. Swagger generator doesn't handle nullable/optional correctly

**File**: `src/generator/generators/swagger-generator.ts:258-284`

The `buildObjectSchema()` function doesn't add `nullable: true` to OpenAPI properties for optional fields. Optional Prisma fields should be marked nullable in the OpenAPI spec for accurate documentation.

### 24. `test.ts.ejs` template is a placeholder

**File**: `src/templates/module/test.ts.ejs`

The per-model test template generates minimal or placeholder test files. Generated projects get test files that don't provide meaningful coverage.
