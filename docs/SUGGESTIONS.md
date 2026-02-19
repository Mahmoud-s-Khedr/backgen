# Backend Creator (bcm) — Suggestions for Improvement

## Immediate Fixes (Bug Fixes)

### 1. Fix auth middleware export name

**File**: `src/templates/middleware/auth.middleware.ts.ejs`

Rename the exported function from `authMiddleware` to `authenticate` to match the import in `routes.ts.ejs`. This is a runtime-breaking bug for any model using `/// @bcm.protected`.

### 2. Add field whitelist to query builder

**File**: `src/templates/utils/query-builder.ts.ejs`

Accept an array of allowed field names and reject filter keys that aren't in the list. The module generator should pass the model's scalar field names (excluding `hidden` and `writeOnly` fields) to the query builder.

```typescript
// query-builder should accept:
export function buildQueryOptions(
  query: Record<string, unknown>,
  allowedFilterFields: string[]  // Add this parameter
): QueryOptions { ... }
```

### 3. Fix enum field `isRelation` flag

**File**: `src/parser/prisma-ast-parser.ts`

Add an `isEnum` flag to `FieldDefinition` and check against the parsed enum names before marking fields as relations. This eliminates the need for `enumNames.has()` workarounds in templates.

### 4. Centralize scalar type definitions

Create a shared `SCALAR_TYPES` constant (or a single `typeMapping` object) that all three consumers reference: `isNonScalarType()`, `prismaToZodType()`, and `prismaToTsType()`. This prevents them from drifting apart.

### 5. Use generic types in response helpers

**File**: `src/templates/utils/response.ts.ejs`

```typescript
export function sendSuccess<T>(res: Response, data: T, meta?: PaginationMeta): void { ... }
```

### 6. Add proper return types to services

**File**: `src/templates/module/service.ts.ejs`

Use Prisma's generated types instead of `unknown`:

```typescript
import type { <%= model.name %> } from '@prisma/client';

async findMany(...): Promise<{ data: <%= model.name %>[]; total: number }>
async findById(...): Promise<<%= model.name %> | null>
```

---

## Short-Term Improvements

### 7. Write a test suite

Add Vitest tests covering:
- **Parser unit tests**: Verify prisma-ast-parser correctly extracts models, fields, relations, enums, and directives from sample schemas
- **Directive parser tests**: Verify conflict detection, model-level vs field-level parsing, and warning generation
- **Generator integration tests**: Run `bcm generate` on a sample schema and verify the output file structure, TypeScript compilation, and key code patterns
- **Template engine tests**: Verify type mapping, pluralization, and helper functions

### 8. Use validation middleware in routes

**Files**: `src/templates/module/routes.ts.ejs`, `src/templates/middleware/validation.middleware.ts.ejs`

Move Zod validation from controllers to route-level middleware. This fails fast before the controller runs and makes the validation middleware template actually useful:

```typescript
router.post('/', validate(CreateSchema, 'body'), (req, res, next) => controller.create(req, res, next));
```

### 9. Handle more Prisma error codes

**File**: `src/templates/middleware/error.middleware.ts.ejs`

Add handlers for at least: P2005 (value too long), P2006 (invalid value), P2011 (null constraint), P2014 (relation violation), P2021 (table doesn't exist). Consider a mapping object instead of a switch statement for easier extension.

### 10. Fix project name extraction

**File**: `src/generator/generators/infra-generator.ts`

```typescript
const resolvedPath = path.resolve(options?.output || '.');
const projectName = basename(resolvedPath) || 'api-server';
```

### 11. Align `init` command with generated output

**File**: `src/commands/init.ts`

Update the starter `package.json` to match the scripts and dependencies that `bcm generate` produces. Users who run `bcm init` then `bcm generate` shouldn't see conflicting configurations.

### 12. Add CI/CD to the CLI project itself

Create `.github/workflows/ci.yml` for the backgen repository with: lint (`tsc --noEmit`), test (`vitest run`), build (`npm run build`), and a smoke test (generate from example schema and verify output compiles).

### 13. Add missing repository files

- `LICENSE` — MIT license text in repo root
- `CHANGELOG.md` — Document v1.0.0 features, Feb 2026 improvements
- `CONTRIBUTING.md` — Development setup, PR process, coding conventions

### 14. Warn on unknown Prisma types

**File**: `src/generator/template-engine.ts`

Instead of silently falling back to `z.string()`, log a warning during generation so users know a field type wasn't recognized:

```typescript
if (!map[prismaType]) {
  console.warn(`Warning: Unknown Prisma type "${prismaType}", defaulting to z.string()`);
}
```

### 15. Log CORS status in production

**File**: `src/templates/config/cors.ts.ejs`

When CORS origin is disabled in production, log a warning at startup so developers know cross-origin requests will be blocked:

```typescript
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn('CORS_ORIGIN not set — cross-origin requests are disabled in production');
}
```

---

## Medium-Term Enhancements

### 16. Configurable seed count

**File**: `src/templates/prisma/seed.ts.ejs`

```typescript
const SEED_COUNT = parseInt(process.env.SEED_COUNT || '5', 10);
```

### 17. Make JSON body limit configurable

**File**: `src/templates/app.ts.ejs`

```typescript
app.use(express.json({ limit: process.env.JSON_LIMIT || '1mb' }));
```

Lower the default from 10 MB to 1 MB.

### 18. Request ID propagation with AsyncLocalStorage

**File**: `src/templates/app.ts.ejs`

Use Node.js `AsyncLocalStorage` to propagate the `X-Request-ID` through async contexts so that Pino logs inside services and Prisma queries include the request ID automatically.

### 19. Add `@bcm.searchable` directive

Allow marking specific fields as searchable. The query builder would only accept filter/search operations on these fields, providing both a whitelist mechanism and explicit API documentation.

### 20. Add `@bcm.softDelete` directive

Generate a `deletedAt` field pattern where DELETE sets a timestamp instead of removing the record, and all queries automatically filter out soft-deleted records.

### 21. Improve OpenAPI spec for optional fields

**File**: `src/generator/generators/swagger-generator.ts`

Mark optional Prisma fields as `nullable: true` in the OpenAPI spec. Include proper `required` arrays that only list truly required fields.

### 22. Improve Prisma error messages with field details

**File**: `src/templates/module/service.ts.ejs`

Parse Prisma error metadata to include which field caused the constraint violation:

```typescript
const field = (error as { meta?: { target?: string[] } }).meta?.target?.[0] || 'unknown';
detail: `Field '${field}' must be unique.`
```

### 23. Warn on orphaned directives

**File**: `src/parser/directive-parser.ts`

When a field directive (`/// @bcm.readonly`, etc.) appears outside any model block, emit a warning instead of silently ignoring it.

### 24. Increase shutdown timeout and make it configurable

**File**: `src/templates/server.ts.ejs`

```typescript
const SHUTDOWN_TIMEOUT = parseInt(process.env.SHUTDOWN_TIMEOUT || '30000', 10);
setTimeout(() => { process.exit(1); }, SHUTDOWN_TIMEOUT);
```

---

## Long-Term Vision

### 25. Plugin / hook system

Allow users to extend the generation pipeline with custom templates or post-processing hooks. For example, a plugin could add a custom middleware, modify the generated service layer, or add additional endpoints beyond CRUD.

### 26. Multiple output targets

Beyond Express.js, support generating:
- **Fastify** backend (similar structure, different framework)
- **GraphQL** API (from the same Prisma schema)
- **tRPC** endpoints (type-safe API layer)

### 27. Composite key support

Currently, `bcm` assumes a single `id` field per model. Support `@@id([field1, field2])` composite primary keys by generating appropriate route parameters, service methods, and DTOs.

### 28. Custom template overrides

Allow users to place custom templates in a `.bcm/templates/` directory that override the defaults. This would let teams customize generated code patterns without forking the CLI.

### 29. Watch mode for development

Add a `bcm watch` command that monitors the Prisma schema file and re-generates the backend on changes, similar to how `prisma generate --watch` works.

### 30. Interactive schema builder

Add a `bcm add-model` command that interactively prompts for model name, fields, types, and directives, then appends the model to the existing Prisma schema.
