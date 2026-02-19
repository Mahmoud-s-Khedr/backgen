## 5. [Backend Creator from Data Model](backend_creator/backend_creator.md)

**Description:** A powerful CLI tool that generates a complete, production-ready Express.js REST API backend from a standard Prisma schema file. With a single command, developers can scaffold an entire backend including database migrations, CRUD endpoints with schema-aware validation, and auto-generated Swagger/OpenAPI documentation. The tool bridges the gap between schema definition and runnable API, eliminating hours of boilerplate code.

**Key Differentiator:** Clean, ejectable code with zero runtime dependency on the generator. Generate once, eject forever.

### Core Features
- Standard Prisma schema parsing via `@mrleebo/prisma-ast`
- Custom `/// @bcm.*` directives for API behavior (`@bcm.hidden`, `@bcm.readonly`, `@bcm.writeOnly`)
- Full CRUD endpoint generation with PATCH for partial updates
- Schema-aware validation (required fields = required, optional = optional)
- Auto-generated Swagger/OpenAPI documentation with interactive UI
- JWT auth middleware scaffold included
- Test file examples (supertest) for each model
- Query parameters: pagination, sorting, filtering, relation includes
- Production scaffolds: CORS, rate limiting, health check, structured logging, Docker
- Modular project structure with controllers, services, routes, and DTOs
- TypeScript-first with Zod validation
- RFC 7807 standardized error responses
- Zero-dependency ejectable output

========================================================================================================


# Backend Creator from Data Model

**Description:** A powerful CLI tool that generates a complete, production-ready Express.js REST API backend from a standard Prisma schema file. With a single command, developers can scaffold an entire backend including database migrations, CRUD endpoints with schema-aware validation, and auto-generated Swagger/OpenAPI documentation. The tool bridges the gap between schema definition and runnable API, eliminating hours of boilerplate code.

**Key Differentiator:** Clean, ejectable code with zero runtime dependency on the generator. Generate once, eject forever.

---

## Market Research & Competitive Analysis

### Existing Solutions

| Tool | What It Does | Gap |
|------|--------------|-----|
| **Prisma** | ORM with schema-based migrations and type-safe client | Does NOT generate API routes or documentation |
| **LoopBack** | Full framework with model-to-API generation | Heavy framework lock-in, opinionated structure |
| **NocoDB** | Turns database into spreadsheet with REST API | Runtime service, not code generation |
| **Hasura** | GraphQL/REST from database | Requires running Hasura server, not standalone code |
| **prisma-api-gen** | Community tool for scaffolding | Limited features, not actively maintained |
| **Strapi** | Headless CMS with auto APIs | Full CMS, not lightweight CLI tool |

### Our Differentiator

**No existing tool combines all of these:**
1. ✅ Standard Prisma schema (familiar syntax, free tooling)
2. ✅ Generates standalone Express.js code (no runtime dependency)
3. ✅ Schema-aware validation (required = required)
4. ✅ Auto-generated Swagger/OpenAPI documentation
5. ✅ Prisma migrations included
6. ✅ Production-ready scaffolds (CORS, logging, Docker, health checks)
7. ✅ CLI-first, ejectable output

**Our Niche:** *"I want to write code, but I don't want to start from scratch."*

---

## Core Features

### 1. Schema Definition (Standard Prisma + Comment Directives)

Use standard `.prisma` files with custom `/// @bcm.*` comment directives:

```prisma
// schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  /// @bcm.hidden
  password  String
  /// @bcm.searchable
  name      String?
  role      Role     @default(USER)
  posts     Post[]
  /// @bcm.readonly
  createdAt DateTime @default(now())
  /// @bcm.readonly
  updatedAt DateTime @updatedAt
}

model Post {
  id        String   @id @default(uuid())
  title     String
  /// @bcm.searchable
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  tags      Tag[]
  /// @bcm.readonly
  createdAt DateTime @default(now())
}

model Tag {
  id    String @id @default(uuid())
  name  String @unique
  posts Post[]
}

enum Role {
  USER
  ADMIN
  MODERATOR
}
```

**Benefits of Standard Prisma:**
- VS Code syntax highlighting & IntelliSense for free
- Prisma preserves `///` comments in AST
- Zero custom parser development
- Familiar to existing Prisma users

### 2. Supported Directives

| Directive | Purpose | Behavior | MVP |
|-----------|---------|----------|-----|
| `@bcm.hidden` | Exclude field from all API inputs and responses (internal flags, audit columns) | Never included in any API input or response DTO | ✅ |
| `@bcm.readonly` | Field cannot be set via API (only DB-generated) | Excluded from create/update/patch DTOs | ✅ |
| `@bcm.writeOnly` | Accept on write, never return (password input) | Accepted on POST, PUT, and PATCH — never in response. On PATCH, field is optional (only updated if provided). | ✅ |
| `@bcm.searchable` | Include in `?search=` query parameter | Adds field to full-text search filter | v1.1 |
| `@bcm.softDelete` | Enable soft delete with `deletedAt` timestamp | DELETE sets `deletedAt`, queries filter by default | v1.1 |
| `@bcm.protected` | Require authentication for this model's endpoints | Wraps mutation routes (POST/PUT/PATCH/DELETE) in auth middleware | ✅ |
| `@bcm.auth(roles)` | Require specific roles for access | Wraps routes in role-checking middleware | v1.1 |

### 3. Generated REST API Endpoints

For each model, the following endpoints are automatically generated:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | List all users (with pagination, filtering, sorting) |
| `GET` | `/api/users/:id` | Get user by ID |
| `POST` | `/api/users` | Create new user (schema-aware required fields) |
| `PUT` | `/api/users/:id` | Update user (schema-aware required fields) |
| `PATCH` | `/api/users/:id` | Partial update (all fields optional) |
| `DELETE` | `/api/users/:id` | Delete user by ID |
| `GET` | `/health` | Health check endpoint (global, not per-model) |

**Validation Strategy (Schema-Aware):**
- `String` in schema → **Required** in POST/PUT body
- `String?` in schema → **Optional** in POST/PUT body
- All fields optional only for **PATCH** (partial updates)
- `@bcm.writeOnly` fields → Accepted on POST/PUT/PATCH, never returned in response
- Relation fields handled via ID: `{ authorId: "123" }`

**Error Response Format (RFC 7807 - Problem Details):**
```json
{
  "type": "https://api.example.com/errors/validation",
  "title": "Validation Error",
  "status": 422,
  "detail": "The 'email' field is required.",
  "instance": "/api/users",
  "errors": [
    { "field": "email", "message": "Required" }
  ]
}
```

### 4. Query Parameters for List Endpoints

```
GET /api/users?page=1&limit=10&sort=createdAt&order=desc&filter[role]=ADMIN
```

- **Pagination:** `page`, `limit`
- **Sorting:** `sort`, `order` (asc/desc)
- **Filtering:** `filter[field]=value`
- **Search:** `search=term` (searches `@bcm.searchable` fields)
- **Include relations:** `include=posts,profile`

### 5. Auto-Generated Swagger Documentation

The CLI generates a complete OpenAPI 3.0 specification:

- All endpoints documented with request/response schemas
- Interactive Swagger UI served at `/api/docs`
- Exportable `openapi.json` for client generation
- Proper TypeScript types for all DTOs

### 6. Project Structure Generated

```
output/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                  # Database seeding with realistic faker data
├── src/
│   ├── config/
│   │   ├── database.ts          # Prisma client singleton
│   │   ├── swagger.ts           # OpenAPI configuration
│   │   ├── cors.ts              # CORS configuration
│   │   ├── logger.ts            # Structured logging (Pino)
│   │   └── env.ts               # Environment validation (Zod)
│   ├── modules/
│   │   └── [model]/
│   │       ├── [model].controller.ts
│   │       ├── [model].service.ts
│   │       ├── [model].routes.ts
│   │       ├── [model].dto.ts
│   │       └── [model].test.ts  # Supertest example
│   ├── middlewares/
│   │   ├── error.middleware.ts   # RFC 7807 error responses
│   │   ├── auth.middleware.ts    # JWT scaffold
│   │   ├── rate-limit.middleware.ts  # express-rate-limit
│   │   └── validation.middleware.ts
│   ├── utils/
│   │   ├── query-builder.ts     # Pagination, filtering
│   │   └── response.ts          # Standard response format
│   ├── app.ts
│   └── server.ts
├── .env.example
├── .gitignore
├── Dockerfile                   # Multi-stage production build
├── docker-compose.yml           # App + PostgreSQL
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI pipeline
├── package.json
├── tsconfig.json
└── README.md
```

### 7. CLI Commands

```bash
# Initialize a new project
bcm init my-api

# Generate backend from Prisma schema
bcm generate --schema ./prisma/schema.prisma --output ./my-api

# Preview generated files without writing
bcm generate --schema ./schema.prisma --dry-run

# Generate only specific parts
bcm generate --schema ./schema.prisma --only routes
bcm generate --schema ./schema.prisma --only swagger

# Eject: remove BCM comments from generated code
bcm eject ./my-api

# Development server (in generated project)
npm run dev
```

---

## Technical Implementation

### Tech Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| CLI Framework | Commander.js | Mature, lightweight CLI tooling |
| Schema Parser | `@mrleebo/prisma-ast` | Parse standard Prisma schemas; documented community API |
| Directive Parser | Simple regex | Parse `/// @bcm.*` comments |
| Template Engine | EJS | Code generation templates (more flexible than Handlebars for conditional logic) |
| Generated Backend | Express.js + TypeScript | Industry standard, widely adopted |
| ORM | Prisma | Best-in-class TypeScript ORM |
| Validation | Zod | Type-safe schema validation |
| Documentation | swagger-jsdoc + swagger-ui-express | Industry standard API docs |
| Logging | Pino | Structured, high-performance logging |
| Testing | Supertest + Jest | Standard testing stack |

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Tool                             │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ @mrleebo/    │───▶│  AST/Models  │───▶│  Generator   │  │
│  │ prisma-ast   │    │ + Directives │    │    (EJS)     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         ▲                                       │           │
│         │                                       ▼           │
│  ┌──────────────┐                      ┌──────────────────┐│
│  │schema.prisma │                      │ Generated Code   ││
│  │+ /// @bcm.*  │                      │ - Routes         ││
│  └──────────────┘                      │ - Controllers    ││
│                                        │ - Services       ││
│                                        │ - Zod Schemas    ││
│                                        │ - Swagger Spec   ││
│                                        │ - Test Files     ││
│                                        │ - Dockerfile     ││
│                                        │ - CI Pipeline    ││
│                                        └──────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## MVP Feature Specification

### ✅ Must Have (MVP)

| Feature | Priority | Notes |
|---------|----------|-------|
| CLI (`init`, `generate`, `--dry-run`) | P0 | Commander.js |
| Parse `.prisma` via `@mrleebo/prisma-ast` | P0 | Community AST parser with stable, documented API |
| Parse `/// @bcm.*` comment directives | P0 | Simple regex |
| Express routes, controllers, services | P0 | EJS templates |
| Zod validation (schema-aware) | P0 | Required = required |
| Swagger/OpenAPI generation | P0 | swagger-jsdoc |
| Pagination, sorting, filtering | P0 | Query builder utility |
| `@bcm.hidden` directive | P0 | Exclude from all inputs and responses |
| `@bcm.readonly` directive | P0 | Exclude from mutations |
| `@bcm.writeOnly` directive | P0 | Accept on write, never return |
| JWT auth middleware scaffold | P0 | Bumped to P0 — unauthenticated APIs are rarely useful |
| CORS middleware | P0 | Required for frontend integration |
| Health check endpoint | P0 | `GET /health` — standard for deployable services |
| RFC 7807 error responses | P0 | Standardized error format |
| Structured logging (Pino) | P0 | Production-ready means observable |
| Rate limiting | P1 | express-rate-limit scaffold |
| Dockerfile + docker-compose | P1 | Modern deployment expects containers |
| GitHub Actions CI template | P1 | Lint, test, build pipeline |
| Faker-based database seed | P1 | `prisma/seed.ts` with realistic data per model |
| Test file example (supertest) | P1 | One example per model |
| Zero-dependency ejectable output | P0 | Core philosophy |

### 🔜 v1.1 (Post-MVP)

| Feature | Notes |
|---------|-------|
| `@bcm.searchable` | Full-text search (database-specific) |
| `@bcm.softDelete` | `deletedAt` timestamp + filtered queries |
| `@bcm.auth(roles: [ADMIN])` | Role-based access control |
| `--watch` mode | Regenerate on schema changes |
| Nested relation handling | `author: { create: {...} }` |
| `bcm.config.js` | Custom templates, naming conventions |
| Framework choice | `--framework express\|fastify\|hono` |
| `bcm eject` command | Strip BCM comments, add bootstrap note |

### 🚀 v2.0 (Future)

| Feature | Notes |
|---------|-------|
| GraphQL generation | Optional alongside REST |
| Plugin system | Custom generators |
| VS Code extension | Schema validation, autocomplete |
| Web playground | Paste schema → preview generated code online |
| Multiple databases | MySQL, SQLite, MongoDB |

---

## Example Usage Flow

### 1. Install the CLI
```bash
npm install -g backend-creator
# or
npx backend-creator init my-api
```

### 2. Define Your Schema
```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Product {
  id          String   @id @default(uuid())
  name        String
  /// @bcm.searchable
  description String?
  price       Float
  stock       Int      @default(0)
  category    Category @relation(fields: [categoryId], references: [id])
  categoryId  String
  /// @bcm.readonly
  createdAt   DateTime @default(now())
}

model Category {
  id       String    @id @default(uuid())
  name     String    @unique
  products Product[]
}
```

### 3. Generate the Backend
```bash
bcm generate --schema ./prisma/schema.prisma --output ./my-backend
cd my-backend
npm install
```

### 4. Run Migrations
```bash
npx prisma migrate dev --name init
```

### 5. Start the Server
```bash
# Option A: Local development
npm run dev
# Server running at http://localhost:3000
# Swagger docs at http://localhost:3000/api/docs

# Option B: Docker
docker-compose up
```

---

## Development Timeline

**Total: 5 Weeks** (adjusted from 4 to account for production scaffolds)

### Week 1: Foundation
- [ ] CLI setup with Commander.js
- [ ] `@mrleebo/prisma-ast` integration for schema parsing
- [ ] Comment directive parser (`/// @bcm.*`)
- [ ] Prisma schema passthrough generation
- [ ] Basic project scaffolding

### Week 2: Core Generation
- [ ] Express routes + controllers templates (EJS)
- [ ] Service layer with Prisma operations
- [ ] Zod validation schemas (schema-aware required/optional)
- [ ] `@bcm.writeOnly` directive with proper PATCH semantics
- [ ] RFC 7807 error handling middleware
- [ ] JWT auth middleware scaffold

### Week 3: API Features & Production Scaffolds
- [ ] Pagination, sorting, filtering utilities
- [ ] `@bcm.hidden`, `@bcm.readonly`, `@bcm.writeOnly` processing
- [ ] CORS middleware configuration
- [ ] Structured logging with Pino
- [ ] Rate limiting middleware
- [ ] Health check endpoint (`GET /health`)
- [ ] Swagger/OpenAPI generation

### Week 4: Deployment & Testing
- [ ] Dockerfile (multi-stage) + docker-compose.yml
- [ ] GitHub Actions CI pipeline template
- [ ] Database seed scaffold (`prisma/seed.ts`)
- [ ] Test file scaffold (supertest per model)
- [ ] `.env.example` + `.gitignore` generation

### Week 5: Polish & Launch
- [ ] `--dry-run` flag implementation
- [ ] CLI error messages, help text, and colors
- [ ] Integration tests for the CLI itself
- [ ] README and documentation
- [ ] NPM package preparation and publish

---

## Target Clients

- **Freelance developers** needing to quickly scaffold client projects
- **Startups** wanting rapid prototyping of backend services
- **Agencies** building multiple similar CRUD backends
- **Backend developers** tired of writing boilerplate
- **Full-stack developers** focusing on frontend, needing quick APIs

---

## Monetization Strategy

| Tier | Features | Price |
|------|----------|-------|
| **Open Source** | Core generation, all MVP directives, JWT auth scaffold, Docker, CI | Free |
| **Pro** | RBAC (`@bcm.auth`), soft delete, `--watch` mode, framework choice, custom templates, priority support | $29/month |
| **Enterprise** | Custom generators, SLA, white-label, dedicated support | Contact |

> **Rationale:** JWT auth scaffold stays in the free tier — unauthenticated APIs are rarely useful, and gating auth makes the free tier feel incomplete. Pro tier gates *advanced* auth (RBAC) and customization features.

---

## Competitive Analysis

| Tool | Type | Lock-in | Code Ownership | Our Advantage |
|------|------|---------|----------------|---------------|
| **Prisma** | ORM only | None | Full | We add API generation + production scaffolds |
| **Strapi** | Headless CMS | High | Partial | We're lightweight, no UI, ejectable |
| **Hasura** | GraphQL engine | High | None | We generate ejectable code |
| **NocoDB** | Spreadsheet API | Medium | None | We're code-first |
| **LoopBack** | Framework | High | Partial | We're not a framework |

**Our Niche:** *"I want to write code, but I don't want to start from scratch."*

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Parser complexity | ~~High~~ **Eliminated** | N/A | Using `@mrleebo/prisma-ast` community parser |
| `@mrleebo/prisma-ast` API changes | Low | Low | Community parser with documented API; breakage is a hard error, not silent |
| Scope creep | Medium | Medium | Strict MVP feature list, 5-week timeline with buffer |
| Prisma major version changes | Low | Medium | Pin dependency versions, monitor Prisma changelogs |
| Competition | Low | Low | Unique "eject" positioning + production-ready scaffolds |
| EJS template complexity | Low | Low | Well-structured template partials, comprehensive test coverage |

---

## Success Metrics (3 months post-launch)

| Metric | Target |
|--------|--------|
| GitHub Stars | 500+ |
| NPM Downloads/week | 200+ |
| Generated Projects | 1,000+ |
| Community PRs | 10+ |

---

## Growth Strategy

1. **Prisma ecosystem listing** — Get listed on [prisma.io/ecosystem](https://www.prisma.io/ecosystem) for organic visibility
2. **Web playground** — "Try it online" page where users paste a Prisma schema and preview generated code instantly
3. **Content marketing** — "Build an API in 30 seconds" demo videos, blog posts comparing setup time vs manual scaffolding
4. **`bcm eject` command** — Reinforces the eject philosophy; strips BCM comments and adds "bootstrapped with BCM" note
5. **Community templates** — Allow users to share and discover custom EJS templates

---

## Why This Project Stands Out

1. **Solves a Real Pain Point:** Every CRUD project starts with the same boilerplate
2. **Developer Experience Focus:** Standard Prisma syntax, instant feedback, great docs
3. **Portfolio Gold:** Demonstrates AST manipulation, code generation, CLI tooling
4. **Ejectable Philosophy:** No lock-in, users own their code completely
5. **Truly Production-Ready:** Not just CRUD — CORS, logging, Docker, CI, health checks, RFC 7807 errors
6. **Extensible Core:** The generation engine can be reused for other frameworks (Fastify, Hono)
7. **Clear Monetization Path:** OSS core with paid premium features

---

## Key Design Decisions

### ✅ Adopted: Standard Prisma Schema
- Use `@mrleebo/prisma-ast` for reliable, documented schema parsing
- Extend with `/// @bcm.*` triple-slash comments
- Free VS Code tooling, no parser development
- Single-parser implementation — no fallback complexity

### ✅ Adopted: Schema-Aware Validation
- Required fields in schema → Required in API
- Optional fields (`?`) → Optional in API
- PATCH is the only "all optional" endpoint
- `@bcm.writeOnly`: accepted on POST/PUT/PATCH, never returned in responses

### ✅ Adopted: Eject Philosophy
- Generated code has zero runtime dependency
- Users can stop using CLI and maintain manually
- Key differentiator vs Strapi/Hasura/NocoDB
- `bcm eject` command for clean separation

### ✅ Adopted: Production-Ready Scaffolds
- JWT auth middleware included in free tier (P0)
- CORS, rate limiting, structured logging (Pino)
- RFC 7807 error responses for API consumers
- Dockerfile + docker-compose for modern deployment
- GitHub Actions CI for automated quality checks

### ✅ Adopted: EJS over Handlebars
- EJS supports arbitrary JS logic in templates
- Better for complex conditional generation (enum handling, relation types, directive processing)
- No need for custom Handlebars helpers

### ✅ Adopted: Auth & Test Scaffolds
- Basic JWT middleware included in MVP (free tier)
- Supertest examples for each model
- Faker-based database seed for immediate developer convenience (`npm run seed` populates realistic data)
- "Production-ready" means testable, observable, and deployable

---

*Last Updated: February 19, 2026*
