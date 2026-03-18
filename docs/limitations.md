# Backgen Limitations

This page tracks generator constraints, runtime requirements, and behavior that is intentionally out of scope.

## Hard Constraints

These fail `bcm validate` and `bcm generate`.

| Constraint | Current rule |
|------------|--------------|
| `@bcm.softDelete` | Model must declare `deletedAt DateTime?` |
| RBAC auth setup | If any model uses `@bcm.auth(...)`, an auth model must exist with `@bcm.identifier`, `@bcm.password`, and a scalar `role` field |
| `@bcm.identifier` under RBAC validation | Identifier must be scalar, non-list, and `@id` or `@unique` |
| Hidden required FKs | Required hidden FK fields must have a supported nested input path or be made optional/defaulted |
| Required readonly scalars | Required scalar fields cannot be marked `@bcm.readonly` without a default/optional path |
| Mixed required relation input modes | A model cannot mix required nested and required non-nested relations |

## Runtime Requirements

These are generated into `.env.example` only when needed.

| Requirement | When |
|-------------|------|
| `DATABASE_URL` | Always |
| `JWT_SECRET` with minimum length 32 | Any model uses `@bcm.authModel`, `@bcm.protected`, or `@bcm.auth(...)` |
| `ACCESS_TOKEN_TTL` | An auth model exists |
| `REDIS_URL` and a running Redis/Valkey instance | An auth model exists, any model uses `@bcm.cache`, or `--jobs bullmq` is used |
| Upload storage variables | Any field uses `@bcm.upload(...)` |

Operational note:

- Generated servers connect to Redis before serving traffic when auth refresh sessions, caching, or BullMQ jobs are enabled.

## Current Design Boundaries

These are intentional or at least current product boundaries, not validation failures.

### Authentication

- Only one auth model is generated per schema.
- Auth routes cover login, refresh, and logout; email verification and password reset are not generated.
- OAuth/social login is not generated.
- Token TTL is environment-driven (`ACCESS_TOKEN_TTL`), not directive-driven.

### Relations

- Nested relation input supports create for both singular and list relations.
- Nested connect requires the related model to have a selector; otherwise nested input is create-only.
- Required nested and required non-nested relations cannot coexist on the same model.

### Querying

- List endpoints are offset-based by default (`page` and `limit`).
- Cursor pagination endpoints are generated when a model uses `@bcm.cursor(...)`.
- Filtering is limited to generated allowed fields.
- Search uses `search=` across fields marked `@bcm.searchable`.

### Uploads

- No generated image transformation or thumbnail pipeline.
- Deleting a database record does not clean up previously uploaded files.
- CDN/public asset serving strategy is left to the generated project owner.

### Tests

- Generated tests are route/integration-style tests over mocked Prisma delegates.
- Repository unit tests mock Prisma delegates directly and test the data access layer in isolation.
- No e2e database test harness is generated.

### API Client Export

- The generated Postman collection uses static sample values; directive constraints (e.g., min/max lengths from `@bcm.transform`) are not reflected in sample payloads.
- Collection variable `{{authToken}}` must be set manually after login.

### Background Jobs

- Only one example job is generated; additional job types must be added manually.
- BullMQ requires a running Redis instance; pg-boss uses the existing PostgreSQL database.
- Job retry policies, concurrency, and scheduling are left at library defaults; customize in the generated `queue.ts`.
- No admin UI or dashboard is generated for monitoring job queues.

### WebSocket

- WebSocket support is pub/sub only — clients subscribe to model events, the server broadcasts. There is no request/response pattern over WebSocket.
- No authentication or authorization is applied to WebSocket connections; any client can subscribe to any model's events.
- The `ws` package is used directly (not socket.io); clients must use the native WebSocket API or a compatible library.
- Only models with `@bcm.ws` broadcast mutations; other models are not exposed over WebSocket.

### Eject

- `bcm eject` strips directive comments from generated code.
- Once stripped, those directives cannot be reconstructed from the ejected source tree.

## CLI Constraints

| Constraint | Current behavior |
|------------|------------------|
| Non-empty output dir | Full generation requires `--force` |
| `--only` conflict handling | Without `--force`, Backgen aborts when targeted files differ from what would be generated |
| Framework switching | Reusing one output directory across Express and Fastify generations is unsupported without regeneration |
| JSON endpoint count | `endpointCount` is omitted from `--json` output when `--only` is used |
| `bcm init` target directory | Must not already exist |

## Provider Caveats

| Provider | Caveat |
|----------|--------|
| SQLite | String search/filter uses case-sensitive `contains` behavior |
| SQLite | No database service is added to `docker-compose.yml` |
| MongoDB | Relation-heavy schemas and nested relation flows should be verified carefully before production use |
| PostgreSQL / MySQL | String search/filter uses case-insensitive `contains` queries |

## Related Docs

- [Usage Guide](USAGE.md)
- [Directive Reference](directives.md)
- [Advanced Patterns](advanced.md)
