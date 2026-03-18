# prisma-backgen Usage Guide

Generate a REST API backend from a Prisma schema with the `bcm` CLI.

## Installation

```bash
# Global install
pnpm add -g prisma-backgen
bcm --version

# One-off generation without installing globally
pnpm dlx prisma-backgen generate --schema ./prisma/schema.prisma --output ./backend
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
pnpm install
cp .env.example .env
pnpm exec prisma migrate dev --name init
pnpm dev
```

For MongoDB, use `pnpm exec prisma db push` instead of `prisma migrate dev`.

## CLI Reference

Available commands: `init`, `generate`, `add`, `diff`, `validate`, `eject`.

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
| `--jobs <provider>` | | Add background job scaffolding (`bullmq` or `pg-boss`) | none |
| `--ws` | | Add WebSocket support for real-time model events | `false` |

Accepted `--only` values:

- `routes`
- `config`
- `middleware`
- `utils`
- `app`
- `infra`
- `prisma`
- `swagger`
- `api-client`
- `jobs` (requires `--jobs` flag)
- `ws` (requires `--ws` flag)

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

# Export Postman collection
bcm generate --schema ./prisma/schema.prisma --output . --only api-client --force

# Generate with BullMQ background jobs
bcm generate --schema ./prisma/schema.prisma --output . --force --jobs bullmq

# Generate with pg-boss background jobs
bcm generate --schema ./prisma/schema.prisma --output . --force --jobs pg-boss

# Generate with WebSocket support
bcm generate --schema ./prisma/schema.prisma --output . --force --ws
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

### `bcm add <model>`

Generates a module for one schema model without regenerating the full project.

```bash
bcm add <model> --schema <path> --output <path> [options]
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--schema <path>` | `-s` | Path to the Prisma schema file | required |
| `--output <path>` | `-o` | Output directory of an existing generated project | required |
| `--json` | | Emit machine-readable JSON only | `false` |
| `--force` | | Overwrite existing module directory | `false` |
| `--framework <name>` | | `express` or `fastify` | `express` |

Important behavior:

- The target model must exist in the schema.
- Without `--force`, Backgen aborts if the module directory already exists.
- Backgen can refuse `add` when the model needs shared non-module files; in that case it prints required follow-up `bcm generate --only ...` commands.

Examples:

```bash
# Add a Comment module
bcm add Comment --schema ./prisma/schema.prisma --output .

# Force overwrite existing module files
bcm add Comment --schema ./prisma/schema.prisma --output . --force
```

Success JSON shape:

```json
{
  "success": true,
  "model": "Comment",
  "files": [
    {
      "path": "src/modules/comment/comment.routes.ts",
      "sizeBytes": 1423
    }
  ]
}
```

Failure JSON shape:

```json
{
  "success": false,
  "error": "Model \"Comment\" not found in schema. Available models: User, Post"
}
```

### `bcm diff`

Shows what would change if generation is re-run against an existing output directory.

```bash
bcm diff --schema <path> --output <path> [options]
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--schema <path>` | `-s` | Path to the Prisma schema file | required |
| `--output <path>` | `-o` | Existing generated output directory to compare against | required |
| `--json` | | Emit machine-readable JSON only | `false` |
| `--framework <name>` | | `express` or `fastify` | `express` |

Examples:

```bash
# Human-readable diff summary
bcm diff --schema ./prisma/schema.prisma --output .

# JSON diff for CI tooling
bcm diff --schema ./prisma/schema.prisma --output . --json
```

Success JSON shape:

```json
{
  "new": ["src/modules/comment/comment.routes.ts"],
  "modified": [
    {
      "path": "src/app.ts",
      "hunks": "--- a/src/app.ts\n+++ b/src/app.ts\n..."
    }
  ],
  "identical": ["src/config/env.ts"],
  "orphaned": ["src/modules/legacy/"]
}
```

Failure JSON shape:

```json
{
  "success": false,
  "error": "Output directory not found: /abs/path/project"
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
- `@bcm.rateLimit(max: N, window: "1m")`
- `@bcm.cursor(field: "createdAt")`
- `@bcm.event`
- `@bcm.audit`
- `@bcm.multitenancy(field: "tenantId")`
- `@bcm.ws`

Field directives:

- `@bcm.hidden`
- `@bcm.readonly`
- `@bcm.writeOnly`
- `@bcm.searchable`
- `@bcm.nested`
- `@bcm.identifier`
- `@bcm.password`
- `@bcm.upload(...)`
- `@bcm.transform(trim: true, lowercase: true)`

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
- `REDIS_URL` when an auth model exists, any model uses `@bcm.cache`, or `--jobs bullmq` is used
- Upload storage variables when any field uses `@bcm.upload(...)`

Operational note:

- Redis/Valkey is required for auth refresh-token sessions, `@bcm.cache`, and `--jobs bullmq`.

## Generated Project Snapshot

Common output files:

```text
src/
  app.ts
  server.ts
  config/
  middlewares/
  modules/
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
tsconfig.json
vitest.config.ts
```

Generated package scripts:

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm test`
- `pnpm test:watch`
- `pnpm migrate`
- `pnpm seed`
- `pnpm studio`
- `pnpm generate`

See [Generated Code Walkthrough](generated-code.md) for file responsibilities.

## Next Reading

- [Directive Reference](directives.md)
- [Advanced Patterns](advanced.md)
- [Limitations](limitations.md)
- [Generated Code Walkthrough](generated-code.md)
