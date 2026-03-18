# Backgen Directive Reference

Directives are triple-slash Prisma comments that tell Backgen how to shape the generated API.

## Placement Rules

- Put model directives immediately above `model ModelName {`.
- Put field directives immediately above the field they annotate.
- Multiple directives can be stacked on consecutive lines.
- Unknown directives are ignored with warnings.
- Some conflicting directive pairs also emit warnings.

Example:

```prisma
/// @bcm.protected
model Post {
  id String @id @default(cuid())
  /// @bcm.searchable
  title String
}
```

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

## Model Directives

| Directive | Arguments | Effect |
|-----------|-----------|--------|
| `@bcm.protected` | none | Protects mutation routes with authentication middleware. Reads remain public unless tenant-scoped by `@bcm.multitenancy`, which requires auth to resolve tenant context. |
| `@bcm.softDelete` | none | Turns delete into `deletedAt = new Date()` and filters soft-deleted records from reads. Requires `deletedAt DateTime?`. |
| `@bcm.auth(roles: [...])` | `roles` array | Protects mutation routes with authentication plus role checks. Requires an auth model with a scalar `role` field. |
| `@bcm.authModel` | none | Marks the credential model used for generated auth routes. Requires `@bcm.identifier` and `@bcm.password` to generate `/api/v1/auth/*`. |
| `@bcm.cache(ttl: N)` | `ttl` number | Enables Redis-backed caching for `findMany` and `findOne`, with cache invalidation on mutations. |
| `@bcm.rateLimit(max: N, window: "1m")` | `max`, `window` | Adds per-route mutation rate limiting for that model. |
| `@bcm.cursor(field: "createdAt")` | `field` | Adds cursor pagination support and a `GET /cursor` endpoint for the model. |
| `@bcm.event` | none | Emits typed create/update/delete events on the generated event bus. |
| `@bcm.audit` | none | Writes audit entries for model mutations and enables shared audit utilities. |
| `@bcm.multitenancy(field: "tenantId")` | `field` | Enables tenant-scoped query/mutation paths using a tenant claim field from authenticated requests. |
| `@bcm.ws` | none | Marks the model as WebSocket-broadcasted when WebSocket generation is enabled (`--ws`). |

### `@bcm.authModel` vs `@bcm.auth(...)`

- `@bcm.authModel` by itself is enough to generate auth routes when the model has `@bcm.identifier` and `@bcm.password`.
- A scalar `role` field becomes mandatory only when some model also uses `@bcm.auth(roles: [...])` for RBAC.
- When a `role` field exists, it is included in the JWT payload.

Generated auth routes:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Login returns:

```json
{
  "data": {
    "accessToken": "jwt",
    "refreshToken": "uuid"
  }
}
```

## Field Directives

| Directive | Arguments | Effect |
|-----------|-----------|--------|
| `@bcm.hidden` | none | Removes the field from generated API inputs and responses. |
| `@bcm.readonly` | none | Excludes the field from create/update inputs but keeps it in responses. |
| `@bcm.writeOnly` | none | Accepts the field in create/update inputs but omits it from responses. |
| `@bcm.searchable` | none | Adds the field to full-text-style `search=` query support. |
| `@bcm.nested` | none | Replaces raw foreign-key input with nested `create` and, when possible, `connect` input on the relation field. |
| `@bcm.identifier` | none | Marks the login identifier field on the auth model. Must be scalar, non-list, and `@id` or `@unique`. |
| `@bcm.password` | none | Marks the password field on the auth model. Implies `writeOnly`. |
| `@bcm.upload(...)` | `dest`, optional `maxSize`, optional `mimeTypes` | Generates upload handling for the field and stores the resolved file path or URL in the DTO/controller flow. |
| `@bcm.transform(...)` | `trim`, `lowercase`, `uppercase` | Normalizes string input values before persistence/validation flow according to configured flags. |

### `@bcm.nested`

`@bcm.nested` applies to relation fields, not foreign-key scalar fields.

Without `@bcm.nested`:

```prisma
model Post {
  authorId String
  author   User @relation(fields: [authorId], references: [id])
}
```

Create payload:

```json
{
  "title": "Hello",
  "authorId": "user_123"
}
```

With `@bcm.nested`:

```prisma
model Post {
  /// @bcm.hidden
  authorId String
  /// @bcm.nested
  author   User @relation(fields: [authorId], references: [id])
}
```

Create payload:

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

Current nested behavior:

- Works for singular and list relations.
- Generates `create` support for the related model.
- Generates `connect` support only when the related model has a selector.
- Uses selector-aware connect payloads for composite selectors.
- Automatically excludes covered FK fields from generated create/update DTOs.

### `@bcm.upload(...)`

Example:

```prisma
model Profile {
  id String @id @default(cuid())
  /// @bcm.upload(dest: "avatars", maxSize: 5242880, mimeTypes: ["image/png", "image/jpeg"])
  avatarUrl String?
}
```

Current defaults:

- `dest` defaults to `"uploads"` when omitted.
- `maxSize` defaults to `10 MB` in generated upload config.
- `mimeTypes` is optional.

Generated upload support:

- Express uses multer-based middleware.
- Fastify uses `@fastify/multipart`.
- Local storage and S3-compatible storage are both supported by generated config.

### `@bcm.rateLimit(...)`

Example:

```prisma
/// @bcm.rateLimit(max: 60, window: "1m")
model Task {
  id String @id @default(cuid())
  title String
}
```

Current behavior:

- Applies model-specific write route limits (create/update/patch/delete).
- `max` defaults to `100` and `window` defaults to `1m` when omitted inside the argument block.

### `@bcm.cursor(...)`

Example:

```prisma
/// @bcm.cursor(field: "createdAt")
model Event {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
}
```

Current behavior:

- Generates cursor-aware repository/service methods for the model.
- Adds `GET /api/v1/<models>/cursor`.
- `field` defaults to `"id"` when omitted inside the argument block.

### `@bcm.event` and `@bcm.audit`

```prisma
/// @bcm.event
model Order {
  id String @id @default(cuid())
}

/// @bcm.audit
model Invoice {
  id String @id @default(cuid())
}
```

Current behavior:

- `@bcm.event` emits typed mutation events through a generated shared event bus.
- `@bcm.audit` writes mutation audit records and enables generated audit helpers.

### `@bcm.multitenancy(...)`

Example:

```prisma
/// @bcm.protected
/// @bcm.multitenancy(field: "orgId")
model Project {
  id    String @id @default(cuid())
  orgId String
  name  String
}
```

Current behavior:

- Generates tenant-scoped query and item lookup paths using the configured tenant field.
- `field` defaults to `"tenantId"` when omitted inside the argument block.
- In protected flows, generated controllers resolve tenant context from authenticated request claims.

### `@bcm.ws`

`@bcm.ws` marks models whose mutation events are forwarded to WebSocket subscribers when generation is run with `--ws`.

Notes:

- `--ws` generates the WebSocket modules.
- Only models with `@bcm.ws` are broadcast to subscribed clients.

## Validation Expectations

Backgen currently enforces these directive-driven constraints:

| Rule | Trigger |
|------|---------|
| `deletedAt DateTime?` is required | Any model with `@bcm.softDelete` |
| Auth model with identifier, password, and scalar `role` | Required when any model uses `@bcm.auth(...)` |
| Identifier field must be unique or primary key | Any `@bcm.identifier` used by RBAC auth |
| Hidden required FK must have a nested input path or become optional/defaulted | `@bcm.hidden` on required FK fields |
| Required `@bcm.readonly` scalar fields are invalid | `@bcm.readonly` on required scalar fields |
| Required nested and required non-nested relations cannot mix on one model | Required relation inputs |

## Conflict Warnings

The parser emits warnings for these field-level combinations:

- `hidden` + `writeOnly`
- `hidden` + `readonly`
- `readonly` + `writeOnly`
- `password` + `writeOnly`
- `password` + `readonly`
- `password` + `hidden`

## Related Docs

- [Usage Guide](USAGE.md)
- [Advanced Patterns](advanced.md)
- [Limitations](limitations.md)
