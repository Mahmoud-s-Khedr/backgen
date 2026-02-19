# backgen — Project Report

> A CLI tool that generates production-ready Express.js REST APIs from Prisma schema files.

---

## Executive Summary

**backgen** (`bcm`) is a code-generation CLI that reads a Prisma `.prisma` schema file and outputs a fully working, deployable Express.js backend in seconds. It targets backend developers who need a correct, type-safe CRUD scaffold — with real security defaults, structured logging, OpenAPI docs, and Docker infrastructure — without writing the repetitive boilerplate themselves.

The core philosophy is **eject-first**: every generated file is plain TypeScript with zero runtime dependency on the CLI. You can run `bcm generate`, commit the output, and never touch the CLI again. The generated project is yours to extend freely.

---

## 1. What It Can Do

### 1.1 Schema Parsing

backgen reads any valid `.prisma` schema file and extracts a fully normalized representation of it:

- **Models** — name, all fields with their Prisma types, nullability, and array status
- **Enums** — name and all variant values
- **Datasource** — provider (`postgresql`, `mysql`, `sqlite`, etc.) and connection URL
- **Attributes** — `@id`, `@unique`, `@default(...)`, `@updatedAt`, `@relation` (explicit and implicit)
- **Directives** — `/// @bcm.*` triple-slash comments at both field and model level

The parser uses `@mrleebo/prisma-ast` as its sole engine — a community-maintained package with a documented, stable AST API. Directive conflict detection catches incompatible combinations (e.g., `@bcm.readonly` + `@bcm.writeOnly`) before any code is written.

---

### 1.2 Per-Model Code Generation

For every model in the schema, five TypeScript files are generated:

#### Controller (`{model}.controller.ts`)
Six HTTP handlers with full error propagation:

| Method | Route | Handler |
|--------|-------|---------|
| `GET` | `/api/{models}` | `list` — paginated, sortable, filterable |
| `GET` | `/api/{models}/:id` | `getById` — with optional relation includes |
| `POST` | `/api/{models}` | `create` — Zod-validated body |
| `PUT` | `/api/{models}/:id` | `update` — full replace, all required fields |
| `PATCH` | `/api/{models}/:id` | `patch` — partial update, all fields optional |
| `DELETE` | `/api/{models}/:id` | `remove` — returns 204 No Content |

#### Service (`{model}.service.ts`)
Thin database layer using Prisma:
- `findMany(options)` — parallel `[findMany, count]` for paginated results
- `findById(id, include?)` — returns `null` if not found (controller throws 404)
- `create(data)` — maps `P2002` (unique constraint) → 409 Conflict
- `update(id, data)` — maps `P2025` (not found) → 404, `P2002` → 409
- `delete(id)` — maps `P2025` → 404

#### Routes (`{model}.routes.ts`)
Express `Router` wiring all six methods to the controller. When `@bcm.protected` is set on the model, the `authenticate` JWT middleware is automatically applied to all mutation routes (POST, PUT, PATCH, DELETE); GET routes remain public.

#### DTO (`{model}.dto.ts`)
Four Zod schemas derived directly from the Prisma schema:

| Schema | Contents |
|--------|----------|
| `Create{Model}Schema` | All writable fields; `@id`, `@default`, `@updatedAt`, `@readonly` excluded |
| `Update{Model}Schema` | Alias of Create — all required fields must be present |
| `Patch{Model}Schema` | `.partial()` of Create — all fields optional |
| `{Model}ResponseSchema` | All non-`@hidden`, non-`@writeOnly` fields |

Enums are detected and emitted as `z.enum([...])` schemas and referenced correctly in all four schemas. TypeScript types are exported via `z.infer<>`.

#### Test (`{model}.test.ts`)
Supertest scaffold covering:
- `GET /` returns 200 with `data` array and pagination `meta`
- `GET /non-existent-id` returns 404 RFC 7807 response
- `POST /` with minimum required payload returns 201

---

### 1.3 Shared Infrastructure (generated once)

#### Configuration (`src/config/`)
| File | Purpose |
|------|---------|
| `database.ts` | Prisma client singleton (prevents connection pool exhaustion) |
| `swagger.ts` | Serves the generated OpenAPI spec via `swagger-ui-express` at `/api/docs` |
| `cors.ts` | CORS options; `CORS_ORIGIN` env var required in production (disabled otherwise) |
| `logger.ts` | Pino structured logger with `LOG_LEVEL` env control |
| `env.ts` | Zod schema validating all required env vars at startup — fails fast on misconfiguration |

#### Middleware (`src/middlewares/`)
| File | Purpose |
|------|---------|
| `error.middleware.ts` | RFC 7807 Problem Detail error handler; maps ZodError → 422, Prisma errors → 409/404, unknown → 500 |
| `auth.middleware.ts` | JWT verification via `jsonwebtoken`; attaches decoded payload to `req.user`; handles expired vs invalid tokens separately |
| `rate-limit.middleware.ts` | `express-rate-limit` — 100 req/15 min window (configurable via env) |
| `validation.middleware.ts` | Zod middleware factory for use in custom routes |

#### Utilities (`src/utils/`)
| File | Purpose |
|------|---------|
| `query-builder.ts` | Converts URL query params → Prisma `findMany` arguments (see §1.4) |
| `response.ts` | `sendSuccess(res, data, meta?)`, `sendCreated(res, data)`, `sendNoContent(res)` helpers |

#### Application (`src/app.ts`, `src/server.ts`)
Full Express app middleware stack in order:
1. `helmet()` — security headers
2. `cors(corsOptions)` — origin policy
3. `express.json({ limit: '10mb' })` + `urlencoded`
4. `compression()` — gzip responses
5. Inline `X-Request-ID` middleware — forwards or generates a UUID per request for tracing
6. `pinoHttp({ logger })` — structured request logging
7. `rateLimiter` — rate limiting
8. `GET /health` — `{ status, timestamp, uptime }` (no auth)
9. All model route mounts at `/api/{models}`
10. Swagger UI at `/api/docs`
11. `errorMiddleware` — must be last

`server.ts` wraps the app in `http.createServer()` with graceful shutdown (10-second drain timeout) on `SIGTERM`/`SIGINT`.

#### Infrastructure (`Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`)
- **Dockerfile** — multi-stage build (builder → production); Alpine base; non-root `appuser`; health check
- **docker-compose.yml** — app + PostgreSQL services; credentials via env vars (not hardcoded)
- **CI pipeline** — GitHub Actions: lint → test → build; PostgreSQL service container included

#### OpenAPI Spec (`openapi.json`)
Full OpenAPI 3.0 document generated at generation time:
- All 30 endpoints documented with request/response schemas
- Component schemas for all four DTO shapes per model
- Enum schemas extracted and referenced
- Query parameter documentation (pagination, sort, filter, include)
- Health check endpoint

---

### 1.4 Query System

All list endpoints support a unified query parameter syntax:

```
GET /api/posts?page=2&limit=10
GET /api/posts?sort=createdAt&order=asc
GET /api/posts?filter[status]=PUBLISHED&filter[authorId]=abc123
GET /api/posts?include=author,comments
GET /api/posts?filter[title]=hello&sort=viewCount&order=desc&page=1&limit=5
```

| Parameter | Type | Behaviour |
|-----------|------|-----------|
| `page` | integer | Default 1, minimum 1 |
| `limit` | integer | Default 20, maximum 100 |
| `sort` | field name | Default `createdAt` |
| `order` | `asc` / `desc` | Default `desc` |
| `filter[field]` | string | String → `contains` (case-insensitive on PostgreSQL/MySQL); number → exact match; `true`/`false` → boolean |
| `include` | comma-separated | Eager-loads named Prisma relations |

Response envelope:
```json
{
  "data": [...],
  "meta": { "page": 1, "limit": 20, "total": 142, "totalPages": 8 }
}
```

---

### 1.5 Directives System

Directives are `/// @bcm.*` triple-slash comments placed immediately before a field or model declaration in the Prisma schema:

```prisma
/// @bcm.protected
model Post {
  id       String @id @default(cuid())
  /// @bcm.readonly
  viewCount Int   @default(0)
  /// @bcm.writeOnly
  password  String
  /// @bcm.hidden
  internalNote String?
}
```

| Directive | Level | Effect on Generated Code |
|-----------|-------|--------------------------|
| `@bcm.hidden` | field | Excluded from all API responses AND all input schemas |
| `@bcm.readonly` | field | Excluded from Create/Update/Patch bodies; still included in responses |
| `@bcm.writeOnly` | field | Accepted in Create/Update inputs; **never** returned in responses |
| `@bcm.protected` | model | POST/PUT/PATCH/DELETE routes require `Authorization: Bearer <token>` |

---

### 1.6 CLI Commands

```bash
# Generate a full backend
bcm generate --schema prisma/schema.prisma --output ./api

# Generate only specific categories (routes, config, middleware, utils, app, infra, prisma, swagger)
bcm generate --schema schema.prisma --output ./api --only routes,config

# Preview what would be written without writing anything
bcm generate --schema schema.prisma --output ./api --dry-run

# Force overwrite of existing files
bcm generate --schema schema.prisma --output ./api --force

# Interactive project setup wizard
bcm init

# Mark generated project as ejected (removes re-generation guards)
bcm eject
```

---

### 1.7 Generated Project Quality Checklist

| Property | Status |
|----------|--------|
| Zero runtime CLI dependency | ✅ |
| TypeScript strict mode | ✅ |
| ESM modules (`"type": "module"`) | ✅ |
| Node16 module resolution | ✅ |
| RFC 7807 error responses | ✅ |
| Production-safe CORS defaults | ✅ |
| JWT auth scaffold | ✅ |
| Rate limiting | ✅ |
| Security headers (Helmet) | ✅ |
| Structured logging (Pino) | ✅ |
| Response compression | ✅ |
| Request ID tracing | ✅ |
| Environment validation at startup | ✅ |
| Multi-stage Docker build | ✅ |
| Non-root Docker user | ✅ |
| Docker health check | ✅ |
| GitHub Actions CI | ✅ |
| Graceful shutdown | ✅ |
| OpenAPI 3.0 + Swagger UI | ✅ |

---

## 2. What It Cannot Do

### 2.1 Authentication

- **No login or register endpoint** — the `authenticate` middleware verifies JWT tokens but nothing in the generated code *issues* them. You must add `POST /auth/login` (password check + JWT sign) manually.
- **No refresh token flow** — tokens are single-use with a fixed expiry; there is no `POST /auth/refresh` endpoint.
- **No current-user awareness** — `req.user` carries the decoded JWT payload but it is never used in any generated handler. There is no "get my profile" endpoint or user-scoped query.
- **No session management** — stateless JWT only; no revocation, blacklist, or logout mechanism.

### 2.2 Authorization

- **No ownership enforcement** — any authenticated user can `DELETE /api/posts/:id` even if they didn't create the post. There is no `WHERE authorId = req.user.id` guard anywhere.
- **No role-based access control** — `Role` enum fields (e.g., `USER`, `ADMIN`) are stored and returned but never checked in any middleware or handler.
- **No field-level visibility** — you cannot say "return `email` only to admins"; all non-hidden fields are always returned to any caller.

### 2.3 Relation Handling

- **No nested writes** — you cannot create a Post and connect Tags in one request. Foreign keys must be provided as plain ID strings; the client is responsible for creating related records separately.
- **No nested routes** — there are no `/api/posts/:postId/comments` endpoints. Relation filtering is done via `?filter[postId]=abc`, which requires the client to know the ID.
- **No many-to-many management** — joining Post and Tag via an implicit join table requires separate operations; there is no dedicated endpoint for it.
- **No relation-level includes with pagination** — `?include=comments` loads *all* comments for a post, not a paginated subset.

### 2.4 Filtering

The `?filter[field]=value` system only supports exact and substring matching:

| Filter need | Supported? |
|-------------|------------|
| Exact match (number, boolean) | ✅ |
| Case-insensitive contains (string, PostgreSQL/MySQL) | ✅ |
| Range: `createdAt >= date` | ❌ |
| Multi-value / IN: `status IN [DRAFT, PUBLISHED]` | ❌ |
| Null check: `deletedAt IS NULL` | ❌ |
| Relation traversal: `author.role = ADMIN` | ❌ |
| Enum validation before Prisma query | ❌ |

### 2.5 Data Lifecycle

- **No soft delete** — `DELETE` is always a hard `prisma.delete()`. If FK constraints exist without `onDelete: Cascade`, deleting a parent record (e.g., a User with Posts) will throw a Prisma error.
- **No audit log** — no record of who created, modified, or deleted any record, or when.
- **No optimistic concurrency** — no `version` field or `ETag` header support to detect concurrent modifications.

### 2.6 Input Validation

- **No string length limits** — `content: z.string()` accepts a 10MB string (the body size limit). There is no `z.string().max(N)`.
- **No format validation** — `email String` becomes `z.string()`, not `z.string().email()`. Invalid email formats are accepted.
- **No enum validation in filters** — `?filter[status]=INVALID` will pass through to Prisma, which will return an empty result rather than a 400 error.

### 2.7 Testing and Seeding

- **Minimal seed coverage** — `prisma/seed.ts` inserts 5 records per model using `@faker-js/faker` with dependency-aware ordering (parent tables first). It covers basic data population but not complex business scenarios or many-to-many join tables.
- **No test isolation** — the generated test files import and use the live Express app with no test database setup or teardown.
- **No lifecycle tests** — only a GET list test and a GET 404 test are generated. There are no create/update/delete tests.

---

## 3. Architectural Limitations

### 3.1 Offset-Only Pagination

All list endpoints use `SKIP + TAKE` (offset pagination). On tables with millions of rows or frequent inserts, this has two problems:
1. Deep pages (`page=5000`) require the database to scan and discard thousands of rows.
2. Items inserted between page fetches cause records to appear on multiple pages or be skipped entirely.

Cursor-based pagination (using the last seen `id` as a bookmark) is not generated.

### 3.2 No API Versioning

All routes are mounted at `/api/{model}` with no version prefix. There is no `/api/v1/` support and no `Accept-Version` header handling. Breaking schema changes require clients to update immediately.

### 3.3 Single Database

Only one Prisma datasource is supported. You cannot mix a primary PostgreSQL database with Redis for caching, a separate read replica, or a secondary data store.

### 3.4 No Caching

Every request hits the database. There are no:
- `Cache-Control` or `ETag` headers on responses
- In-memory caches (e.g., Redis) for frequently-read data
- Query result memoization

### 3.5 No Event System

There are no lifecycle hooks. Nothing happens when a record is created, updated, or deleted. Side-effects like sending emails, firing webhooks, updating denormalized counters, or writing audit logs must be added manually to each service.

### 3.6 Monolithic Structure

All models are generated into a single Express application. There is no support for splitting models across microservices, separate domains, or independently deployable modules.

### 3.7 Parser Stability

The parser uses `@mrleebo/prisma-ast`, a community-maintained package with a documented AST API. It is not an official Prisma package, so there is a small risk of the AST format diverging on a future Prisma major version upgrade. Unlike the previous architecture, breakage is immediately visible as a hard error — not a silent fallback.

### 3.8 No Incremental Regeneration

The CLI always regenerates every file in the requested category from scratch. There is no diffing, no merge strategy, and no way to protect hand-edited sections of generated files from being overwritten. The `--only` flag limits *which categories* are regenerated, but within a category, all files are replaced unconditionally.

---

## 4. Where It Can Be Improved

### 4.1 Near-Term (No New Directives Required)

**Format-aware Zod validators**
Detect common field name patterns and emit specific validators:
```typescript
// Schema has:  email String @unique
// Currently:   email: z.string(),
// Should emit: email: z.string().email(),

// avatarUrl String?
// Should emit: avatarUrl: z.string().url().optional(),
```

**Database length constraints → Zod max**
Map `@db.VarChar(255)` (and similar) to `z.string().max(255)`.

**Full lifecycle tests**
Generate a complete test suite per model:
1. `POST /api/{model}` → verify 201 and body shape
2. `GET /api/{model}/:id` → verify the created record
3. `PUT /api/{model}/:id` → verify update
4. `DELETE /api/{model}/:id` → verify 204
5. `GET /api/{model}/:id` → verify 404 after delete

With a proper in-memory SQLite or test-database setup/teardown using Prisma's `$transaction` rollback pattern.

**Cascade suggestions**
When the parser detects a `@relation` without `onDelete: Cascade`, emit a comment in the generated schema warning that hard deletes of parent records will fail.

---

### 4.2 Medium-Term (New Directives)

**`@bcm.softDelete`** *(model-level)*
Generate `deletedAt DateTime?` handling:
- `DELETE /:id` → `update({ deletedAt: new Date() })` instead of hard delete
- All `findMany` and `findUnique` calls include `where: { deletedAt: null }`
- New `POST /:id/restore` endpoint sets `deletedAt: null`

**`@bcm.searchable`** *(field-level)*
Generate a `GET /api/{model}/search?q=term` endpoint using Prisma's full-text `search` mode on marked fields.

**`@bcm.auth(roles: [...])` ** *(model or field level)*
Role-based access using `req.user.role` from the JWT payload:
```prisma
/// @bcm.auth(roles: [ADMIN])
model AdminConfig { ... }
```

**`@bcm.email`, `@bcm.url`, `@bcm.maxLength(N)`** *(field-level)*
Field-level format and constraint directives that map directly to Zod validators, avoiding the need for heuristic field-name detection.

---

### 4.3 Longer-Term (Architecture)

**Auth module generation**
A dedicated `bcm auth` command that generates:
- `POST /auth/register` — create user + hash password with bcrypt
- `POST /auth/login` — verify password + sign JWT access + refresh tokens
- `POST /auth/refresh` — rotate refresh token
- `POST /auth/logout` — revoke refresh token

**Nested routes from relations**
Automatically generate parent-scoped routes from `@relation` definitions:
```
GET /api/posts/:postId/comments   → comments filtered by postId
POST /api/posts/:postId/comments  → create comment with postId set automatically
```

**Advanced filter syntax**
Extend the query builder to support:
```
?filter[status][in]=DRAFT,PUBLISHED
?filter[createdAt][gte]=2024-01-01
?filter[deletedAt][null]=true
?filter[viewCount][gt]=100
```

**Cursor-based pagination**
Generate an alternative `?cursor=<id>&limit=20` pagination mode that is stable on large datasets.

**Watch mode**
`bcm generate --watch` — re-runs generation when the schema file changes, for a tight development feedback loop.

**Custom template overrides**
A `bcm.config.js` (or `bcm.config.ts`) that lets users override individual EJS templates without forking the CLI:
```js
export default {
  templates: {
    'module/controller.ts.ejs': './my-templates/controller.ts.ejs',
  }
}
```

**Framework flag**
`--framework hono|fastify` to generate the same semantic logic targeting a different HTTP layer.

---

## 5. Conclusion

backgen delivers a correct, type-safe, security-conscious CRUD API skeleton from a Prisma schema in under a second. The generated output is production-deployable on day one — with Docker, CI, structured logging, rate limiting, OpenAPI documentation, and RFC 7807 error handling included.

Its deliberate scope ends at the data layer. Authentication issuance, ownership checks, business rules, advanced queries, and event-driven side-effects are intentionally left for the developer to add. This is the right trade-off for an eject-first tool: generated code should be a correct starting point, not a black box with opinions baked in that are hard to change.

The most impactful near-term improvements are format-aware Zod validators and full lifecycle tests — both achievable without changing the CLI's architecture. The most strategically valuable medium-term addition is a proper auth module command, which would close the largest gap between "running scaffold" and "real application".
