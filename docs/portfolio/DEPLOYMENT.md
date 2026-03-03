# Deployment Blueprint (Render)

This document describes how to deploy the monolithic CLI-backed playground as a single web service on Render.

## Target Architecture
- One Render Web Service.
- Node runtime.
- Express server (`packages/playground/server/index.ts`) serves both:
  - static client build (`dist/client`)
  - API endpoint (`POST /api/generate`) that executes the real CLI.

## Required Build Order
The playground server depends on `dist/generator/cli.js` from root build.

### Build Command
```bash
npm ci
npm run build
npm --prefix packages/playground ci
npm --prefix packages/playground run build
```

### Start Command
```bash
npm --prefix packages/playground run start
```

## Environment
Set these in Render:
- `NODE_ENV=production`
- `PORT` is injected by Render automatically.

## Health and Smoke Checks
### Health endpoint
```bash
GET /health
```
Expected:
```json
{ "ok": true }
```

### Generation endpoint smoke test
```bash
POST /api/generate
Content-Type: application/json

{
  "schema": "datasource db { provider = \"postgresql\" url = env(\"DATABASE_URL\") }\n\ngenerator client { provider = \"prisma-client-js\" }\n\nmodel User { id String @id @default(cuid()) email String @unique }"
}
```
Expected: `200` with `success: true` and generated `files[]`.

## Security Baseline (Current)
- schema max payload: 300 KB
- response max payload: 10 MB
- CLI timeout: 20s
- in-memory rate limit: 30 requests/minute/IP

## Notes
- This deployment is suitable for demo/portfolio usage.
- For heavy public traffic, move to external rate-limiter store and process isolation strategy.
