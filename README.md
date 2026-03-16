# Backgen

> Generate a production-ready REST API backend from a Prisma schema and `/// @bcm.*` directives.

[![npm](https://img.shields.io/npm/v/prisma-backgen)](https://www.npmjs.com/package/prisma-backgen)
[![CI](https://github.com/Mahmoud-s-Khedr/backgen/actions/workflows/ci.yml/badge.svg)](https://github.com/Mahmoud-s-Khedr/backgen/actions/workflows/ci.yml)
[![Playground CI](https://github.com/Mahmoud-s-Khedr/backgen/actions/workflows/playground.yml/badge.svg)](https://github.com/Mahmoud-s-Khedr/backgen/actions/workflows/playground.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](package.json)

Backgen turns a Prisma schema into a structured Express or Fastify codebase with controllers, services, repositories, DTOs, route tests, repository unit tests, OpenAPI output, Postman collection export, background job scaffolding (BullMQ or pg-boss), real-time WebSocket support, and deployable infra files.

## Why Backgen

- Generates CRUD modules from Prisma models, including selector-aware item routes for `@id`, `@@id`, `@unique`, and `@@unique`.
- Uses schema directives to control auth, RBAC, soft delete, caching, uploads, searchable fields, and nested relation inputs.
- Produces route tests and repository unit tests that mock Prisma delegates, so generated `pnpm test` does not require a database.
- Exports a Postman Collection v2.1 JSON importable by Postman, Insomnia, Thunder Client, or Bruno.
- Ships a CLI-backed playground package that uses the same generation pipeline as the published CLI.

## Quick Start

```bash
pnpm add -g prisma-backgen

bcm init my-api
cd my-api

# edit prisma/schema.prisma
bcm validate --schema ./prisma/schema.prisma
bcm generate --schema ./prisma/schema.prisma --output . --force

pnpm install
cp .env.example .env
pnpm exec prisma migrate dev --name init
pnpm dev
```

Use `--framework fastify` to target Fastify instead of the default Express output. Add `--jobs bullmq` or `--jobs pg-boss` for background job scaffolding. Add `--ws` for real-time WebSocket support (models with `@bcm.ws` broadcast mutations to subscribers).

## Canonical Example Schema

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
}

/// @bcm.authModel
model User {
  id        String   @id @default(cuid())
  /// @bcm.identifier
  email     String   @unique
  /// @bcm.password
  password  String
  role      Role     @default(USER)
  posts     Post[]
  /// @bcm.readonly
  createdAt DateTime @default(now())
}

/// @bcm.protected
/// @bcm.softDelete
/// @bcm.cache(ttl: 300)
model Post {
  id        String    @id @default(cuid())
  /// @bcm.searchable
  title     String
  content   String?
  /// @bcm.hidden
  authorId  String
  /// @bcm.nested
  author    User      @relation(fields: [authorId], references: [id])
  deletedAt DateTime?
  /// @bcm.readonly
  createdAt DateTime  @default(now())
}
```

## Generated API Snapshot

For the schema above, Backgen emits routes under `/api/v1` plus shared service endpoints:

- `GET /api/v1/posts`
- `POST /api/v1/posts`
- `GET /api/v1/posts/{id}`
- `PUT /api/v1/posts/{id}`
- `PATCH /api/v1/posts/{id}`
- `DELETE /api/v1/posts/{id}`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /health`
- Swagger UI at `/api/docs`

Generated auth uses access tokens plus refresh-token rotation when an `@bcm.authModel` is present. `ACCESS_TOKEN_TTL` defaults to `15m`, and Redis is required for auth sessions, `@bcm.cache`, and `--jobs bullmq`.

## Output Snapshot

```text
src/
  app.ts
  server.ts
  config/
  middlewares/
  modules/
    auth/
    user/
    post/
  jobs/          # when --jobs is used
  ws/            # when --ws is used
  utils/
prisma/
  seed.ts
openapi.json
postman-collection.json
Dockerfile
docker-compose.yml
.env.example
README.md
package.json
```

## Documentation

- [Documentation Hub](docs/README.md)
- [Usage Guide](docs/USAGE.md)
- [Directive Reference](docs/directives.md)
- [Advanced Patterns](docs/advanced.md)
- [Limitations](docs/limitations.md)
- [Generated Code Walkthrough](docs/generated-code.md)
- [Architecture Guide](docs/architecture.md)
- [Playground README](packages/playground/README.md)

## Playground

The local playground is a separate package that shells out to the real CLI in `--dry-run --json` mode.

```bash
pnpm install --frozen-lockfile
pnpm run build
cd packages/playground
pnpm install --frozen-lockfile
pnpm dev
```

It serves the monolithic playground at `http://localhost:4173`.

## License

MIT
