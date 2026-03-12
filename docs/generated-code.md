# Backgen Generated Code Walkthrough

This page describes the major files Backgen writes and how they fit together in the generated project.

## Project Layout

A full generation produces the following top-level shape:

```text
src/
  app.ts
  server.ts
  config/
  middlewares/
  modules/
  utils/
prisma/
  seed.ts
openapi.json
Dockerfile
docker-compose.yml
.env.example
README.md
package.json
tsconfig.json
vitest.config.ts
```

`openapi.json` is generated directly from the parsed schema and the same selector/nested rules used by the route generator.

## Per-Model Modules

For each model, Backgen writes:

- `<model>.repository.ts`
- `<model>.service.ts`
- `<model>.controller.ts`
- `<model>.routes.ts`
- `<model>.dto.ts`
- `<model>.test.ts`

### Repository

Responsibilities:

- Prisma queries only
- selector-aware `where` building
- include handling
- soft-delete query changes
- nested relation auto-include on create when needed

Selector-aware repositories emit typed key objects for single or composite selectors.

### Service

Responsibilities:

- orchestration over repository methods
- password hashing for auth models
- cache read/write/invalidation when caching is enabled
- 404 surfacing for missing records

### Controller

Responsibilities:

- parse item selector params
- build query options from `page`, `limit`, `sort`, `order`, `filter[...]`, `search`, and `include`
- validate outgoing data against response schemas
- send envelope-style responses

### Routes

Generated routes mount under `/api/v1/<models>`.

Behavior depends on directives:

- `@bcm.protected` adds authentication to mutations
- `@bcm.auth(...)` adds authentication plus `authorize(...)`
- `@bcm.upload(...)` adds upload middleware
- models without selectors get only list/create routes

### DTOs

DTO files contain:

- `Create<Model>Schema`
- `Update<Model>Schema`
- `Patch<Model>Schema`
- `<Model>ResponseSchema`
- `<Model>WithIncludesResponseSchema`
- nested relation input schemas when `@bcm.nested` is present

Current DTO behavior:

- `@bcm.password` implies write-only handling
- `@bcm.hidden` removes fields from generated API input/output schemas
- `@bcm.readonly` excludes fields from create/update input
- `@bcm.nested` removes covered FK fields and generates nested `create` plus optional selector-aware `connect`

### Generated Tests

Generated tests use Vitest and mocked Prisma delegates.

What they validate:

- list/create/get/update/patch/delete route behavior
- validation failures before Prisma is called
- 404 handling
- auth middleware behavior where relevant
- selector-aware item route coverage

The generated test suite does not require a live database.

## Shared Config

Generated config files typically include:

- `src/config/database.ts`
- `src/config/env.ts`
- `src/config/cors.ts`
- `src/config/logger.ts`
- `src/config/swagger.ts`

Conditionally generated:

- `src/config/redis.ts` when an auth model exists or any model uses `@bcm.cache`
- `src/config/upload.ts` when any field uses `@bcm.upload(...)`

Notable environment behavior:

- `JWT_SECRET` is only present when auth is needed
- `ACCESS_TOKEN_TTL` appears only when an auth model exists
- `REDIS_URL` appears for auth refresh sessions and for caching

## App and Auth Files

Backgen always writes:

- `src/app.ts`
- `src/server.ts`

When an auth model has both `@bcm.identifier` and `@bcm.password`, it also writes:

- `src/modules/auth/auth.routes.ts`

Generated auth routes:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Current auth behavior:

- login validates the identifier/password pair
- access tokens are signed with `JWT_SECRET`
- refresh tokens are stored in Redis and rotated on refresh
- role claims are included when the auth model has a scalar `role` field

## Infra and Tooling

Infra output includes:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `.env.example`
- `.github/workflows/ci.yml`
- generated project `README.md`

Tooling output includes:

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `prisma/seed.ts`

Generated package scripts:

- `dev`
- `build`
- `start`
- `test`
- `test:watch`
- `migrate`
- `seed`
- `studio`
- `generate`

## Framework Split

`--framework fastify` swaps the framework-specific templates for:

- app bootstrap
- server bootstrap
- model routes
- auth routes
- middleware
- Swagger setup

The repository/service/controller/DTO layering stays the same.

## Related Docs

- [Usage Guide](USAGE.md)
- [Advanced Patterns](advanced.md)
- [Architecture Guide](architecture.md)
