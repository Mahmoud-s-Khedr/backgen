# Contributing to Backend Creator (bcm)

## Development Setup

```bash
git clone https://github.com/your-org/backgen.git
cd backgen
npm install
```

## Building

```bash
npm run build        # esbuild bundle + copy templates
npm run lint         # tsc --noEmit type checking
```

## Testing

```bash
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
npm run test:coverage
```

## Project Structure

```
src/
├── cli.ts                  # Commander.js entry point
├── commands/               # init, generate, eject commands
├── parser/                 # Prisma schema + directive parsing
│   ├── types.ts            # Core type definitions
│   ├── prisma-ast-parser.ts
│   └── directive-parser.ts
├── generator/              # Code generation engine
│   ├── template-engine.ts  # EJS rendering + helpers
│   ├── index.ts            # Generator orchestrator
│   └── generators/         # Per-concern generators
└── templates/              # EJS templates for generated code
```

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Run `npm run lint` and `npm test`
4. Run `npm run build` and test generation with an example schema
5. Submit a PR with a clear description

## Conventions

- ESM imports throughout (`"type": "module"`)
- Named imports for CJS packages when available
- EJS templates receive `{ model, h: helpers, ... }` — helpers are in `template-engine.ts`
- Generated code must have zero runtime dependency on the CLI
