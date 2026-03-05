# prisma-backgen — Usage Guide

Generate a complete, production-ready Express.js REST API from a Prisma schema file.

---

## Installation

```bash
# Global install (recommended)
npm install -g prisma-backgen
bcm --version

# One-off with npx (no install needed)
npx prisma-backgen generate --schema ./prisma/schema.prisma --output ./backend
```

---

## Quick Start

```bash
# 1. Scaffold a new project
bcm init my-api
cd my-api

# 2. Edit your schema
#    Open prisma/schema.prisma and define your models with @bcm.* directives
#    (see Directive Reference below)

# 3. Generate the backend
bcm generate --schema ./prisma/schema.prisma --output .

# 4. Install deps and run
npm install
npx prisma migrate dev --name init
npm run dev
```

The generated project starts on `http://localhost:3000`.
Swagger UI is available at `http://localhost:3000/api-docs`.

---

## CLI Reference

### `bcm init <project-name>`

Scaffold a new project directory with a starter Prisma schema, `tsconfig.json`, and `package.json`.

```bash
bcm init my-api
```

Creates:
- `prisma/schema.prisma` — starter schema with a `User` model and directive examples
- `src/` — empty source directory
- `package.json`, `tsconfig.json`, `.gitignore`

> The directory must not already exist.

---

### `bcm generate`

Generate a full Express API from a Prisma schema.

```bash
bcm generate --schema <path> --output <path> [options]
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--schema <path>` | `-s` | Path to Prisma schema file | required |
| `--output <path>` | `-o` | Output directory for generated code | required |
| `--dry-run` | | Preview files without writing anything | `false` |
| `--force` | | Overwrite existing output directory | `false` |
| `--only <part>` | | Generate only one part of the output | — |
| `--json` | | Machine-readable JSON output | `false` |

**`--only` accepted values:** `routes`, `config`, `middleware`, `utils`, `app`, `infra`, `prisma`, `swagger`

**Conflict safety with `--only`:** Without `--force`, `--only` aborts if the targeted file already exists with different content. This prevents accidental overwrites during partial regeneration. Use `--force` to overwrite.

**`--json` output format:**
```json
{
  "success": true,
  "files": ["src/user/user.routes.ts", "..."],
  "models": 3,
  "enums": 1,
  "endpoints": 18
}
```

---

### `bcm eject <path>`

Strip all `/// @bcm.*` directive comments from generated files, producing clean output with no dependency on the CLI.

```bash
bcm eject ./backend/src
```

---

## Directive Reference

Directives are triple-slash comments (`///`) placed on the line immediately before a model or field definition in your Prisma schema.

### Model-level directives

Place these on the line directly before `model ModelName {`:

| Directive | Effect |
|-----------|--------|
| `/// @bcm.protected` | All mutation routes (`POST`, `PUT`, `PATCH`, `DELETE`) require a valid JWT |
| `/// @bcm.auth(roles: [ROLE1, ROLE2])` | Mutations require JWT + role check via `authorize()` middleware |
| `/// @bcm.softDelete` | `DELETE` sets `deletedAt` instead of hard-deleting. Model **must** have a `deletedAt DateTime?` field. |

### Field-level directives

Place these on the line directly before the field:

| Directive | Effect |
|-----------|--------|
| `/// @bcm.hidden` | Field excluded from all response schemas (never returned to client) |
| `/// @bcm.readonly` | Field excluded from Create/Update DTOs — included in responses only |
| `/// @bcm.writeOnly` | Field included in Create/Update DTOs but excluded from responses |
| `/// @bcm.searchable` | Field included in full-text search (via `?q=` query parameter) |
| `/// @bcm.nested` | Relation field: generates a `Model_RelationInput` union (create or connect) instead of a raw FK id |

### Example schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  /// @bcm.hidden
  password  String
  role      Role     @default(USER)
  posts     Post[]
  createdAt DateTime @default(now())
}

enum Role {
  USER
  ADMIN
}

/// @bcm.auth(roles: [ADMIN, USER])
/// @bcm.softDelete
model Post {
  id        Int       @id @default(autoincrement())
  /// @bcm.searchable
  title     String
  content   String?
  deletedAt DateTime?
  /// @bcm.nested
  author    User      @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime  @default(now())
}
```

---

## Generated Project Structure

Running `bcm generate` produces the following layout:

```
<output>/
├── src/
│   ├── app.ts                          # Express app with middleware chain + request tracing
│   ├── server.ts                       # HTTP server entry point
│   ├── config/
│   │   ├── database.ts                 # Prisma Client singleton
│   │   ├── env.ts                      # Environment variable validation
│   │   ├── cors.ts                     # CORS configuration
│   │   ├── logger.ts                   # pino structured logger
│   │   └── swagger.ts                  # OpenAPI/Swagger UI setup
│   ├── middleware/
│   │   ├── auth.middleware.ts           # JWT verification + role guard (authorize())
│   │   ├── error.middleware.ts          # RFC 7807 Problem Detail error handler
│   │   ├── rate-limit.middleware.ts     # express-rate-limit
│   │   └── validation.middleware.ts     # Zod body/query validation
│   ├── utils/
│   │   ├── response.ts                  # Standard { success, data, meta } response helpers
│   │   └── query-builder.ts             # Pagination, filtering, sorting, search helpers
│   ├── auth/
│   │   └── auth.routes.ts               # POST /auth/login — issues JWT access token
│   └── <Model>/                         # One directory per Prisma model (e.g. user/, post/)
│       ├── <model>.routes.ts            # Express router
│       ├── <model>.controller.ts        # Request/response handling
│       ├── <model>.service.ts           # Prisma queries + business logic
│       ├── <model>.dto.ts               # Zod schemas: CreateSchema, PatchSchema, ResponseSchema
│       └── <model>.test.ts              # Vitest integration tests (mocked Prisma)
├── prisma/
│   └── seed.ts                          # @faker-js/faker seed script (topologically sorted)
├── .env.example                         # Environment variable template
├── docker-compose.yml                   # Database + app services (provider-aware)
├── Dockerfile                           # Multi-stage production image
├── .github/workflows/ci.yml             # GitHub Actions CI (provider-aware)
├── package.json                         # Scripts: dev, build, test, migrate, seed, studio
├── tsconfig.json
└── vitest.config.ts
```

### Generated stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 18 |
| Framework | Express 5 |
| ORM | Prisma |
| Validation | Zod |
| Auth | jsonwebtoken (access token) |
| Logging | pino + pino-http |
| API docs | Swagger UI Express + OpenAPI 3 |
| Tests | Vitest (with globals, mocked Prisma) |
| Compression | compression middleware |
| Rate limiting | express-rate-limit |
| Infra | Docker, GitHub Actions CI |

### Generated endpoints (per model)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/<models>` | List (paginated, filterable, searchable) |
| `POST` | `/api/<models>` | Create |
| `GET` | `/api/<models>/:id` | Get by ID |
| `PUT` | `/api/<models>/:id` | Full update |
| `PATCH` | `/api/<models>/:id` | Partial update |
| `DELETE` | `/api/<models>/:id` | Delete (or soft-delete if `@bcm.softDelete`) |

---

## Database Providers

The provider is auto-detected from `datasource db { provider = "..." }` in your schema.
Supported values and their effect:

| Provider | docker-compose | CI DB service | Notes |
|----------|---------------|---------------|-------|
| `postgresql` | postgres image | `postgres` service | Default; full feature support |
| `mysql` | mysql image | `mysql` service | Full feature support |
| `sqlite` | no DB service | no DB service | `DATABASE_URL=file:./dev.db` |
| `mongodb` | mongo image | `mongodb` service | Relation handling differs from relational providers |

---

## Notes & Limitations

- **Auth**: Generates JWT access-token only. Refresh-token flows are not scaffolded.
- **`@bcm.softDelete`**: Requires a `deletedAt DateTime?` field on the model — generation fails with a clear error if missing.
- **`--only` + `--force`**: Using `--force` with `--only` overwrites the targeted file unconditionally.
- **MongoDB**: Some relational features (`@bcm.nested`, cross-model relations) may behave differently. Test your schema before using in production.
- **Eject**: After ejecting, `@bcm.*` directives are stripped and re-running `bcm generate` will not be able to detect previous directives from comments.
