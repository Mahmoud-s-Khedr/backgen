# Backend Creator (bcm)

> Generate a complete, production-ready Express.js REST API from a Prisma schema — in seconds.

**Backend Creator** is a CLI tool that reads your Prisma schema and generates a fully structured Express.js backend with TypeScript, Zod validation, Swagger docs, Docker support, and more. Define your data model once, get a working API instantly.

**Try it online:** [Web Playground](packages/playground/) — paste a schema and preview generated code instantly, no installation required.

## Features

- **Full CRUD generation** — 6 REST endpoints per model (List, Get, Create, Update, Patch, Delete)
- **TypeScript end-to-end** — Strongly typed from DTOs to controllers
- **Zod validation** — Schema-aware request validation respecting optionality and defaults
- **Swagger / OpenAPI 3.0** — Auto-generated interactive API documentation
- **Schema directives** — Control API behavior with `@bcm.hidden`, `@bcm.readonly`, `@bcm.writeOnly`, `@bcm.searchable`, `@bcm.nested`
- **Authentication & RBAC** — `@bcm.protected` for JWT auth, `@bcm.auth(roles: [ADMIN])` for role-based access control, `@bcm.authModel` for a generated login endpoint
- **Nested relations** — `@bcm.nested` enables Prisma nested creates and connects via API
- **Soft delete** — `@bcm.softDelete` for logical deletion with `deletedAt` timestamps
- **Multi-database** — PostgreSQL, MySQL, SQLite, and MongoDB with provider-aware infrastructure
- **RFC 7807 errors** — Standardized error responses with Prisma error mapping
- **Production-ready** — Docker, CI/CD, rate limiting, JWT auth middleware, structured logging
- **Eject anytime** — Strip all `@bcm` directives and own the code completely

## Quick Start

```bash
# Install globally
npm install -g backend-creator

# Option A: Start from scratch
bcm init my-api
cd my-api
# Edit prisma/schema.prisma with your models
bcm generate --schema ./prisma/schema.prisma --output . --force

# Option B: Use an existing Prisma schema
bcm generate --schema ./schema.prisma --output ./my-api
```

Then run the generated API:

```bash
cd my-api
npm install
cp .env.example .env        # Edit with your DATABASE_URL
npx prisma migrate dev --name init
npm run seed                 # Optional: populate DB with fake data
npm run dev                  # http://localhost:3000
```

Swagger docs → [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

## Directives

### Field-level directives

Add `@bcm.*` directives as triple-slash comments immediately above a Prisma field:

```prisma
/// @bcm.authModel
model User {
  id        String   @id @default(cuid())
  /// @bcm.identifier
  email     String   @unique         // Used as login credential
  name      String
  /// @bcm.password
  password  String                   // Accepted on write, never returned in responses
  /// @bcm.readonly
  createdAt DateTime @default(now()) // Returned in responses, excluded from inputs
  /// @bcm.hidden
  internal  String?                  // Invisible to the API entirely
}
```

| Directive | Create/Update | Response | Notes |
|-----------|:---:|:---:|-------|
| `@bcm.hidden` | ✗ | ✗ | Invisible to the API entirely |
| `@bcm.readonly` | ✗ | ✓ | Excluded from inputs, included in responses |
| `@bcm.writeOnly` | ✓ | ✗ | Accepted on write, never returned |
| `@bcm.searchable` | ✓ | ✓ | Included in `?search=term` full-text search |
| `@bcm.nested` | ✓ | ✓ | Enable nested create/connect for relation fields |
| `@bcm.identifier` | ✓ | ✓ | Marks the login credential field (email, username) — used with `@bcm.authModel` |
| `@bcm.password` | ✓ | ✗ | Marks the password field; implies `writeOnly` — used with `@bcm.authModel` |

### Model-level directives

Place model-level directives on the line immediately before the `model` keyword:

```prisma
/// @bcm.protected
model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
}

/// @bcm.auth(roles: [ADMIN])
model AdminSettings {
  id    String @id @default(uuid())
  key   String @unique
  value String
}
```

| Directive | Effect |
|-----------|--------|
| `@bcm.authModel` | Designates this model as the authentication source. Generates a `POST /api/auth/login` endpoint that returns a JWT. Requires `@bcm.identifier` and `@bcm.password` fields on the same model. |
| `@bcm.protected` | Mutation routes (POST, PUT, PATCH, DELETE) require a valid JWT. GET routes remain public. |
| `@bcm.auth(roles: [ADMIN])` | Like `@bcm.protected`, but mutations also require the JWT to contain one of the specified roles. |
| `@bcm.softDelete` | DELETE sets `deletedAt` timestamp instead of hard delete. All queries filter out soft-deleted records. Requires `deletedAt DateTime?` field. |

### Authentication Flow

Use `@bcm.authModel`, `@bcm.identifier`, and `@bcm.password` together to generate a complete login endpoint:

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

This generates:
- `POST /api/auth/login` — accepts `{ email, password }`, returns `{ data: { token } }`
- The JWT token can then be used in `Authorization: Bearer <token>` headers to access `@bcm.protected` routes
- `password` is automatically excluded from all GET responses (implies `@bcm.writeOnly`)
- The login endpoint is documented in the auto-generated Swagger spec with a working "Authorize" button

**Testing the auth flow:**
1. `POST /api/users` — create a user (password accepted, never returned)
2. `POST /api/auth/login { "email": "...", "password": "..." }` — get a JWT token
3. Click **Authorize** in Swagger UI → paste the token
4. `POST /api/posts` — now succeeds with a 201 response

### Nested Relations

Use `@bcm.nested` on a relation field to allow nested create/connect operations:

```prisma
model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
  /// @bcm.nested
  author   User   @relation(fields: [authorId], references: [id])
}
```

This enables API requests like:

```json
POST /api/posts
{
  "title": "My Post",
  "author": { "connect": { "id": "user-123" } }
}
// OR
{
  "title": "My Post",
  "author": { "create": { "email": "new@example.com", "name": "New User" } }
}
```

## Multi-Database Support

Set the `provider` in your Prisma schema to target different databases:

```prisma
datasource db {
  provider = "mysql"      // postgresql | mysql | sqlite | mongodb
  url      = env("DATABASE_URL")
}
```

The generator produces provider-aware infrastructure:
- **Docker Compose** — correct database image and configuration
- **CI pipeline** — matching database service for GitHub Actions
- **Environment** — correct `DATABASE_URL` format in `.env.example`
- **Query builder** — `mode: 'insensitive'` only for providers that support it

## Commands

| Command | Description |
|---------|-------------|
| `bcm init <name>` | Scaffold a new project with starter files and example schema |
| `bcm generate` | Generate backend from a Prisma schema |
| `bcm eject <path>` | Strip `@bcm` directives — project becomes fully independent |

### Generate Options

```
bcm generate --schema <path> --output <path> [options]

Required:
  -s, --schema <path>   Path to .prisma schema file
  -o, --output <path>   Output directory

Options:
  --dry-run             Preview files without writing
  --only <part>         Generate a specific part only
                        (routes, config, middleware, utils, app, infra, prisma, swagger)
  --force               Overwrite existing output directory
```

## Generated Project Structure

```
my-api/
├── src/
│   ├── config/           Database, CORS, logger, env validation, Swagger
│   ├── middlewares/       Auth (JWT + RBAC), error handler, rate limiter, validation
│   ├── modules/           One folder per model + optional auth:
│   │   ├── auth/
│   │   │   └── auth.routes.ts  (generated when @bcm.authModel is used)
│   │   └── user/
│   │       ├── user.controller.ts
│   │       ├── user.service.ts
│   │       ├── user.routes.ts
│   │       ├── user.dto.ts     (Zod schemas)
│   │       └── user.test.ts
│   ├── utils/             Query builder, response helpers
│   ├── app.ts
│   └── server.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts            Faker-based seed script (npm run seed)
├── openapi.json           Auto-generated OpenAPI spec
├── Dockerfile             Multi-stage production build
├── docker-compose.yml     App + database (provider-aware)
├── .github/workflows/ci.yml
├── .env.example
├── package.json
└── tsconfig.json
```

## Tech Stack (Generated)

| Layer | Technology |
|-------|-----------|
| Runtime | Express.js, TypeScript, Prisma ORM |
| Validation | Zod |
| Auth | JWT (jsonwebtoken) + role-based authorization |
| Docs | Swagger UI + OpenAPI 3.0 |
| Logging | Pino + pino-http |
| Security | Helmet, CORS, express-rate-limit, compression |
| Testing | Jest + Supertest |
| Infra | Docker, Docker Compose, GitHub Actions CI |
| Database | PostgreSQL, MySQL, SQLite, or MongoDB via Prisma |

## Web Playground

The [web playground](packages/playground/) lets you paste a Prisma schema and instantly preview all generated files in the browser — no installation needed.

```bash
cd packages/playground
npm install
npm run dev
```

Features:
- Monaco editor with Prisma syntax highlighting
- Live code generation as you type
- File tree with full project structure preview
- Download all generated files as ZIP

## Examples

See the [examples/](examples/) directory for 10 example schemas ranging from simple (todo list) to complex (hospital management), demonstrating all directives and features.

## Requirements

- Node.js >= 18
- A valid Prisma schema with `datasource` and `generator` blocks

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, conventions, and how to submit pull requests.

## License

MIT — see [LICENSE](LICENSE) for details.
