# Documentation Hub

Public docs in this repository are maintained against the codebase, templates, generated OpenAPI behavior, and passing tests.

## Start Here

- Read the top-level [README](../README.md) for the product overview and the fastest path to first generation.
- Use [USAGE.md](USAGE.md) for installation, quick start, and exact CLI behavior.
- Use [directives.md](directives.md) when writing or reviewing `/// @bcm.*` schema annotations.

## Page Ownership Map

| Page | Owns | Audience |
|------|------|----------|
| [`../README.md`](../README.md) | Product overview, quick start, canonical example, docs entrypoints | New users |
| [`USAGE.md`](USAGE.md) | Installation, init/generate/validate/eject, JSON output, generated app surface | CLI users |
| [`directives.md`](directives.md) | Directive placement, semantics, validation expectations, directive-specific examples | Schema authors |
| [`advanced.md`](advanced.md) | Composite selectors, nested relations, auth/RBAC shape, caching, uploads, Fastify differences | Users working beyond the happy path |
| [`limitations.md`](limitations.md) | Hard constraints, runtime requirements, caveats, CLI constraints | Users validating fit and rollout assumptions |
| [`generated-code.md`](generated-code.md) | What Backgen writes into a generated project and how the pieces fit together | Users extending generated output |
| [`architecture.md`](architecture.md) | Parser, validator, generator, template engine internals | Contributors and reviewers |
| [`../packages/playground/README.md`](../packages/playground/README.md) | Playground package architecture and local/dev deployment details | Playground contributors |

## Suggested Reading Order

1. [README](../README.md)
2. [USAGE.md](USAGE.md)
3. [directives.md](directives.md)
4. [advanced.md](advanced.md)
5. [limitations.md](limitations.md)

## Notes

- Internal working notes under `docs/internal/` are intentionally separate from the public docs set.
- Portfolio-specific material lives under `docs/portfolio/`.
