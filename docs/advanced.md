# Backgen Advanced Patterns

This guide covers the cases where generator behavior depends on selectors, relation shape, framework choice, or optional infrastructure.

## Composite Selectors

Backgen builds item routes from the first available model selector in this order:

1. single-field `@id`
2. composite `@@id`
3. single-field `@unique`
4. composite `@@unique`

Example:

```prisma
model Favorite {
  userId    String
  listingId String

  @@id([userId, listingId])
}
```

Generated item path:

```text
/api/v1/favorites/{userId}/{listingId}
```

Selector-aware generation also affects:

- repository `Key` types
- controller param coercion
- OpenAPI path parameters
- nested `connect` payloads

If you provide an explicit Prisma compound selector name, Backgen preserves it in generated Prisma `where` objects:

```prisma
model Enrollment {
  schoolId  String
  studentId String

  @@id([schoolId, studentId], name: "enrollmentKey")
}
```

## Models Without Selectors

Models with no `@id`, `@@id`, `@unique`, or `@@unique` generate only:

- `GET /api/v1/<models>`
- `POST /api/v1/<models>`

Backgen intentionally skips item routes when there is no safe selector.

## Nested Relations

`@bcm.nested` changes DTO and OpenAPI generation from raw foreign-key input to nested relation input.

### Singular relation example

```prisma
model Post {
  id       String @id @default(cuid())
  title    String
  /// @bcm.hidden
  authorId String
  /// @bcm.nested
  author   User   @relation(fields: [authorId], references: [id])
}
```

Generated input shape:

```json
{
  "title": "Hello",
  "author": {
    "connect": {
      "id": "user_123"
    }
  }
}
```

### Composite selector connect

If the related model uses a composite selector, the generated `connect` payload is selector-aware:

```json
{
  "locale": {
    "connect": {
      "localeKey": {
        "code": "en",
        "region": "US"
      }
    }
  }
}
```

### List relation support

List relations also support nested input:

```prisma
model User {
  id          String @id @default(cuid())
  displayName String
  /// @bcm.nested
  posts       Post[]
}
```

Generated nested input uses arrays for both branches:

```json
{
  "displayName": "Alice",
  "posts": {
    "create": [
      { "title": "First post" }
    ]
  }
}
```

Current rules:

- `create` is always available.
- `connect` is generated only when the target model has a selector.
- Covered FK fields are removed from create/update DTOs.
- Required nested and required non-nested relations cannot be mixed on the same model.

## Auth and RBAC

When an auth model exists, Backgen generates:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Login returns an access token plus a refresh token. Refresh rotates both tokens, and logout revokes the submitted refresh token.

Environment impact:

- `JWT_SECRET` is required when auth is present.
- `ACCESS_TOKEN_TTL` is generated when an auth model exists and defaults to `15m`.
- `REDIS_URL` is generated because refresh-token sessions are stored in Redis.

RBAC adds `authorize(...)` middleware only to models using `@bcm.auth(roles: [...])`. Protected mutations on other models keep plain authentication middleware.

## Caching

`@bcm.cache(ttl: N)` enables Redis-backed caching around `findMany` and `findOne`.

Current generation behavior:

- `src/config/redis.ts` is emitted.
- `REDIS_URL` is added to `.env.example`.
- Generated service methods cache list and item reads.
- Mutations invalidate model-scoped cache keys.
- `docker-compose.yml` gets a Redis service when caching is enabled.

Because auth models also require Redis for refresh tokens, a project can need Redis even without `@bcm.cache`.

## Uploads

`@bcm.upload(...)` adds upload-aware middleware and config.

Example:

```prisma
model Profile {
  id String @id @default(cuid())
  /// @bcm.upload(dest: "avatars", mimeTypes: ["image/png", "image/jpeg"])
  avatarUrl String?
}
```

Generated behavior:

- Express uses multer middleware before DTO validation.
- Fastify uses multipart handling and persists uploads through generated helpers.
- Local storage and S3-compatible storage are both supported.
- The resolved file path or URL is written back into the request DTO flow.

## Fastify Differences

`--framework fastify` changes the framework-specific templates while keeping the overall generated project layout the same.

Key differences:

- `src/app.ts` exports `buildApp()` instead of an Express app instance.
- Model routes and auth routes become Fastify plugins.
- Auth uses `@fastify/jwt`.
- Uploads use `@fastify/multipart`.
- Swagger uses `@fastify/swagger` and `@fastify/swagger-ui`.

What stays the same:

- module repository/service/controller layering
- DTO generation
- OpenAPI generation
- Prisma integration
- seed generation
- infra templates

## Provider Caveats Worth Knowing Early

- SQLite search uses `contains` without case-insensitive mode.
- PostgreSQL and MySQL search/filter string matching uses case-insensitive `contains`.
- MongoDB support exists, but relation-heavy schemas should be tested carefully before production use.

## Related Docs

- [Directive Reference](directives.md)
- [Limitations](limitations.md)
- [Generated Code Walkthrough](generated-code.md)
