import fs from 'fs-extra';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    computeCrudEndpointCount,
    createJsonFailureResult,
    createJsonSuccessResult,
    generateCommand,
} from '../src/commands/generate.js';
import { generateProject } from '../src/generator/index.js';
import { parsePrismaAst } from '../src/parser/prisma-ast-parser.js';
import { createSchemaWorkspace, createTempWorkspace } from './helpers/test-fs.js';
import { captureConsole, captureStdout, mockProcessExitToThrow } from './helpers/test-io.js';

function readFixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('computeCrudEndpointCount', () => {
    it('counts 6 endpoints per model when all models have item selectors', () => {
        const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  email String @unique
}

model Post {
  id String @id @default(cuid())
  title String
}
`;
        const schema = parsePrismaAst(raw);
        expect(computeCrudEndpointCount(schema.models)).toBe(12);
    });

    it('counts 2 endpoints for models without item selectors', () => {
        const schema = parsePrismaAst(readFixture('no-selector.prisma'));
        expect(computeCrudEndpointCount(schema.models)).toBe(2);
    });

    it('counts mixed selector/no-selector models accurately', () => {
        const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
}

model EventLog {
  message String
}
`;
        const schema = parsePrismaAst(raw);
        expect(computeCrudEndpointCount(schema.models)).toBe(8);
    });
});

describe('CLI JSON helpers', () => {
    it('builds success payload with file content and endpoint count', () => {
        const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
}
`;
        const parsed = parsePrismaAst(raw);
        const payload = createJsonSuccessResult(
            parsed,
            [{ path: 'src/a.ts', content: 'export const a = 1;' }],
            {}
        );

        expect(payload.success).toBe(true);
        expect(payload.files[0].content).toContain('export const a = 1;');
        expect(payload.files[0].sizeBytes).toBeGreaterThan(0);
        expect(payload.endpointCount).toBe(6);
    });

    it('omits endpointCount when --only is used', () => {
        const parsed = parsePrismaAst(readFixture('auth.prisma'));
        const payload = createJsonSuccessResult(
            parsed,
            [{ path: 'openapi.json', content: '{}' }],
            { only: 'swagger' }
        );

        expect(payload.success).toBe(true);
        expect(payload.endpointCount).toBeUndefined();
    });

    it('builds failure payload with stage and message', () => {
        const payload = createJsonFailureResult('generate', 'boom');
        expect(payload).toEqual({
            success: false,
            error: {
                stage: 'generate',
                message: 'boom',
            },
        });
    });
});

describe('generateCommand contracts', () => {
    const SIMPLE_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  email String @unique
}
`;

    it('returns parse-stage JSON error when schema path is missing', async () => {
        const workspace = await createTempWorkspace('backgen-cli-missing-schema-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(generateCommand({
                schema: workspace.resolve('does-not-exist.prisma'),
                output: workspace.resolve('out'),
                dryRun: true,
                force: true,
                json: true,
            })).rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(false);
            expect(parsed.error.stage).toBe('parse');
            expect(parsed.error.message).toContain('Schema file not found');
        } finally {
            await workspace.cleanup();
        }
    });

    it('returns write-stage JSON error when output directory is non-empty without --force', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-write-precheck-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        await fs.ensureDir(workspace.outputPath);
        await fs.writeFile(path.join(workspace.outputPath, 'README.keep'), 'keep me', 'utf8');

        try {
            await expect(generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: false,
                force: false,
                json: true,
            })).rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(false);
            expect(parsed.error.stage).toBe('write');
            expect(parsed.error.message).toContain('is not empty');
        } finally {
            await workspace.cleanup();
        }
    });

    it('returns success JSON with expected payload invariants in dry-run mode', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-dryrun-json-');
        const stdout = captureStdout();

        try {
            await generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: true,
                force: true,
                json: true,
            });

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(true);
            expect(parsed.modelCount).toBe(1);
            expect(parsed.files.length).toBeGreaterThan(0);
            expect(parsed.endpointCount).toBe(6);
            expect(typeof parsed.generatedAt).toBe('string');
            expect(Number.isNaN(new Date(parsed.generatedAt).getTime())).toBe(false);

            for (const file of parsed.files) {
                expect(typeof file.path).toBe('string');
                expect(file.path.length).toBeGreaterThan(0);
                expect(typeof file.content).toBe('string');
                expect(typeof file.sizeBytes).toBe('number');
                expect(file.sizeBytes).toBe(Buffer.byteLength(file.content, 'utf8'));
            }
        } finally {
            await workspace.cleanup();
        }
    });

    it('omits endpointCount in JSON success payload when --only is used', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-only-json-');
        const stdout = captureStdout();

        try {
            await generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: true,
                force: true,
                only: 'routes',
                json: true,
            });

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(true);
            expect(parsed.endpointCount).toBeUndefined();
            expect(parsed.files.some((file: { path: string }) => file.path.includes('/'))).toBe(true);
        } finally {
            await workspace.cleanup();
        }
    });

    it('returns structured JSON error and exits non-zero for invalid schema', async () => {
        const workspace = await createSchemaWorkspace(readFixture('invalid-rbac.prisma'), 'backgen-cli-invalid-rbac-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: true,
                force: true,
                json: true,
            })).rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(false);
            expect(parsed.error.stage).toBe('generate');
            expect(parsed.error.message).toContain('RBAC requires an auth model');
        } finally {
            await workspace.cleanup();
        }
    });

    it('returns generate-stage JSON error for unknown --only value', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-invalid-only-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: true,
                force: true,
                only: 'invalid',
                json: true,
            })).rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(false);
            expect(parsed.error.stage).toBe('generate');
            expect(parsed.error.message).toContain('Unknown --only value');
        } finally {
            await workspace.cleanup();
        }
    });

    it('keeps human-readable dry-run output when JSON mode is disabled', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-human-output-');
        const logs = captureConsole('log');

        try {
            await generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: true,
                force: true,
                json: false,
            });
            const output = logs.text();
            expect(output).toContain('Dry run');
            expect(output).toContain('Backend Creator');
        } finally {
            await workspace.cleanup();
        }
    });

    it('allows --only generation into a non-empty directory when targeted files are identical', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-only-identical-');
        const schema = parsePrismaAst(SIMPLE_SCHEMA);
        const generatedFiles = await generateProject(schema, {
            schema: workspace.schemaPath,
            output: workspace.outputPath,
            dryRun: false,
            force: false,
            only: 'routes',
        }, SIMPLE_SCHEMA);

        const routeFile = generatedFiles.find((file) => file.path === 'src/modules/user/user.controller.ts');
        expect(routeFile).toBeDefined();
        const targetedPath = path.join(workspace.outputPath, routeFile!.path);
        const unrelatedPath = path.join(workspace.outputPath, 'README.keep');
        await fs.ensureDir(path.dirname(targetedPath));
        await fs.writeFile(targetedPath, routeFile!.content, 'utf8');
        await fs.writeFile(unrelatedPath, 'keep me', 'utf8');

        const logs = captureConsole('log');

        try {
            await generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: false,
                force: false,
                only: 'routes',
                json: false,
            });

            expect(logs.lines.length).toBeGreaterThan(0);
            expect(await fs.readFile(unrelatedPath, 'utf8')).toBe('keep me');
        } finally {
            await workspace.cleanup();
        }
    });

    it('returns write-stage conflict error when --only would overwrite different files without --force', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-only-conflict-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        await fs.ensureDir(path.join(workspace.outputPath, 'src/modules/user'));
        await fs.writeFile(path.join(workspace.outputPath, 'src/modules/user/user.controller.ts'), '// manual edit\n', 'utf8');

        try {
            await expect(generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: false,
                force: false,
                only: 'routes',
                json: true,
            })).rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(false);
            expect(parsed.error.stage).toBe('write');
            expect(parsed.error.message).toContain('Refusing to overwrite existing files for --only without --force');
            expect(parsed.error.message).toContain('src/modules/user/user.controller.ts');
        } finally {
            await workspace.cleanup();
        }
    });

    it('overwrites only targeted files with --force and leaves unrelated files untouched', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-cli-only-force-');
        const stdout = captureStdout();

        const schema = parsePrismaAst(SIMPLE_SCHEMA);
        const generatedFiles = await generateProject(schema, {
            schema: workspace.schemaPath,
            output: workspace.outputPath,
            dryRun: false,
            force: true,
            only: 'routes',
        }, SIMPLE_SCHEMA);

        const routeFile = generatedFiles.find((file) => file.path === 'src/modules/user/user.controller.ts');
        expect(routeFile).toBeDefined();

        const targetedPath = path.join(workspace.outputPath, routeFile!.path);
        const unrelatedPath = path.join(workspace.outputPath, 'notes.txt');
        await fs.ensureDir(path.dirname(targetedPath));
        await fs.writeFile(targetedPath, '// stale version\n', 'utf8');
        await fs.writeFile(unrelatedPath, 'do not touch', 'utf8');

        try {
            await generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: false,
                force: true,
                only: 'routes',
                json: true,
            });

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(true);
            expect(await fs.readFile(targetedPath, 'utf8')).toBe(routeFile!.content);
            expect(await fs.readFile(unrelatedPath, 'utf8')).toBe('do not touch');
        } finally {
            await workspace.cleanup();
        }
    });

    it('keeps JSON contract stable when generation succeeds with warnings', async () => {
        const workspace = await createSchemaWorkspace(readFixture('warning-hidden-required.prisma'), 'backgen-cli-warning-contract-');
        const stdout = captureStdout();

        try {
            await generateCommand({
                schema: workspace.schemaPath,
                output: workspace.outputPath,
                dryRun: true,
                force: true,
                json: true,
            });

            const parsed = JSON.parse(stdout.text());
            expect(parsed.success).toBe(true);
            expect(Array.isArray(parsed.warnings)).toBe(true);
            expect(parsed.warnings.some((warning: string) => warning.includes('required but marked @bcm.hidden'))).toBe(true);
            expect(typeof parsed.generatedAt).toBe('string');
            expect(parsed.files.length).toBeGreaterThan(0);
        } finally {
            await workspace.cleanup();
        }
    });
});
