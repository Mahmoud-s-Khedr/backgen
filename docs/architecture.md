# Backgen — Architecture Guide

This document explains how the `bcm` CLI works internally: from reading a `.prisma` file to writing a complete backend project.

---

## Table of Contents

- [Overview](#overview)
- [Parser Layer](#parser-layer)
- [Validation Layer](#validation-layer)
- [Generator Layer](#generator-layer)
- [Template Engine](#template-engine)
- [Selector System](#selector-system)
- [CLI Commands](#cli-commands)
- [File Write Modes](#file-write-modes)

---

## Overview

```
.prisma file
    │
    ▼
┌─────────────────────────────────────┐
│  Parser Layer  (src/parser/)        │
│  ┌───────────────┐  ┌─────────────┐ │
│  │ prisma-ast-   │  │ directive-  │ │
│  │ parser.ts     │  │ parser.ts   │ │
│  └───────┬───────┘  └──────┬──────┘ │
│          └────────┬─────────┘        │
│                   ▼                  │
│           ParsedSchema               │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Validation Layer                   │
│  (src/generator/validate.ts)        │
│  5 structural checks                │
└─────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  Generator Layer  (src/generator/)                   │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐  │
│  │ module-  │ │config- │ │middleware│ │  utils-  │  │
│  │generator │ │generator│ │-generator│ │generator │  │
│  └──────────┘ └────────┘ └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐  │
│  │  app-    │ │ infra- │ │ prisma-  │ │ swagger- │  │
│  │generator │ │generator│ │generator │ │generator │  │
│  └──────────┘ └────────┘ └──────────┘ └──────────┘  │
│                         │                            │
│          Template Engine (EJS)                       │
└──────────────────────────────────────────────────────┘
    │
    ▼
GeneratedFile[] → written to output directory
```

---

## Parser Layer

Source: `src/parser/`

The parser layer is responsible for turning a raw `.prisma` text file into a typed `ParsedSchema` object that the generators consume.

### `prisma-ast-parser.ts`

This is the sole parser implementation. It uses `@mrleebo/prisma-ast` to produce a block-level AST from the schema text, then walks it to build the `ParsedSchema`.

**What it extracts:**

- **Models** — Each `model` block becomes a `ModelDefinition` with:
  - `fields: FieldDefinition[]` — every declared field
  - `selectors: ModelSelectorDefinition[]` — all ways to uniquely identify a single record (`@id`, `@unique`, `@@id`, `@@unique`)
  - `directives: ModelDirective[]` — model-level `@bcm.*` directives
  - `isAuthModel`, `identifierField`, `passwordField`, `roleField` — auth metadata
  - `cacheConfig?: { ttl: number }` — from `@bcm.cache(ttl: N)`

- **Fields** — Each field within a model becomes a `FieldDefinition` with:
  - `type`: Prisma scalar type or model/enum name
  - `isList`, `isOptional`, `isId`, `isUnique`, `isRelation`, `isEnum`
  - `hasDefault`, `isServerDefault` — `isServerDefault` is `true` for function-call defaults (`uuid()`, `now()`, `autoincrement()`) and `@updatedAt`; `false` for user-overridable literals (`@default(false)`, `@default(0)`, `@default("USER")`)
  - `directives: FieldDirective[]` — field-level `@bcm.*` directives
  - `uploadConfig?: UploadConfig` — from `@bcm.upload(...)`
  - `relationField?: string` — local FK field name (for relations)

- **Enums** — Each `enum` block becomes an `EnumDefinition`

- **Datasource** — The `datasource` block becomes `DatasourceConfig` with `provider` and `url`

**Composite key detection:**

For `@@id([a, b])` and `@@unique([a, b])`, the parser builds a `ModelSelectorDefinition` with:
- `kind: 'id' | 'unique'`
- `fields: string[]` — ordered list of field names
- `prismaKey?: string` — the Prisma compound key name (explicit `name:` arg, or derived from joined field names like `userId_listingId`)

**`isServerDefault` vs `hasDefault`:**

This distinction controls which fields appear as optional inputs in Create/Update schemas:
- `isServerDefault: true` → excluded from Create/Update inputs (the database or Prisma handles it)
- `hasDefault: true` but `isServerDefault: false` → included as an **optional** input (user may override the default)

Example:
```prisma
id        String  @id @default(cuid())    // isServerDefault: true  — excluded from Create
role      Role    @default(USER)          // isServerDefault: false — optional in Create
createdAt DateTime @default(now())        // isServerDefault: true  — excluded from Create
```

### `directive-parser.ts`

Scans schema text line-by-line for triple-slash directive comments before model and field definitions.

**Regex used:**
```
/^\/\/\/\s*@bcm\.(\w+)(?:\(([^)]*)\))?/
```

**Directive collection:**
- Lines before a `model X {` line accumulate model-level directives
- Lines between the `{` and each field accumulate field-level directives

**Argument parsing:**
- `@bcm.auth(roles: [ADMIN, USER])` → `authRoles: ['ADMIN', 'USER']`
- `@bcm.cache(ttl: 300)` → `cacheConfig: { ttl: 300 }`
- `@bcm.upload(dest: "avatars", maxSize: 5242880, mimeTypes: ["image/jpeg"])` → `UploadConfig` object

**Conflict detection:** The parser emits warnings (into `ParsedSchema.warnings`) for invalid directive combinations (e.g., `hidden` + `writeOnly` on the same field).

### `types.ts`

Defines the complete type hierarchy:

```
ParsedSchema
├── models: ModelDefinition[]
│   ├── fields: FieldDefinition[]
│   │   ├── directives: FieldDirective[]
│   │   └── uploadConfig?: UploadConfig
│   ├── selectors?: ModelSelectorDefinition[]
│   ├── directives: ModelDirective[]
│   └── cacheConfig?: CacheConfig
├── enums: EnumDefinition[]
├── datasource: DatasourceConfig
└── warnings: string[]
```

---

## Validation Layer

Source: `src/generator/validate.ts`

The validation layer runs structural checks on the `ParsedSchema` and surfaces issues before any code is generated.

### Two entry points

**`validateSchema(schema): ValidationResult`**
- Returns `{ valid: boolean, errors: ValidationIssue[], warnings: ValidationIssue[] }`
- Used by the `bcm validate` command to report all issues at once

**`validateSchemaOrThrow(schema): void`**
- Runs the same checks but throws immediately on the first category of errors
- Used by the `bcm generate` command for fail-fast behavior

### Validation checks

| Check | What it detects |
|-------|----------------|
| `checkAuthConfiguration` | If any model has `@bcm.auth`, an `@bcm.authModel` must exist with `@bcm.identifier`, `@bcm.password`, and a scalar `role` field. The identifier must be `@unique` or `@id`. |
| `checkSoftDeleteConfiguration` | `@bcm.softDelete` models must have a `deletedAt DateTime?` field — correct type, optional, non-list, non-relation. |
| `checkHiddenRequiredForeignKeys` | Hidden required FK fields create unreachable inputs. Must be paired with `@bcm.nested` on the relation, or be optional/defaulted. |
| `checkReadonlyRequiredFields` | A required field marked `@bcm.readonly` would be excluded from all inputs but has no default — invalid state. |
| `checkMixedRequiredRelationInputModes` | A model cannot have both required `@bcm.nested` relations and required non-nested relations (they produce incompatible Prisma input shapes). |

---

## Generator Layer

Source: `src/generator/`

### Orchestrator: `index.ts`

`generateProject(schema, options)` is the main entry point. It:

1. Calls `validateSchemaOrThrow(schema)` — fail fast on errors
2. Builds a map of generator functions keyed by `--only` part name:
   ```
   routes    → generateModuleFiles(schema, framework)
   config    → generateConfigFiles(schema, framework)
   middleware → generateMiddlewareFiles(schema, framework)
   utils     → generateUtilsFiles(schema)
   app       → generateAppFiles(schema, framework)
   infra     → generateInfraFiles(schema, options)
   prisma    → generatePrismaFiles(schema)
   swagger   → generateSwaggerFiles(schema)
   ```
3. If `--only` is specified, runs only that generator; otherwise runs all
4. Deduplicates and returns the full `GeneratedFile[]` array

The `framework` option (`'express' | 'fastify'`) is threaded into every generator that produces framework-specific files.

### Sub-generators

| Generator | Output files |
|-----------|-------------|
| `module-generator.ts` | `src/modules/<model>/<model>.{routes,controller,service,repository,dto,test}.ts` — one set per model |
| `config-generator.ts` | `src/config/{database,env,cors,logger,swagger}.ts`; conditionally `redis.ts`, `upload.ts` |
| `middleware-generator.ts` | `src/middlewares/error.middleware.ts`, `validation.middleware.ts`, `rate-limit.middleware.ts`; conditionally `auth.middleware.ts`, `upload.middleware.ts` |
| `utils-generator.ts` | `src/utils/{response,query-builder}.ts` |
| `app-generator.ts` | `src/app.ts`, `src/server.ts`; `src/modules/auth/auth.routes.ts` (when auth model exists) |
| `infra-generator.ts` | `docker-compose.yml`, `Dockerfile`, `.env.example`, `.github/workflows/ci.yml`, `.gitignore`, `README.md`, `package.json`, `tsconfig.json`, `vitest.config.ts` |
| `prisma-generator.ts` | `prisma/seed.ts` |
| `swagger-generator.ts` | `openapi.json` |

### Framework-specific template selection

Each generator selects the appropriate template based on `framework`:

| File | Express template | Fastify template |
|------|-----------------|-----------------|
| App | `app.ts.ejs` | `app-fastify.ts.ejs` |
| Server | `server.ts.ejs` | `server-fastify.ts.ejs` |
| Routes | `module/routes.ts.ejs` | `module/routes-fastify.ts.ejs` |
| Auth routes | `auth/auth.routes.ts.ejs` | `auth/auth.routes-fastify.ts.ejs` |
| Error middleware | `middleware/error.middleware.ts.ejs` | `middleware/error-fastify.middleware.ts.ejs` |
| Auth middleware | `middleware/auth.middleware.ts.ejs` | `middleware/auth-fastify.middleware.ts.ejs` |
| Swagger config | `config/swagger.ts.ejs` | `config/swagger-fastify.ts.ejs` |

Framework-agnostic files (same template for both): `controller`, `service`, `repository`, `dto`, `test`, `database`, `env`, `cors`, `redis`, `upload`, `validation.middleware`, `rate-limit.middleware`, `upload.middleware`, `utils/*`, `prisma/seed.ts`, all infra files.

---

## Template Engine

Source: `src/generator/template-engine.ts`

### Rendering

All templates are EJS files located in `src/templates/` (compiled to `dist/templates/`). They are rendered with:

```typescript
renderTemplate(templateName: string, data: Record<string, any>): string
```

Every render call automatically injects `h: helpers` into the template context alongside the caller-provided data.

### Helper functions (`h.*`)

| Helper | Description |
|--------|-------------|
| `h.toCamelCase(str)` | `UserProfile` → `userProfile` |
| `h.toPascalCase(str)` | `user_profile` → `UserProfile` |
| `h.toKebabCase(str)` | `UserProfile` → `user-profile` |
| `h.toSnakeCase(str)` | `UserProfile` → `user_profile` |
| `h.pluralize(str)` | `Post` → `Posts` (backed by the `pluralize` npm package) |
| `h.singularize(str)` | `Posts` → `Post` |
| `h.toLowerCase(str)` | `User` → `user` |
| `h.prismaToZodType(str)` | `'String'` → `'z.string()'`, `'Int'` → `'z.number().int()'`, `'DateTime'` → `'z.string().datetime()'` |
| `h.prismaToTsType(str)` | `'String'` → `'string'`, `'DateTime'` → `'Date'`, `'BigInt'` → `'bigint'` |

### Template data context

Each sub-generator constructs a data object before calling `renderTemplate`. For module templates, the key fields include:

```typescript
{
  model,          // ModelDefinition — the full model object
  schema,         // ParsedSchema — full schema (for cross-model lookups)
  enums,          // EnumDefinition[] — all enums
  framework,      // 'express' | 'fastify'

  // Computed from model fields:
  createFields,   // FieldDefinition[] — fields included in Create schema
  responseFields, // FieldDefinition[] — fields included in Response schema
  includeRelations, // list relation fields for optional include
  nestedRelations,  // @bcm.nested relation fields
  uploadFields,     // @bcm.upload field definitions

  // Selector info:
  itemSelector,           // ModelSelectorDefinition | null
  itemSelectorFieldMeta,  // [{ name, tsType }] for Key type generation

  // Feature flags:
  isProtected,   // true if @bcm.protected or @bcm.auth
  isSoftDelete,  // true if @bcm.softDelete
  cacheConfig,   // CacheConfig | null

  h,             // TemplateHelpers (injected by renderTemplate)
}
```

### Browser mode

The template engine supports an in-memory template store for the web playground. Call `setTemplateStore(map)` with a `Map<string, string>` keyed by template name to bypass filesystem reads. This allows the generator to run entirely in a browser environment.

---

## Selector System

Source: `src/generator/generators/module-generator.ts`, `src/parser/prisma-ast-parser.ts`

### What is a selector?

A selector is any field or field combination that can uniquely identify a single record. Selectors determine:
- Whether item-level endpoints are generated (`GET /:id`, `PUT`, `PATCH`, `DELETE`)
- The route parameter names and order
- The TypeScript `{Model}Key` type in the repository
- The Prisma `where` clause shape for single-record operations

### Building selectors

The parser collects selectors from the AST:

1. **`@id` field** → `{ kind: 'id', fields: [fieldName] }`
2. **`@@id([a, b])`** → `{ kind: 'id', fields: ['a', 'b'], prismaKey: 'a_b' }` (or explicit `name:` value)
3. **`@unique` field** → `{ kind: 'unique', fields: [fieldName] }`
4. **`@@unique([a, b])`** → `{ kind: 'unique', fields: ['a', 'b'], prismaKey: 'a_b' }`

Primary key selectors (`kind: 'id'`) take precedence. The first `@id` or `@@id` found becomes the `itemSelector` used for route generation.

### Route parameter generation

For a single-field selector (`fields: ['id']`), the route parameter is `/:id`.

For a composite selector (`fields: ['userId', 'listingId']`), parameters are `/:userId/:listingId` (in field order).

### Prisma `where` clause generation

Single-field: `{ id: key.id }`

Composite: Uses Prisma's compound key syntax:
```typescript
{ userId_listingId: { userId: key.userId, listingId: key.listingId } }
```
Or with explicit name (`@@id([a, b], name: "myKey")`): `{ myKey: { a: key.a, b: key.b } }`

---

## CLI Commands

Source: `src/cli.ts`, `src/commands/`

The CLI is built with [Commander.js](https://github.com/tj/commander.js). Entry point: `dist/generator/cli.js` (bundled by esbuild).

### Build system

- **Bundler**: esbuild (output: `dist/generator/cli.js`, ESM format, ~843 KB)
- **CJS shim**: Banner `import { createRequire } from 'module'; const require = createRequire(import.meta.url);` is prepended to handle CJS dependencies inside the ESM bundle
- **Templates**: Copied from `src/templates/` to `dist/templates/` at build time
- **Template resolution**: `join(__dirname, '..', 'templates')` → `dist/templates/`

---

## File Write Modes

When writing generated files to disk, `bcm generate` uses one of three modes:

| Mode | When used | Behavior |
|------|-----------|----------|
| `skip-identical` | Default (full generate) | Skips writing if file content is identical to what's on disk |
| `overwrite-targeted` | `--force` (with or without `--only`) | Overwrites the file unconditionally |
| `error-on-conflict` | `--only` without `--force` | Throws an error if the existing file would change — prevents accidental partial overwrites |
