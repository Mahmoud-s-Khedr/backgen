# Backend Creator (bcm)

> Generate a complete, production-ready Express.js REST API from a Prisma schema — in seconds.

**Backend Creator** is a CLI tool that reads your Prisma schema and generates a fully structured Express.js backend with TypeScript, Zod validation, Swagger docs, Docker support, and more. Define your data model once, get a working API instantly.

## Features

- **Full CRUD generation** — 6 REST endpoints per model (List, Get, Create, Update, Patch, Delete)
- **TypeScript end-to-end** — Strongly typed from DTOs to controllers
- **Zod validation** — Schema-aware request validation respecting optionality and defaults
- **Swagger / OpenAPI 3.0** — Auto-generated interactive API documentation
- **Schema directives** — Control API behavior with `@bcm.hidden`, `@bcm.readonly`, `@bcm.writeOnly`, `@bcm.protected`
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
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  /// @bcm.writeOnly
  password  String              // Accept on create/update, never returned in responses
  /// @bcm.readonly
  createdAt DateTime @default(now())  // Returned in responses, excluded from inputs
  /// @bcm.hidden
  internal  String?             // Invisible to the API entirely (inputs and outputs)
}
```

| Directive | Create/Update | Response |
|-----------|:---:|:---:|
| `@bcm.hidden` | ✗ | ✗ |
| `@bcm.readonly` | ✗ | ✓ |
| `@bcm.writeOnly` | ✓ | ✗ |

### Model-level directives

Place model-level directives on the line immediately before the `model` keyword:

```prisma
/// @bcm.protected
model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
}
```

| Directive | Effect |
|-----------|--------|
| `@bcm.protected` | POST / PUT / PATCH / DELETE routes require a valid `Authorization: Bearer <token>` JWT. GET routes remain public. |

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
│   ├── middlewares/       Auth (JWT), error handler, rate limiter, validation
│   ├── modules/           One folder per model:
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
├── docker-compose.yml     App + PostgreSQL
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
| Auth | JWT (jsonwebtoken) |
| Docs | Swagger UI + OpenAPI 3.0 |
| Logging | Pino + pino-http |
| Security | Helmet, CORS, express-rate-limit |
| Testing | Jest + Supertest |
| Infra | Docker, Docker Compose, GitHub Actions CI |

## Requirements

- Node.js ≥ 18
- A valid Prisma schema with `datasource` and `generator` blocks

## License

MIT
