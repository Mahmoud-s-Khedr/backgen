# Changelog

## [1.0.0] - 2026-02-19

### Features
- CLI tool (`bcm`) with `init`, `generate`, and `eject` commands
- Prisma schema parsing via `@mrleebo/prisma-ast`
- Custom `/// @bcm.*` directives: `hidden`, `readonly`, `writeOnly`, `searchable`, `protected`, `softDelete`
- Full CRUD endpoint generation (GET list, GET by ID, POST, PUT, PATCH, DELETE)
- Schema-aware Zod validation with route-level middleware
- Auto-generated OpenAPI 3.0 spec with Swagger UI
- Pagination, sorting, filtering, and full-text search via query parameters
- JWT auth middleware scaffold with `@bcm.protected` model directive
- `@bcm.softDelete` support (deletedAt timestamp instead of hard delete)
- `@bcm.searchable` for field-level full-text search
- RFC 7807 Problem Detail error responses with 9 Prisma error codes
- Generic-typed response helpers
- Prisma-typed service return values
- Structured logging with Pino
- Request ID tracing (X-Request-ID header)
- Compression middleware
- Rate limiting middleware
- CORS configuration with production warning
- Dockerfile (multi-stage) + docker-compose.yml
- GitHub Actions CI pipeline template
- Faker-based database seeding with topological sort and configurable count
- Per-model test scaffolds with supertest
- `--dry-run`, `--only`, and `--force` flags
- esbuild bundling for CLI distribution
- 10 example schemas (ex1-ex10) from simple to complex
- Zero-dependency ejectable output

### Security
- Field whitelist on query builder prevents filtering on hidden/writeOnly fields
- JSON body limit configurable (default: 1mb, was 10mb)
- Docker Compose uses environment variables for credentials
- CORS origin logging in production when not configured
