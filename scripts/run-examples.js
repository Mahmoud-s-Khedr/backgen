#!/usr/bin/env node
import { execSync } from 'child_process';
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const examplesDir = join(root, 'examples');
const outDir = join(root, 'out');
const cli = join(root, 'dist', 'generator', 'cli.js');

// Remove and recreate out/
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);

const schemas = readdirSync(examplesDir)
  .filter(f => f.endsWith('.prisma'))
  .sort();

let passed = 0;
let failed = 0;

function run(cmd, cwd) {
  execSync(cmd, { stdio: 'pipe', cwd });
}

for (const schema of schemas) {
  const name = basename(schema, '.prisma');
  const outputDir = join(outDir, name);
  const schemaPath = join(examplesDir, schema);

  const schemaText = readFileSync(schemaPath, 'utf8');
  const providerMatch = schemaText.match(/provider\s*=\s*["'](\w+)["']/);
  const provider = providerMatch?.[1] ?? 'unknown';

  console.log(`\n  ${name}`);
  let ok = true;

  const steps = [
    { label: 'generate',       cmd: () => run(`node ${cli} generate --schema ${schemaPath} --output ${outputDir}`, root) },
    { label: 'pnpm install',   cmd: () => run('pnpm install', outputDir) },
    { label: 'cp .env',        cmd: () => run('cp .env.example .env', outputDir) },
    { label: 'prisma migrate', cmd: () => run(
      provider === 'sqlite'
        ? 'npx prisma migrate dev --name init'
        : 'npx prisma db push --force-reset',
      outputDir
    ) },
    { label: 'npm run build',  cmd: () => run('npm run build', outputDir) },
  ];

  for (const step of steps) {
    process.stdout.write(`    ${step.label.padEnd(16)} ... `);
    if (step.skip) {
      console.log(`skipped (${step.skip})`);
      continue;
    }
    try {
      step.cmd();
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      const msg = err.stderr?.toString().trim() ?? err.message;
      if (msg) console.error(msg.split('\n').map(l => '      ' + l).join('\n'));
      ok = false;
      break;
    }
  }

  ok ? passed++ : failed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
