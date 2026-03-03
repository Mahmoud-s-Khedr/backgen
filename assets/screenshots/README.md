# Screenshot & Proof Assets

This folder stores portfolio proof artifacts used in the root `README.md`.

## Files

- `playground-light-desktop.png`
- `playground-dark-desktop.png`
- `playground-mobile.png`
- `cli-generate-json-sample.txt`

## Regenerate

From repo root:

```bash
npm run portfolio:shots
```

This runs:
1. `scripts/capture-playground-screenshots.mjs`
2. `scripts/capture-cli-proof.mjs`

## Notes

- Screenshots are generated from the monolithic playground server (`packages/playground`).
- The CLI proof sample is generated from the real bundled CLI (`dist/generator/cli.js`).
- Visual artifacts are committed to keep README previews deterministic.
