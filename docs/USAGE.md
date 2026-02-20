# Usage Guide

This guide walks you through everything you need to use **Backend Creator (bcm)** — from writing your Prisma schema to running a fully functional REST API.

---

## Table of Contents

1. [Installation](#installation)
2. [Creating a New Project](#creating-a-new-project)
3. [Writing Your Schema](#writing-your-schema)
4. [Generating the Backend](#generating-the-backend)
5. [Running the Generated API](#running-the-generated-api)
6. [Using Directives](#using-directives)
7. [Authentication](#authentication)
8. [API Endpoints](#api-endpoints)
9. [Query Parameters](#query-parameters)
10. [Error Handling](#error-handling)
11. [Ejecting](#ejecting)
12. [Regenerating Specific Parts](#regenerating-specific-parts)
13. [Docker Deployment](#docker-deployment)

---

## Installation

```bash
# Install globally
npm install -g backend-creator

# Verify installation
bcm --version
bcm --help
```

Or run directly with `npx`:

```bash
npx backend-creator generate --schema ./schema.prisma --output ./my-api
```

---

## Creating a New Project

The `init` command creates a new project directory with starter files:

```bash
bcm init my-api
```

This creates:

```
my-api/
├── prisma/
│   └── schema.prisma    ← starter schema with example User model
├── src/                  ← empty, will be populated by `generate`
├── package.json
├── tsconfig.json
└── .gitignore
```

The starter schema includes a `User` model with example `@bcm` directives to get you started.

---

## Writing Your Schema

Edit `prisma/schema.prisma` using standard Prisma syntax. Add `@bcm.*` directives as triple-slash comments to control API behavior.

### Example: Blog API

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  USER
  ADMIN
  MODERATOR
}

enum PostStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

/// @bcm.authModel
model User {
  id        String   @id @default(cuid())
  /// @bcm.identifier
  email     String   @unique
  name      String
  /// @bcm.password
  password  String
  role      Role     @default(USER)
  bio       String?
  avatarUrl String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  posts    Post[]
  comments Comment[]
  profile  Profile?
}

model Post {
  id        String     @id @default(cuid())
  title     String
  slug      String     @unique
  content   String
  excerpt   String?
  status    PostStatus @default(DRAFT)
  /// @bcm.readonly
  viewCount Int        @default(0)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  authorId String
  author   User   @relation(fields: [authorId], references: [id])

  comments Comment[]
  tags     Tag[]
}
```

### Schema Requirements

- Must include a `datasource` block
- Must include a `generator client` block
- Each model should have an `@id` field
- Relations are detected automatically (not included in DTOs)

---

## Generating the Backend

### Basic Usage

```bash
bcm generate --schema ./prisma/schema.prisma --output ./my-api
```

### Dry Run (Preview)

See what files would be generated without writing anything:

```bash
bcm generate --schema ./schema.prisma --output ./out --dry-run
```

Output:

```
📋 Dry run — files that would be generated:

  • src/app.ts (1.2 KB)
  • src/server.ts (0.8 KB)
  • src/modules/user/user.dto.ts (1.5 KB)
  • src/modules/user/user.controller.ts (2.1 KB)
  ...

  Total: 49 files
  Run without --dry-run to write files.
```

### Overwrite Existing Output

```bash
bcm generate --schema ./schema.prisma --output ./my-api --force
```

### Generate from Existing Schema

If you already have a Prisma schema (not from `bcm init`), just point to it:

```bash
bcm generate --schema ~/projects/existing-app/prisma/schema.prisma --output ./new-api
```

---

## Running the Generated API

After generating, follow these steps:

```bash
# 1. Enter the project
cd my-api

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
```

Edit `.env` with your values:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/my_api?schema=public"
JWT_SECRET="your-secret-key-at-least-32-characters-long"
```

```bash
# 4. Run Prisma migration
npx prisma migrate dev --name init

# 5. Start development server
npm run dev
```

The API will be available at `http://localhost:3000`.

### Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Dev | `npm run dev` | Start with hot-reload (tsx) |
| Build | `npm run build` | Compile TypeScript |
| Start | `npm start` | Run production build |
| Test | `npm test` | Run tests with Jest |
| Migrate | `npm run migrate` | Run Prisma migrations |
| Seed | `npm run seed` | Seed the database |
| Studio | `npm run studio` | Open Prisma Studio GUI |

---

## Using Directives

Directives are applied as `/// @bcm.*` comments directly above a field in your Prisma schema.

### `@bcm.writeOnly`

The field is accepted in create and update requests but **never returned** in responses.

**Use case**: Internal tokens, secrets. For passwords specifically, prefer `@bcm.password` (see below) which also generates a login endpoint.

```prisma
model User {
  /// @bcm.writeOnly
  apiToken String
}
```

- `POST /api/users` → `apiToken` is **accepted** in request body
- `GET /api/users/:id` → `apiToken` is **excluded** from response

### `@bcm.readonly`

The field is **excluded** from create and update schemas but **included** in responses.

**Use case**: Auto-incremented counters, computed fields, server-managed timestamps.

```prisma
model Post {
  /// @bcm.readonly
  viewCount Int @default(0)
}
```

- `POST /api/posts` → `viewCount` is **not** in the request body
- `GET /api/posts/:id` → `viewCount` is **included** in the response

### `@bcm.hidden`

The field is **excluded** from all API input and output. It exists in the database but is invisible to the API.

**Use case**: Internal flags, audit columns.

```prisma
model User {
  /// @bcm.hidden
  internalNotes String?
}
```

- Not in request body
- Not in response body
- Only accessible via Prisma directly

### `@bcm.searchable`

The field is included in full-text search when using the `?search=term` query parameter.

**Use case**: Titles, names, descriptions — any text field users should be able to search.

```prisma
model Post {
  /// @bcm.searchable
  title   String
  /// @bcm.searchable
  content String?
}
```

- `GET /api/posts?search=hello` → searches `title` and `content` with case-insensitive `contains`
- Multiple searchable fields are combined with OR logic

### `@bcm.nested` (field-level)

Enables nested create/connect operations for a relation field. Place on a single relation field (not list relations).

**Use case**: Creating or linking related records in a single API call.

```prisma
model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
  /// @bcm.nested
  author   User   @relation(fields: [authorId], references: [id])
}
```

This generates a Zod input schema that accepts either `create` or `connect`:

```typescript
const Post_AuthorInput = z.object({
  create: z.object({ email: z.string(), name: z.string() }).optional(),
  connect: z.object({ id: z.string() }).optional(),
}).refine(data => data.create || data.connect, {
  message: 'Either create or connect must be provided',
});
```

API usage:

```json
// Connect to existing user
POST /api/posts
{ "title": "My Post", "author": { "connect": { "id": "user-123" } } }

// Create user inline
POST /api/posts
{ "title": "My Post", "author": { "create": { "email": "new@example.com", "name": "Jane" } } }
```

**Notes**:
- Only single relations are supported (not list relations like `Post[]`)
- The FK field (`authorId`) is automatically excluded from the create schema when `@bcm.nested` is used
- Nested responses auto-include the related record

### `@bcm.identifier` (field-level)

Marks the login credential field (e.g., email, username) on an `@bcm.authModel` model. Must be unique in the database.

```prisma
/// @bcm.authModel
model User {
  id    String @id @default(uuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
}
```

- Only meaningful when on a model also marked `@bcm.authModel`
- The value of this field is included in the generated JWT payload

### `@bcm.password` (field-level)

Marks the password field on an `@bcm.authModel` model. Implies `@bcm.writeOnly` — the field is accepted on create/update but **never** returned in responses.

```prisma
/// @bcm.authModel
model User {
  id    String @id @default(uuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
}
```

- Automatically excluded from all GET responses without needing `@bcm.writeOnly`
- Cannot be combined with `@bcm.hidden`, `@bcm.readonly`, or `@bcm.writeOnly` (conflicting directives produce a warning)

### `@bcm.authModel` (model-level)

Designates this model as the authentication source. Generates a `POST /api/auth/login` endpoint. Must be combined with `@bcm.identifier` and `@bcm.password` field directives on the same model.

```prisma
/// @bcm.authModel
model User {
  id       String @id @default(uuid())
  /// @bcm.identifier
  email    String @unique
  name     String
  /// @bcm.password
  password String
  role     Role   @default(USER)
}
```

**Generated endpoint:**

```
POST /api/auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "secret" }
```

**Success response (200):**

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error response (401):**

```json
{
  "type": "unauthorized",
  "title": "Invalid credentials",
  "status": 401,
  "detail": "Invalid email or password."
}
```

**Notes:**
- Only one `@bcm.authModel` per schema is supported
- The generated file is `src/modules/auth/auth.routes.ts`
- The endpoint is documented in the Swagger spec under the `Auth` tag
- JWT expires in 7 days; payload includes `id` and the identifier field value

### `@bcm.protected` (model-level)

Place this directive on the line immediately before the `model` keyword. Mutation routes (POST, PUT, PATCH, DELETE) require a valid JWT token. GET routes remain public.

```prisma
/// @bcm.protected
model Post {
  id    String @id @default(cuid())
  title String
}
```

### `@bcm.auth(roles: [...])` (model-level)

Like `@bcm.protected`, but also enforces role-based access control. The JWT payload must include a `role` field matching one of the specified roles.

```prisma
/// @bcm.auth(roles: [ADMIN])
model AdminSettings {
  id    String @id @default(uuid())
  key   String @unique
  value String
}

/// @bcm.auth(roles: [ADMIN, MODERATOR])
model Report {
  id    String @id @default(uuid())
  title String
}
```

- GET routes remain public
- POST, PUT, PATCH, DELETE require a valid JWT **and** one of the listed roles
- Returns `401 Unauthorized` if no valid JWT is present
- Returns `403 Forbidden` if the user's role is not in the allowed list
- The generated `authorize()` middleware reads `req.user.role` from the decoded JWT

### `@bcm.softDelete` (model-level)

Enables soft delete for the model. The `DELETE` endpoint sets a `deletedAt` timestamp instead of permanently removing the record. All queries automatically filter out soft-deleted records.

**Requires**: A `deletedAt DateTime?` field on the model.

```prisma
/// @bcm.softDelete
model Post {
  id        String    @id @default(cuid())
  title     String
  deletedAt DateTime?
}
```

- `DELETE /api/posts/:id` → sets `deletedAt = new Date()` instead of hard delete
- `GET /api/posts` → only returns records where `deletedAt` is null
- `GET /api/posts/:id` → returns 404 for soft-deleted records

---

## Authentication

Backend Creator generates a complete authentication flow from three directives in your schema.

### Setup

```prisma
/// @bcm.authModel
model User {
  id       String @id @default(uuid())
  /// @bcm.identifier
  email    String @unique
  name     String
  /// @bcm.password
  password String
  role     Role   @default(USER)
}

/// @bcm.protected
model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
}
```

### Step-by-step flow

**1. Create a user**

```bash
POST /api/users
{ "email": "alice@example.com", "name": "Alice", "password": "secret123" }
```

Response — note that `password` is never returned:

```json
{ "data": { "id": "...", "email": "alice@example.com", "name": "Alice", "role": "USER" } }
```

**2. Log in**

```bash
POST /api/auth/login
{ "email": "alice@example.com", "password": "secret123" }
```

Response:

```json
{ "data": { "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } }
```

**3. Use the token**

Include the JWT in the `Authorization` header for protected endpoints:

```bash
POST /api/posts
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
{ "title": "My First Post", "authorId": "..." }
```

**4. Test in Swagger UI**

1. Open [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
2. Call `POST /api/auth/login` and copy the `token` value
3. Click the **Authorize** button (top right)
4. Enter `Bearer <token>` and click **Authorize**
5. All subsequent calls from Swagger UI will include the token

### Role-based access control

Combine `@bcm.authModel` with `@bcm.auth(roles: [...])` for fine-grained access:

```prisma
/// @bcm.authModel
model User {
  id       String @id @default(uuid())
  /// @bcm.identifier
  email    String @unique
  /// @bcm.password
  password String
  role     Role   @default(USER)
}

/// @bcm.auth(roles: [ADMIN])
model AdminSettings {
  id    String @id @default(uuid())
  key   String @unique
  value String
}
```

The JWT payload includes the `role` field. The `authorize()` middleware checks `req.user.role` against the allowed list and returns `403 Forbidden` if the user's role is not permitted.

---

## API Endpoints

Each model gets 6 REST endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/{models}` | List with pagination, filtering, sorting |
| `GET` | `/api/{models}/:id` | Get a single record by ID |
| `POST` | `/api/{models}` | Create a new record |
| `PUT` | `/api/{models}/:id` | Full update (all required fields) |
| `PATCH` | `/api/{models}/:id` | Partial update (only provided fields) |
| `DELETE` | `/api/{models}/:id` | Delete a record |

The endpoint name is the **camelCase, pluralized** version of the model name:

| Model | Endpoints |
|-------|-----------|
| `User` | `/api/users` |
| `BlogPost` | `/api/blogPosts` |
| `Category` | `/api/categories` |

### Additional Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check with uptime and timestamp |
| `GET /api/docs` | Swagger UI with interactive API documentation |
| `POST /api/auth/login` | Login and receive a JWT token (generated when `@bcm.authModel` is used) |

---

## Query Parameters

The List endpoint supports pagination, sorting, filtering, and relation includes:

### Pagination

```
GET /api/users?page=2&limit=20
```

- `page` — Page number (default: `1`)
- `limit` — Items per page (default: `20`, max: `100`)

Response includes pagination metadata:

```json
{
  "data": [...],
  "meta": {
    "page": 2,
    "limit": 20,
    "total": 143,
    "totalPages": 8
  }
}
```

### Sorting

```
GET /api/posts?sort=createdAt&order=desc
```

- `sort` — Field name to sort by (default: `id`); validated against allowed fields
- `order` — `asc` or `desc` (default: `desc`)

### Filtering

```
GET /api/posts?filter[status]=PUBLISHED&filter[authorId]=abc123
```

Filters are passed as `filter[fieldName]=value`. The query builder auto-detects value types:
- Numbers → exact match
- Booleans (`true`/`false`) → exact match
- Strings → case-insensitive `contains` search

### Searching

```
GET /api/posts?search=hello
```

Searches across all fields marked with `@bcm.searchable` using case-insensitive `contains` matching. Multiple searchable fields are combined with OR logic.

### Including Relations

```
GET /api/posts?include=author,comments
```

Comma-separated relation names to include in the response.

### Combined Example

```
GET /api/posts?page=1&limit=10&sort=createdAt&order=desc&filter[status]=PUBLISHED&include=author
```

---

## Error Handling

All errors follow the [RFC 7807](https://tools.ietf.org/html/rfc7807) Problem Detail format:

```json
{
  "type": "validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "Request validation failed.",
  "instance": "/api/users",
  "errors": [
    {
      "path": "email",
      "message": "Required",
      "code": "invalid_type"
    }
  ]
}
```

### Error Types

| Status | Type | When |
|--------|------|------|
| 401 | `unauthorized` | Missing or invalid JWT token |
| 401 | `token-expired` | JWT token has expired |
| 403 | `forbidden` | User's role is not authorized (`@bcm.auth`) |
| 404 | `not-found` | Record not found by ID |
| 409 | `unique-constraint` | Duplicate value on unique field |
| 422 | `validation-error` | Zod validation failed |
| 422 | `foreign-key-constraint` | Referenced record not found |
| 422 | `null-constraint` | Required field received null |
| 422 | `value-too-long` | Value exceeds column length |
| 429 | `rate-limit-exceeded` | Too many requests |
| 500 | `internal-server-error` | Unexpected server error |

---

## Ejecting

Once you're happy with the generated code and want to remove all traces of `bcm`:

```bash
bcm eject ./my-api
```

This will:
1. Remove all `/// @bcm.*` directive comments from your code
2. Add a `// Bootstrapped with Backend Creator` header
3. Report how many files were modified and directives removed

After ejecting, the project is completely standalone — no dependency on `bcm`.

---

## Regenerating Specific Parts

Use `--only` to regenerate just one section without touching the rest:

```bash
# Regenerate only the API route modules (controllers, services, DTOs, routes, tests)
bcm generate --schema ./schema.prisma --output ./my-api --only routes --force

# Regenerate only the Swagger/OpenAPI spec
bcm generate --schema ./schema.prisma --output ./my-api --only swagger --force

# Regenerate only infrastructure files (Dockerfile, CI, etc.)
bcm generate --schema ./schema.prisma --output ./my-api --only infra --force
```

Available `--only` values:

| Value | Files |
|-------|-------|
| `routes` | Module files (controller, service, DTO, routes, test) per model |
| `config` | Database, CORS, logger, env, Swagger config |
| `middleware` | Auth, error handler, rate limiter, validation |
| `utils` | Query builder, response helpers |
| `app` | `app.ts` and `server.ts` |
| `infra` | Dockerfile, docker-compose, CI, .env.example, .gitignore, README, package.json, tsconfig |
| `prisma` | Cleaned schema copy and seed file |
| `swagger` | `openapi.json` OpenAPI 3.0 spec |

---

## Multi-Database Support

Backend Creator supports multiple database providers via the Prisma `datasource` block. Change the `provider` value to generate provider-aware infrastructure:

```prisma
datasource db {
  provider = "mysql"      // postgresql | mysql | sqlite | mongodb
  url      = env("DATABASE_URL")
}
```

### What changes per provider

| Component | PostgreSQL | MySQL | SQLite | MongoDB |
|-----------|-----------|-------|--------|---------|
| Docker Compose | `postgres:16-alpine` | `mysql:8` | No DB service | `mongo:7` |
| CI service | PostgreSQL service | MySQL service | No service | MongoDB service |
| `.env.example` | `postgresql://...` | `mysql://...` | `file:./dev.db` | `mongodb://...` |
| Migrations | `prisma migrate dev` | `prisma migrate dev` | `prisma migrate dev` | `prisma db push` |
| Case-insensitive search | `mode: 'insensitive'` | `mode: 'insensitive'` | Omitted | Omitted |

### SQLite (simplest setup)

SQLite requires no database service — data is stored in a local file:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

### MongoDB (experimental)

MongoDB uses `prisma db push` instead of migrations and has different relation handling. Some Prisma features may not be available.

```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}
```

---

## Docker Deployment

The generated project includes Docker files ready for production:

```bash
# Start with Docker Compose (app + database)
docker-compose up

# Or build just the app image
docker build -t my-api .
docker run -p 3000:3000 --env-file .env my-api
```

The Docker Compose file is provider-aware — it includes the correct database image and configuration for your chosen provider (PostgreSQL, MySQL, MongoDB, or no service for SQLite).

The Dockerfile uses a multi-stage build:
1. **Build stage** — installs deps, generates Prisma client, compiles TypeScript
2. **Production stage** — runs as non-root user, includes health check

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|:---:|---------|-------------|
| `DATABASE_URL` | ✓ | — | Database connection string (format depends on provider) |
| `JWT_SECRET` | ✓ | — | Secret for JWT signing (min 32 chars) |
| `NODE_ENV` | | `development` | Environment mode |
| `PORT` | | `3000` | Server port |
| `CORS_ORIGIN` | | `*` (dev only) | Allowed CORS origin; must be set in production (disabled if absent) |
| `LOG_LEVEL` | | `info` | Pino log level |
| `JSON_LIMIT` | | `1mb` | Maximum JSON body size |
| `SEED_COUNT` | | `5` | Number of records per model when seeding |
| `SHUTDOWN_TIMEOUT` | | `30000` | Graceful shutdown timeout in milliseconds |
| `RATE_LIMIT_MAX` | | `100` | Max requests per 15-min window |

---

## Web Playground

The web playground lets you paste a Prisma schema and instantly preview all generated code — no installation required.

### Running locally

```bash
cd packages/playground
npm install
npm run dev       # Development server with hot reload
npm run build     # Production build
npm run preview   # Preview production build
```

### How it works

The playground runs 100% client-side:
- **Parser**: `@mrleebo/prisma-ast` (same as the CLI) runs in the browser
- **Templates**: All 27 EJS templates are pre-bundled as strings at build time
- **Generation**: All generators (modules, config, infra, swagger) run in the browser
- **Download**: `jszip` creates a ZIP file with all generated files

### Interface

The playground has three panels:
1. **Schema editor** (left) — Monaco Editor with Prisma syntax highlighting
2. **File tree** (center) — generated file listing grouped by directory
3. **Code preview** (right) — read-only Monaco Editor showing the selected file

Code regenerates automatically as you type (300ms debounce).
