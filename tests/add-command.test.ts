import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCommand } from '../src/commands/add.js';
import { createSchemaWorkspace } from './helpers/test-fs.js';
import { captureConsole, captureStdout, mockProcessExitToThrow } from './helpers/test-io.js';

const BASIC_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    String @id @default(cuid())
  email String @unique
  posts Post[]
}

model Post {
  id       String @id @default(cuid())
  title    String
  userId   String
  author   User   @relation(fields: [userId], references: [id])
}
`;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('bcm add', () => {
    it('generates module files for a single model', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        // Pre-create the output directory (simulating an existing project)
        await fs.ensureDir(ws.outputPath);

        try {
            await addCommand('Post', {
                schema: ws.schemaPath,
                output: ws.outputPath,
            });

            // Should have created the post module
            const moduleDir = `${ws.outputPath}/src/modules/post`;
            expect(await fs.pathExists(moduleDir)).toBe(true);
            expect(await fs.pathExists(`${moduleDir}/post.repository.ts`)).toBe(true);
            expect(await fs.pathExists(`${moduleDir}/post.controller.ts`)).toBe(true);
            expect(await fs.pathExists(`${moduleDir}/post.service.ts`)).toBe(true);
            expect(await fs.pathExists(`${moduleDir}/post.routes.ts`)).toBe(true);
            expect(await fs.pathExists(`${moduleDir}/post.dto.ts`)).toBe(true);
            expect(await fs.pathExists(`${moduleDir}/post.test.ts`)).toBe(true);

            // Should NOT have created user module
            expect(await fs.pathExists(`${ws.outputPath}/src/modules/user`)).toBe(false);
        } finally {
            await ws.cleanup();
        }
    });

    it('aborts if module directory already exists', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(`${ws.outputPath}/src/modules/post`);
        await fs.writeFile(`${ws.outputPath}/src/modules/post/post.service.ts`, 'custom code');

        const exitSpy = mockProcessExitToThrow();
        const errCapture = captureConsole('error');

        try {
            await addCommand('Post', {
                schema: ws.schemaPath,
                output: ws.outputPath,
            });
        } catch {
            // process.exit throws
        }

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errCapture.text()).toContain('already exists');

        // Original file should be untouched
        const content = await fs.readFile(`${ws.outputPath}/src/modules/post/post.service.ts`, 'utf-8');
        expect(content).toBe('custom code');
        await ws.cleanup();
    });

    it('overwrites existing module with --force', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(`${ws.outputPath}/src/modules/post`);
        await fs.writeFile(`${ws.outputPath}/src/modules/post/post.service.ts`, 'old code');

        try {
            await addCommand('Post', {
                schema: ws.schemaPath,
                output: ws.outputPath,
                force: true,
            });

            const content = await fs.readFile(`${ws.outputPath}/src/modules/post/post.service.ts`, 'utf-8');
            expect(content).not.toBe('old code');
            expect(content).toContain('Post');
        } finally {
            await ws.cleanup();
        }
    });

    it('errors when model name is not found in schema', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(ws.outputPath);

        const exitSpy = mockProcessExitToThrow();
        const errCapture = captureConsole('error');

        try {
            await addCommand('Comment', {
                schema: ws.schemaPath,
                output: ws.outputPath,
            });
        } catch {
            // process.exit throws
        }

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errCapture.text()).toContain('not found');
        expect(errCapture.text()).toContain('User');
        expect(errCapture.text()).toContain('Post');
        await ws.cleanup();
    });

    it('handles case-insensitive model name matching', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(ws.outputPath);

        try {
            await addCommand('post', {
                schema: ws.schemaPath,
                output: ws.outputPath,
            });

            expect(await fs.pathExists(`${ws.outputPath}/src/modules/post/post.service.ts`)).toBe(true);
        } finally {
            await ws.cleanup();
        }
    });

    it('produces JSON output with --json', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(ws.outputPath);

        const stdout = captureStdout();

        try {
            await addCommand('Post', {
                schema: ws.schemaPath,
                output: ws.outputPath,
                json: true,
            });

            const result = JSON.parse(stdout.text());
            expect(result.success).toBe(true);
            expect(result.model).toBe('Post');
            expect(result.files).toHaveLength(6);
            expect(result.files.map((f: { path: string }) => f.path)).toContain('src/modules/post/post.service.ts');
        } finally {
            await ws.cleanup();
        }
    });

    it('produces JSON error when model not found with --json', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(ws.outputPath);

        const stdout = captureStdout();
        const exitSpy = mockProcessExitToThrow();

        try {
            await addCommand('Nope', {
                schema: ws.schemaPath,
                output: ws.outputPath,
                json: true,
            });
        } catch {
            // process.exit throws
        }

        const result = JSON.parse(stdout.text());
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
        await ws.cleanup();
    });

    it('aborts when a model needs non-module generated files', async () => {
        const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.audit
/// @bcm.rateLimit(max: 5, window: "30s")
model AuditEntry {
  id      String @id @default(cuid())
  message String
}
`;
        const ws = await createSchemaWorkspace(schema);
        await fs.ensureDir(ws.outputPath);

        const exitSpy = mockProcessExitToThrow();
        const errCapture = captureConsole('error');

        try {
            await addCommand('AuditEntry', {
                schema: ws.schemaPath,
                output: ws.outputPath,
            });
        } catch {
            // process.exit throws
        }

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errCapture.text()).toContain('cannot be added safely with bcm add');
        expect(errCapture.text()).toContain('--only middleware');
        expect(errCapture.text()).toContain('--only utils');
        expect(errCapture.text()).toContain('--only prisma');
        expect(await fs.pathExists(`${ws.outputPath}/src/modules/auditEntry`)).toBe(false);

        await ws.cleanup();
    });
});
