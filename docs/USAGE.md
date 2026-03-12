# prisma-backgen Usage Guide

Generate a REST API backend from a Prisma schema with the `bcm` CLI.

## Installation

```bash
# Global install
npm install -g prisma-backgen
bcm --version

# One-off generation without installing globally
npx prisma-backgen generate --schema ./prisma/schema.prisma --output ./backend
```

Node.js `>=18` is required.

## Quick Start

```bash
# 1. Create a starter project
bcm init my-api
cd my-api

# 2. Edit prisma/schema.prisma

# 3. Validate before writing files
bcm validate --schema ./prisma/schema.prisma

# 4. Generate into the current project
bcm generate --schema ./prisma/schema.prisma --output . --force

# 5. Install generated dependencies and run
npm install
cp .env.example .env
npx prisma migrate dev --name init
npm run dev
```

For MongoDB, use `npx prisma db push` instead of `prisma migrate dev`.

## CLI Reference

### `bcm init <project-name>`

Creates a new directory with a starter Prisma schema and minimal project files.

```bash
bcm init my-api
```

Scaffolded files:

- `prisma/schema.prisma`
- `src/`
- `package.json`
- `tsconfig.json`
- `.gitignore`

The target directory must not already exist.

### `bcm generate`

Generates backend code from a Prisma schema.

```bash
bcm generate --schema <path> --output <path> [options]
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--schema <path>` | `-s` | Path to the Prisma schema file | required |
| `--output <path>` | `-o` | Output directory for generated files | required |
| `--dry-run` | | Preview files without writing them | `false` |
| `--only <part>` | | Generate only one category | none |
| `--json` | | Emit machine-readable JSON only | `false` |
| `--force` | | Overwrite targeted output | `false` |
| `--framework <name>` | | `express` or `fastify` | `express` |

Accepted `--only` values:

- `routes`
- `config`
- `middleware`
- `utils`
- `app`
- `infra`
- `prisma`
- `swagger`

Important behavior:

- Full generation into a non-empty directory requires `--force`.
- `--only` without `--force` aborts if any targeted file would be overwritten with different content.
- `--json` includes `endpointCount` only for full generation, not for `--only` runs.

Examples:

```bash
# Full Express generation
bcm generate --schema ./prisma/schema.prisma --output . --force

# Full Fastify generation
bcm generate --schema ./prisma/schema.prisma --output . --force --framework fastify

# Preview without writing
bcm generate --schema ./prisma/schema.prisma --output . --dry-run

# Regenerate only OpenAPI
bcm generate --schema ./prisma/schema.prisma --output . --only swagger --force
```

Success JSON shape:

```json
{
  "success": true,
  "warnings": [],
  "modelCount": 2,
  "enumCount": 1,
  "files": [
    {
      "path": "src/modules/post/post.routes.ts",
      "content": "...",
      "sizeBytes": 2048
    }
  ],
  "generatedAt": "2026-03-12T12:00:00.000Z",
  "endpointCount": 15
}
```

Failure JSON shape:

```json
{
  "success": false,
  "error": {
    "stage": "write",
    "message": "Output directory \".\" is not empty."
  }
}
```

### `bcm validate`

Parses a schema and runs generator validation without writing files.

```bash
bcm validate --schema <path> [--json]
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--schema <path>` | `-s` | Path to the Prisma schema file | required |
| `--json` | | Emit machine-readable JSON only | `false` |

Exit codes:

- `0`: schema is valid
- `1`: one or more validation errors were found

Validation JSON shape:

```json
{
  "valid": false,
  "modelCount": 3,
  "enumCount": 1,
  "errors": [
    {
      "severity": "error",
      "model": "Post",
      "directive": "softDelete",
      "message": "Model \"Post\" uses @bcm.softDelete but is missing field \"deletedAt\". Expected: deletedAt DateTime?"
    }
  ],
  "warnings": []
}
```

Current validation categories:

1. RBAC models using `@bcm.auth(...)` must have an auth model with `@bcm.identifier`, `@bcm.password`, and a scalar `role` field.
2. `@bcm.softDelete` models must declare `deletedAt DateTime?`.
3. Hidden required foreign keys must have a nested input path or be made optional/defaulted.
4. Required `@bcm.readonly` scalar fields are invalid.
5. Models cannot mix required nested and non-nested relation input modes.

### `bcm eject <path>`

Removes `/// @bcm.*` directive comments from generated source code.

```bash
bcm eject ./backend
```

Use this when you want the generated project to be fully independent of the CLI. It is effectively one-way: once directives are stripped, re-running generation cannot recover them from the ejected files.

## Directive Surface

Backgen currently recognizes the following directives.

Model directives:

- `@bcm.protected`
- `@bcm.softDelete`
- `@bcm.auth(roles: [...])`
- `@bcm.authModel`
- `@bcm.cache(ttl: N)`

Field directives:

- `@bcm.hidden`
- `@bcm.readonly`
- `@bcm.writeOnly`
- `@bcm.searchable`
- `@bcm.nested`
- `@bcm.identifier`
- `@bcm.password`
- `@bcm.upload(...)`

See [Directive Reference](directives.md) for exact placement rules and behavior.

## Generated HTTP Surface

Backgen mounts generated model routes under `/api/v1`.

For a model with a unique selector, the generated CRUD surface is:

- `GET /api/v1/<models>`
- `POST /api/v1/<models>`
- `GET /api/v1/<models>/{selector}`
- `PUT /api/v1/<models>/{selector}`
- `PATCH /api/v1/<models>/{selector}`
- `DELETE /api/v1/<models>/{selector}`

Models without any selector (`@id`, `@@id`, `@unique`, `@@unique`) generate only list and create routes.

Shared routes:

- `GET /health`
- Swagger UI at `GET /api/docs`

Auth routes are generated when an `@bcm.authModel` has both `@bcm.identifier` and `@bcm.password`:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Login returns `data.accessToken` and `data.refreshToken`. `ACCESS_TOKEN_TTL` defaults to `15m`.

## Runtime Configuration

The generated `.env.example` reflects the schema and chosen templates.

Always present:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `CORS_ORIGIN`
- `LOG_LEVEL`
- `RATE_LIMIT_MAX`

Conditionally generated:

- `JWT_SECRET` when any model uses `@bcm.authModel`, `@bcm.protected`, or `@bcm.auth(...)`
- `ACCESS_TOKEN_TTL` when an auth model exists
- `REDIS_URL` when an auth model exists or any model uses `@bcm.cache`
- Upload storage variables when any field uses `@bcm.upload(...)`

Operational note:

- Redis/Valkey is required both for auth refresh-token sessions and for `@bcm.cache`.

## Generated Project Snapshot

Common output files:

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

Generated package scripts:

- `npm run dev`
- `npm run build`
- `npm start`
- `npm test`
- `npm run test:watch`
- `npm run migrate`
- `npm run seed`
- `npm run studio`
- `npm run generate`

See [Generated Code Walkthrough](generated-code.md) for file responsibilities.

## Next Reading

- [Directive Reference](directives.md)
- [Advanced Patterns](advanced.md)
- [Limitations](limitations.md)
- [Generated Code Walkthrough](generated-code.md)
