#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(process.cwd());
const cliPath = resolve(repoRoot, 'dist/generator/cli.js');
const outputPath = resolve(repoRoot, 'assets/screenshots/cli-generate-json-sample.txt');

const schema = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    String @id @default(cuid())
  email String @unique
}
`;

const tempDir = mkdtempSync(join(tmpdir(), 'backgen-portfolio-cli-'));
const schemaPath = join(tempDir, 'schema.prisma');
const outputDir = join(tempDir, 'out');

try {
    writeFileSync(schemaPath, schema, 'utf8');

    const raw = execFileSync(
        process.execPath,
        [
            cliPath,
            'generate',
            '--schema', schemaPath,
            '--output', outputDir,
            '--dry-run',
            '--force',
            '--json',
        ],
        { encoding: 'utf8', cwd: repoRoot }
    ).trim();

    const parsed = JSON.parse(raw);
    const summary = {
        success: parsed.success,
        modelCount: parsed.modelCount,
        enumCount: parsed.enumCount,
        fileCount: Array.isArray(parsed.files) ? parsed.files.length : 0,
        endpointCount: parsed.endpointCount,
        generatedAt: parsed.generatedAt,
        sampleFiles: Array.isArray(parsed.files)
            ? parsed.files.slice(0, 6).map((f) => ({ path: f.path, sizeBytes: f.sizeBytes }))
            : [],
    };

    const content = [
        '# backgen CLI JSON proof sample',
        '',
        'Command:',
        `node dist/generator/cli.js generate --schema <tmp>/schema.prisma --output <tmp>/out --dry-run --force --json`,
        '',
        'Summary JSON:',
        JSON.stringify(summary, null, 2),
        '',
    ].join('\n');

    writeFileSync(outputPath, content, 'utf8');
    console.log(`Wrote ${outputPath}`);
} finally {
    rmSync(tempDir, { recursive: true, force: true });
}
