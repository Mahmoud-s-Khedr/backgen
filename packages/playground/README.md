# Backend Creator Playground

Monolithic web playground for generating backend files from Prisma schemas using the real `bcm` CLI.

## Architecture

- Express server hosts both API and frontend.
- Generation requests call `dist/generator/cli.js` (`bcm generate --dry-run --json`).
- Frontend calls `POST /api/generate` and renders returned files/warnings/errors.

## Local development

```bash
# from repo root
npm run build

# run monolithic playground server
cd packages/playground
npm install
npm run dev
```

Server starts at `http://localhost:4173`.

## Production build and run

```bash
# build root CLI first
npm run build

# build playground client+server
cd packages/playground
npm run build
npm run start
```

## API

`POST /api/generate`

Request:

```json
{
  "schema": "datasource db { ... }",
  "options": {
    "only": "routes"
  }
}
```

Response is pass-through JSON from CLI mode:

- Success: `success: true` + files + warnings + counts
- Failure: `success: false` + `error.stage` + `error.message`

## Security baseline

- Schema payload cap: `300 KB`
- Response payload cap: `10 MB`
- CLI timeout: `20s`
- In-memory IP rate limit: `30 req/min`
- CLI command and flags are fixed by server code (no arbitrary command execution)
- Structured logs include schema hash and request metadata, never raw schema content
