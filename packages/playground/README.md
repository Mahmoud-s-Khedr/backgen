# Backgen Playground

Monolithic playground package for generating backend output from Prisma schemas by calling the real `bcm` CLI in `--dry-run --json` mode.

## What This Package Owns

- React UI for editing schemas and previewing generated files
- Express server that hosts both the frontend and the generation API
- Request limits and CLI execution guardrails for playground usage

The playground is package-specific documentation. Product usage and directive behavior live in the public docs set under [`/docs`](../../docs/README.md).

## Architecture

- The server exposes `POST /api/generate`.
- Requests are translated into a fixed CLI invocation of the built Backgen binary.
- Responses pass through the CLI JSON payload, including warnings, file previews, and failures.
- The frontend renders generated file trees, source previews, and structured error states.

## Local Development

```bash
# from repo root
npm ci
npm run build

cd packages/playground
npm ci
npm run dev
```

The monolithic server runs at `http://localhost:4173`.

## Production Build

```bash
# build the root CLI first
npm run build

cd packages/playground
npm ci
npm run build
npm run start
```

## API Contract

`POST /api/generate`

Request body:

```json
{
  "schema": "datasource db { ... }",
  "options": {
    "only": "routes"
  }
}
```

Current behavior:

- The playground only exposes supported Backgen options through server code.
- Success responses mirror CLI `--json` success payloads.
- Failure responses mirror CLI `--json` failure payloads, including `error.stage` and `error.message`.

## Security Baseline

- Schema payload cap: `300 KB`
- Response payload cap: `10 MB`
- CLI timeout: `20s`
- In-memory IP rate limit: `30 req/min`
- No arbitrary shell command execution; CLI arguments are fixed by the server
- Logs include request metadata and schema hashes, not raw schema content

## Related Docs

- [Documentation Hub](../../docs/README.md)
- [Usage Guide](../../docs/USAGE.md)
