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
7. [API Endpoints](#api-endpoints)
8. [Query Parameters](#query-parameters)
9. [Error Handling](#error-handling)
10. [Ejecting](#ejecting)
11. [Regenerating Specific Parts](#regenerating-specific-parts)
12. [Docker Deployment](#docker-deployment)

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

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  /// @bcm.writeOnly
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

**Use case**: Passwords, internal tokens, secrets.

```prisma
model User {
  /// @bcm.writeOnly
  password String
}
```

- `POST /api/users` → `password` is **accepted** in request body
- `GET /api/users/:id` → `password` is **excluded** from response

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

**Use case**: Internal flags, soft-delete markers, audit columns.

```prisma
model User {
  /// @bcm.hidden
  internalNotes String?
}
```

- Not in request body
- Not in response body
- Only accessible via Prisma directly

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

- `sort` — Field name to sort by (default: `createdAt`)
- `order` — `asc` or `desc` (default: `desc`)

### Filtering

```
GET /api/posts?filter[status]=PUBLISHED&filter[authorId]=abc123
```

Filters are passed as `filter[fieldName]=value`. The query builder auto-detects value types:
- Numbers → exact match
- Booleans (`true`/`false`) → exact match
- Strings → case-insensitive `contains` search

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
| 404 | `not-found` | Record not found by ID |
| 409 | `unique-constraint` | Duplicate value on unique field |
| 422 | `validation-error` | Zod validation failed |
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

## Docker Deployment

The generated project includes Docker files ready for production:

```bash
# Start with Docker Compose (app + PostgreSQL)
docker-compose up

# Or build just the app image
docker build -t my-api .
docker run -p 3000:3000 --env-file .env my-api
```

The Dockerfile uses a multi-stage build:
1. **Build stage** — installs deps, generates Prisma client, compiles TypeScript
2. **Production stage** — runs as non-root user, includes health check

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|:---:|---------|-------------|
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✓ | — | Secret for JWT signing (min 32 chars) |
| `NODE_ENV` | | `development` | Environment mode |
| `PORT` | | `3000` | Server port |
| `CORS_ORIGIN` | | `*` (dev only) | Allowed CORS origin; must be set in production (disabled if absent) |
| `LOG_LEVEL` | | `info` | Pino log level |
| `RATE_LIMIT_MAX` | | `100` | Max requests per 15-min window |
