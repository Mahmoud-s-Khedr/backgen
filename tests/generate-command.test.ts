import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
    computeCrudEndpointCount,
    createJsonFailureResult,
    createJsonSuccessResult,
    generateCommand,
} from '../src/commands/generate.js';
import { generateProject } from '../src/generator/index.js';
import { parsePrismaAst } from '../src/parser/prisma-ast-parser.js';

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
        const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model EventLog {
  message String
  createdAt DateTime @default(now())
}
`;
        const schema = parsePrismaAst(raw);
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

describe('generateCommand JSON mode', () => {
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

    async function makeTempSchema(schema: string): Promise<{ schemaPath: string; outputPath: string; cleanup: () => Promise<void> }> {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backgen-cli-test-'));
        const schemaPath = path.join(tmpDir, 'schema.prisma');
        const outputPath = path.join(tmpDir, 'out');
        await fs.writeFile(schemaPath, schema, 'utf8');

        return {
            schemaPath,
            outputPath,
            cleanup: async () => {
                await fs.remove(tmpDir);
            },
        };
    }

    it('returns success JSON with files for valid schema in dry-run mode', async () => {
        const valid = `
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
        const { schemaPath, outputPath, cleanup } = await makeTempSchema(valid);
        const stdoutChunks: string[] = [];
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
            return true;
        }) as never);

        try {
            await generateCommand({
                schema: schemaPath,
                output: outputPath,
                dryRun: true,
                force: true,
                json: true,
            });

            expect(stdoutSpy).toHaveBeenCalled();
            const parsed = JSON.parse(stdoutChunks.join('').trim());
            expect(parsed.success).toBe(true);
            expect(parsed.files.length).toBeGreaterThan(0);
            expect(parsed.files[0].content).toBeTypeOf('string');
            expect(parsed.modelCount).toBe(1);
        } finally {
            await cleanup();
        }
    });

    it('returns structured JSON error and exits non-zero for invalid schema', async () => {
        const invalid = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.auth(roles: [ADMIN])
model Post {
  id String @id @default(cuid())
  title String
}
`;
        const { schemaPath, outputPath, cleanup } = await makeTempSchema(invalid);
        const stdoutChunks: string[] = [];
        vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
            return true;
        }) as never);
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit(${code ?? 0})`);
        }) as never);

        try {
            await expect(generateCommand({
                schema: schemaPath,
                output: outputPath,
                dryRun: true,
                force: true,
                json: true,
            })).rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdoutChunks.join('').trim());
            expect(parsed.success).toBe(false);
            expect(parsed.error.stage).toBe('generate');
            expect(parsed.error.message).toContain('RBAC requires an auth model');
        } finally {
            await cleanup();
        }
    });

    it('keeps human-readable dry-run output when JSON mode is disabled', async () => {
        const valid = `
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
        const { schemaPath, outputPath, cleanup } = await makeTempSchema(valid);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await generateCommand({
                schema: schemaPath,
                output: outputPath,
                dryRun: true,
                force: true,
                json: false,
            });
            const output = logSpy.mock.calls.flat().map(String).join('\n');
            expect(output).toContain('Dry run');
            expect(output).toContain('Backend Creator');
        } finally {
            await cleanup();
        }
    });

    it('allows --only generation into a non-empty directory when targeted files are identical', async () => {
        const { schemaPath, outputPath, cleanup } = await makeTempSchema(SIMPLE_SCHEMA);
        const schema = parsePrismaAst(SIMPLE_SCHEMA);
        const generatedFiles = await generateProject(schema, {
            schema: schemaPath,
            output: outputPath,
            dryRun: false,
            force: false,
            only: 'routes',
        }, SIMPLE_SCHEMA);
        const routeFile = generatedFiles.find((file) => file.path === 'src/modules/user/user.controller.ts')!;
        const unrelatedPath = path.join(outputPath, 'README.keep');

        await fs.ensureDir(path.dirname(path.join(outputPath, routeFile.path)));
        await fs.writeFile(path.join(outputPath, routeFile.path), routeFile.content, 'utf8');
        await fs.writeFile(unrelatedPath, 'keep me', 'utf8');

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await generateCommand({
                schema: schemaPath,
                output: outputPath,
                dryRun: false,
                force: false,
                only: 'routes',
                json: false,
            });

            expect(logSpy).toHaveBeenCalled();
            expect(await fs.readFile(unrelatedPath, 'utf8')).toBe('keep me');
        } finally {
            await cleanup();
        }
    });

    it('returns a structured write error when --only would overwrite different files without --force', async () => {
        const { schemaPath, outputPath, cleanup } = await makeTempSchema(SIMPLE_SCHEMA);
        const stdoutChunks: string[] = [];
        vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
            return true;
        }) as never);
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit(${code ?? 0})`);
        }) as never);

        await fs.ensureDir(path.join(outputPath, 'src/modules/user'));
        await fs.writeFile(path.join(outputPath, 'src/modules/user/user.controller.ts'), '// manual edit\n', 'utf8');

        try {
            await expect(generateCommand({
                schema: schemaPath,
                output: outputPath,
                dryRun: false,
                force: false,
                only: 'routes',
                json: true,
            })).rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdoutChunks.join('').trim());
            expect(parsed.success).toBe(false);
            expect(parsed.error.stage).toBe('write');
            expect(parsed.error.message).toContain('Refusing to overwrite existing files for --only without --force');
            expect(parsed.error.message).toContain('src/modules/user/user.controller.ts');
        } finally {
            await cleanup();
        }
    });

    it('overwrites only targeted files with --force and leaves unrelated files untouched', async () => {
        const { schemaPath, outputPath, cleanup } = await makeTempSchema(SIMPLE_SCHEMA);
        const stdoutChunks: string[] = [];
        vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
            return true;
        }) as never);

        const schema = parsePrismaAst(SIMPLE_SCHEMA);
        const generatedFiles = await generateProject(schema, {
            schema: schemaPath,
            output: outputPath,
            dryRun: false,
            force: true,
            only: 'routes',
        }, SIMPLE_SCHEMA);
        const routeFile = generatedFiles.find((file) => file.path === 'src/modules/user/user.controller.ts')!;
        const unrelatedPath = path.join(outputPath, 'notes.txt');
        const targetedPath = path.join(outputPath, routeFile.path);

        await fs.ensureDir(path.dirname(targetedPath));
        await fs.writeFile(targetedPath, '// stale version\n', 'utf8');
        await fs.writeFile(unrelatedPath, 'do not touch', 'utf8');

        try {
            await generateCommand({
                schema: schemaPath,
                output: outputPath,
                dryRun: false,
                force: true,
                only: 'routes',
                json: true,
            });

            const parsed = JSON.parse(stdoutChunks.join('').trim());
            expect(parsed.success).toBe(true);
            expect(await fs.readFile(targetedPath, 'utf8')).toBe(routeFile.content);
            expect(await fs.readFile(unrelatedPath, 'utf8')).toBe('do not touch');
        } finally {
            await cleanup();
        }
    });
});
