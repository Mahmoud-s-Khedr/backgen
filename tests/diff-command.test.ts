import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diffCommand } from '../src/commands/diff.js';
import { generateCommand } from '../src/commands/generate.js';
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
}
`;

const EXTENDED_SCHEMA = `
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
  name  String
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

/** Helper: generate a project to disk from a schema */
async function generateToDisk(schemaPath: string, outputPath: string): Promise<void> {
    // Suppress console output during generation
    const logSpy = captureConsole('log');
    const warnSpy = captureConsole('warn');
    await generateCommand({
        schema: schemaPath,
        output: outputPath,
        dryRun: false,
        force: true,
        framework: 'express',
    });
    logSpy.spy.mockRestore();
    warnSpy.spy.mockRestore();
}

describe('bcm diff', () => {
    it('reports all files as new when output directory is empty', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        // Create empty output directory
        await fs.ensureDir(ws.outputPath);

        const stdout = captureStdout();

        try {
            await diffCommand({
                schema: ws.schemaPath,
                output: ws.outputPath,
                json: true,
            });

            const result = JSON.parse(stdout.text());
            expect(result.new.length).toBeGreaterThan(0);
            expect(result.modified).toHaveLength(0);
            expect(result.identical).toHaveLength(0);
        } finally {
            await ws.cleanup();
        }
    });

    it('reports all files as identical when nothing changed', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await generateToDisk(ws.schemaPath, ws.outputPath);

        const stdout = captureStdout();

        try {
            await diffCommand({
                schema: ws.schemaPath,
                output: ws.outputPath,
                json: true,
            });

            const result = JSON.parse(stdout.text());
            expect(result.new).toHaveLength(0);
            expect(result.modified).toHaveLength(0);
            expect(result.identical.length).toBeGreaterThan(0);
        } finally {
            await ws.cleanup();
        }
    });

    it('detects modified files when disk content differs', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await generateToDisk(ws.schemaPath, ws.outputPath);

        // Manually modify a generated file
        const servicePath = path.join(ws.outputPath, 'src/modules/user/user.service.ts');
        await fs.appendFile(servicePath, '\n// custom modification\n');

        const stdout = captureStdout();

        try {
            await diffCommand({
                schema: ws.schemaPath,
                output: ws.outputPath,
                json: true,
            });

            const result = JSON.parse(stdout.text());
            expect(result.modified.length).toBeGreaterThan(0);
            const modifiedPaths = result.modified.map((f: { path: string }) => f.path);
            expect(modifiedPaths).toContain('src/modules/user/user.service.ts');

            // Modified entries should have hunks
            const serviceDiff = result.modified.find(
                (f: { path: string }) => f.path === 'src/modules/user/user.service.ts'
            );
            expect(serviceDiff.hunks).toContain('custom modification');
        } finally {
            await ws.cleanup();
        }
    });

    it('detects new files when schema adds a model', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await generateToDisk(ws.schemaPath, ws.outputPath);

        // Now write extended schema and diff against existing output
        await fs.writeFile(ws.schemaPath, EXTENDED_SCHEMA, 'utf-8');

        const stdout = captureStdout();

        try {
            await diffCommand({
                schema: ws.schemaPath,
                output: ws.outputPath,
                json: true,
            });

            const result = JSON.parse(stdout.text());
            // Post module files should be new
            const newPaths = result.new as string[];
            expect(newPaths.some((p: string) => p.includes('modules/post/'))).toBe(true);
        } finally {
            await ws.cleanup();
        }
    });

    it('detects orphaned modules not in schema', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await generateToDisk(ws.schemaPath, ws.outputPath);

        // Create an orphaned module directory
        await fs.ensureDir(path.join(ws.outputPath, 'src/modules/deletedModel'));
        await fs.writeFile(
            path.join(ws.outputPath, 'src/modules/deletedModel/deletedModel.service.ts'),
            'orphaned'
        );

        const stdout = captureStdout();

        try {
            await diffCommand({
                schema: ws.schemaPath,
                output: ws.outputPath,
                json: true,
            });

            const result = JSON.parse(stdout.text());
            expect(result.orphaned).toContain('src/modules/deletedModel/');
        } finally {
            await ws.cleanup();
        }
    });

    it('outputs human-readable summary without --json', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(ws.outputPath);

        const logCapture = captureConsole('log');

        try {
            await diffCommand({
                schema: ws.schemaPath,
                output: ws.outputPath,
            });

            const output = logCapture.text();
            expect(output).toContain('new file');
        } finally {
            await ws.cleanup();
        }
    });

    it('errors when schema file does not exist', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);
        await fs.ensureDir(ws.outputPath);

        const exitSpy = mockProcessExitToThrow();
        const errCapture = captureConsole('error');

        try {
            await diffCommand({
                schema: '/nonexistent/schema.prisma',
                output: ws.outputPath,
            });
        } catch {
            // process.exit throws
        }

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errCapture.text()).toContain('not found');
        await ws.cleanup();
    });

    it('errors when output directory does not exist', async () => {
        const ws = await createSchemaWorkspace(BASIC_SCHEMA);

        const exitSpy = mockProcessExitToThrow();
        const errCapture = captureConsole('error');

        try {
            await diffCommand({
                schema: ws.schemaPath,
                output: '/nonexistent/output',
            });
        } catch {
            // process.exit throws
        }

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errCapture.text()).toContain('not found');
        await ws.cleanup();
    });
});
