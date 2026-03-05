import { build } from 'esbuild';
import fs from 'fs-extra';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chmodSync } from 'node:fs';

const scriptDir = typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const distDir = path.join(rootDir, 'dist');
const distGeneratorDir = path.join(distDir, 'generator');
const sourceTemplatesDir = path.join(rootDir, 'src', 'templates');
const distTemplatesDir = path.join(distDir, 'templates');
const packageJsonPath = path.join(rootDir, 'package.json');
const distPackageJsonPath = path.join(distDir, 'package.json');

await fs.remove(distDir);
await fs.ensureDir(distGeneratorDir);

await build({
    entryPoints: [path.join(rootDir, 'src', 'cli.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: path.join(distGeneratorDir, 'cli.js'),
    format: 'esm',
    banner: {
        js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
    },
});

await fs.copy(sourceTemplatesDir, distTemplatesDir);

const packageJson = await fs.readJson(packageJsonPath);
await fs.writeJson(distPackageJsonPath, packageJson, { spaces: 2 });

chmodSync(path.join(distGeneratorDir, 'cli.js'), 0o755);
