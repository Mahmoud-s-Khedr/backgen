# Backend Creator (bcm) — Project Review

## Executive Summary

**Backend Creator** (`bcm`) is a CLI tool that generates complete, production-ready Express.js REST APIs from Prisma schemas. It reads a `.prisma` schema file, parses models, fields, relations, enums, and custom `@bcm.*` directives, then generates a fully structured TypeScript backend with Zod validation, Swagger/OpenAPI docs, Docker support, JWT authentication, and more.

The tool fills a genuine gap: while Prisma handles database access, developers still need to manually wire up controllers, routes, DTOs, error handling, and infrastructure. `bcm` automates this entire layer, producing ejectable code with zero runtime dependency on the CLI.

---

## Architecture

```
CLI (Commander.js)
 ├── init      → Scaffold starter project
 ├── generate  → Parse schema → Generate backend
 └── eject     → Strip @bcm directives

generate pipeline:
  Schema File (.prisma)
    → Parser (prisma-ast + directive-parser)
      → ParsedSchema { models, enums, datasource }
        → Generator (8 sub-generators)
          → Template Engine (EJS)
            → File Writer → Output Directory
```

### Core Components

| Component | Files | Purpose |
|-----------|-------|---------|
| CLI Entry | `src/cli.ts` | Commander.js setup, version reading |
| Commands | `src/commands/{init,generate,eject}.ts` | Three CLI commands |
| Parser | `src/parser/{prisma-ast-parser,directive-parser,types}.ts` | Schema + directive parsing |
| Generator | `src/generator/index.ts` + 8 sub-generators | Orchestration + per-concern generation |
| Template Engine | `src/generator/template-engine.ts` | EJS rendering with type-mapping helpers |
| Templates | `src/templates/` (27 EJS files) | All generated code templates |

### Build System

- **Bundler**: esbuild (ESM output, ~843 KB single file)
- **Output**: `dist/generator/cli.js` + `dist/templates/`
- **Banner**: `createRequire` shim for CJS dependencies inside ESM bundle
- **Type-check**: `tsc --noEmit` (separate from build)

---

## Code Quality Assessment

### Type Safety — 9/10

TypeScript strict mode is enabled throughout. The codebase uses well-defined interfaces (`ParsedSchema`, `ModelDefinition`, `FieldDefinition`, `DatasourceConfig`) and avoids `any` in most places. The parser uses proper AST interfaces from `@mrleebo/prisma-ast`. A few spots remain where `any` is used (response helpers, EJS escape function), but these are localized.

### Error Handling — 8/10

The generated code uses RFC 7807 Problem Detail responses — a strong choice that provides structured, machine-readable errors. Prisma error codes (P2002, P2003, P2025) are mapped to appropriate HTTP status codes. The error middleware is comprehensive. Zod validation errors include field paths. The CLI itself wraps parser errors with meaningful messages.

9 Prisma error codes are now mapped to appropriate HTTP statuses (P2000, P2002, P2003, P2005, P2006, P2011, P2014, P2021, P2025).

### Modularity — 9/10

Clean separation between parsing, generation, and template rendering. Each of the 8 sub-generators handles one concern (modules, config, middleware, utils, app, infra, prisma, swagger). The `--only` flag allows selective generation. Templates are isolated and receive data through a well-defined interface.

### Security — 8/10

Good foundations: Helmet, CORS, rate limiting, JWT auth middleware, and Zod validation are all present. The `@bcm.protected` directive adds auth to mutation routes. Query builder validates filter keys against a whitelist of allowed fields (hidden/writeOnly fields rejected). CORS logs a warning in production if not configured. JSON body limit configurable (default: 1mb). Docker Compose uses env var references with credential warning comments.

Remaining: Docker Compose still falls back to weak default credentials if env vars not set.

### Generated Code Quality — 8/10

The generated TypeScript is clean, well-structured, and follows modern conventions. It uses named imports for ESM/CJS interop, proper async/await patterns, and Prisma's typed client. The seed script uses topological sorting (Kahn's BFS) to handle FK dependencies — a sophisticated touch.

### Documentation — 8/10

Four comprehensive docs (README, USAGE, REPORT, implementation plan) plus a real-world example schema. The README is concise and accurate. USAGE.md is thorough with query parameter examples and deployment instructions.

CHANGELOG.md, CONTRIBUTING.md, and LICENSE file are present. 10 example schemas (ex1-ex10) demonstrate increasing complexity.

### Test Coverage — 7/10

92 tests across 4 test files cover the core modules: directive parser (17 tests), Prisma AST parser (22 tests), template engine helpers and rendering (33 tests), and generator integration (20 tests). Tests verify field categorization, directive parsing, conflict detection, type mappings, and generated file content. Remaining gap: no end-to-end CLI tests (testing `bcm generate` as a subprocess), no coverage for init/eject commands.

---

## Strengths

1. **End-to-end generation**: From a single Prisma schema, produces controllers, services, routes, DTOs, config, middleware, utilities, infrastructure, and Swagger docs — 27 templates total.

2. **Directive system**: `@bcm.hidden`, `@bcm.readonly`, `@bcm.writeOnly`, `@bcm.searchable`, `@bcm.protected`, and `@bcm.softDelete` provide schema-level API behavior control with conflict detection and validation warnings.

3. **Ejectable design**: Generated code has zero runtime dependency on the CLI. The `eject` command strips all `@bcm` directives, leaving a standalone project.

4. **Smart defaults**: Pagination with configurable limits, case-insensitive search (database-aware), includes/relations via query params, sorting, and filtering — all generated automatically.

5. **Production infrastructure**: Dockerfile with multi-stage build, Docker Compose with PostgreSQL, GitHub Actions CI template, structured logging (Pino), and environment validation (Zod).

6. **Topological seeding**: The seed script orders model creation by FK dependencies using Kahn's algorithm, with Faker.js data generation and enum-aware field detection.

7. **Fast build**: esbuild bundles the entire CLI into a single ~843 KB file, replacing the slower `tsc` compilation.

---

## Metrics Summary

| Aspect | Rating | Notes |
|--------|--------|-------|
| Type Safety | 9/10 | Strict TypeScript, proper interfaces |
| Error Handling | 9/10 | RFC 7807, 9 Prisma error codes mapped |
| Modularity | 9/10 | Clean separation, 8 independent generators |
| Security | 8/10 | Field whitelist, configurable limits, CORS warnings |
| Generated Code | 8/10 | Clean TypeScript, modern patterns |
| Documentation | 9/10 | Comprehensive, CHANGELOG + CONTRIBUTING + LICENSE present |
| Test Coverage | 7/10 | 92 tests across 4 files covering parser, directives, helpers, generator |
| Build System | 9/10 | Fast esbuild bundling, proper ESM output |
| **Overall** | **8.5/10** | Solid architecture, all 24 issues resolved, good test coverage |

---

## Conclusion

Backend Creator is a well-architected CLI tool with strong fundamentals. The parser-generator-template pipeline is clean and extensible. The generated code follows modern TypeScript/Express conventions and includes production infrastructure out of the box. The directive system is a thoughtful addition that keeps API behavior close to the data model.

All 24 identified issues have been resolved, including the addition of 92 tests covering the parser, directive parser, template engine, and generator. The directive system includes six directives (`@bcm.hidden`, `@bcm.readonly`, `@bcm.writeOnly`, `@bcm.searchable`, `@bcm.protected`, `@bcm.softDelete`) with conflict detection and validation warnings.
