# CV / Portfolio Bullets (Mahmoud Khedr)

## 1-line Project Summary
Built **Backgen**, a Prisma-driven backend code generator that produces production-ready Express + TypeScript APIs with validation, auth scaffolding, OpenAPI docs, and provider-aware infrastructure.

## Backend Engineer Bullets (Primary)
- Designed and implemented a schema-to-backend generation engine that converts Prisma models and custom directives into typed controllers, services, DTOs, routes, and test scaffolds.
- Added fail-fast schema validation to prevent invalid generation states early, reducing runtime failure risk in generated APIs.
- Implemented selector-aware and nested-relation-aware generation logic (including composite selectors) to ensure correctness across advanced relational data models.
- Built and validated a CLI JSON mode consumed by a monolithic web playground API, creating a single canonical generation path across CLI and UI.
- Strengthened reliability with automated test coverage across parser, generator, command layer, and playground server adapters.

## Full-Stack Variant
- Built a full-stack developer tool combining a TypeScript CLI generator and a web playground UI for interactive schema-to-backend generation.
- Delivered a responsive React playground with file preview/download workflows and server-backed generation through the real CLI execution path.
- Implemented an Express API layer with input validation, timeout/rate limiting, and structured error mapping for public-demo readiness.

## DevTools Variant
- Engineered a directive-driven code generation platform that enforces schema contracts and emits production scaffolding from declarative Prisma source models.
- Standardized machine-readable generation output (`--json`) to support tool integration, preview pipelines, and deterministic proof artifacts.
- Created reproducible automation around generation checks, examples matrix validation, and CI-backed quality gates.

## ATS Keywords
TypeScript, Node.js, Express.js, Prisma, Zod, OpenAPI, Code Generation, CLI Tools, AST Parsing, Backend Architecture, API Design, RBAC, JWT, Docker, CI/CD, Testing, Vitest, Developer Experience, Monorepo Tooling.

## Arabic Short Bullets (للسيرة الذاتية)
- طورت أداة **Backgen** لتوليد Backend جاهز للإنتاج تلقائيًا من مخططات Prisma.
- بنيت نظام توليد يعتمد على directives مع تحقق صارم (fail-fast) لتقليل أخطاء التشغيل.
- نفذت Playground ويب يعتمد على نفس مسار CLI الفعلي لضمان الاتساق بين الواجهة والأداة.
