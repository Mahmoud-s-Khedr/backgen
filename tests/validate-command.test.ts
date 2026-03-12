import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCommand } from '../src/commands/validate.js';
import { createSchemaWorkspace, createTempWorkspace } from './helpers/test-fs.js';
import { captureConsole, captureStdout, mockProcessExitToThrow } from './helpers/test-io.js';

function readFixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('validateCommand', () => {
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

    it('emits valid JSON payload for a valid schema', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-validate-valid-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(validateCommand({ schema: workspace.schemaPath, json: true }))
                .rejects.toThrow('process.exit(0)');
            const parsed = JSON.parse(stdout.text());
            expect(parsed.valid).toBe(true);
            expect(parsed.errors).toEqual([]);
            expect(Array.isArray(parsed.warnings)).toBe(true);
            expect(parsed.modelCount).toBe(1);
        } finally {
            await workspace.cleanup();
        }
    });

    it('returns non-zero JSON result when validation errors are found', async () => {
        const workspace = await createSchemaWorkspace(readFixture('invalid-rbac.prisma'), 'backgen-validate-invalid-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(validateCommand({ schema: workspace.schemaPath, json: true }))
                .rejects.toThrow('process.exit(1)');

            const parsed = JSON.parse(stdout.text());
            expect(parsed.valid).toBe(false);
            expect(parsed.errors.length).toBeGreaterThan(0);
            expect(parsed.errors.some((e: { message: string }) => e.message.includes('RBAC requires an auth model'))).toBe(true);
        } finally {
            await workspace.cleanup();
        }
    });

    it('returns warning payload without failing when only warnings exist', async () => {
        const workspace = await createSchemaWorkspace(readFixture('warning-hidden-required.prisma'), 'backgen-validate-warning-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(validateCommand({ schema: workspace.schemaPath, json: true }))
                .rejects.toThrow('process.exit(0)');
            const parsed = JSON.parse(stdout.text());
            expect(parsed.valid).toBe(true);
            expect(parsed.errors).toEqual([]);
            expect(parsed.warnings.length).toBeGreaterThan(0);
        } finally {
            await workspace.cleanup();
        }
    });

    it('fails with structured JSON when schema file is missing', async () => {
        const workspace = await createTempWorkspace('backgen-validate-missing-');
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(validateCommand({ schema: workspace.resolve('missing.prisma'), json: true }))
                .rejects.toThrow('process.exit(1)');
            const parsed = JSON.parse(stdout.text());
            expect(parsed.valid).toBe(false);
            expect(parsed.errors[0].message).toContain('Schema file not found');
        } finally {
            await workspace.cleanup();
        }
    });

    it('fails with structured JSON when schema parsing fails', async () => {
        const workspace = await createSchemaWorkspace(
            'datasource db {\n  provider = "postgresql"\n',
            'backgen-validate-parse-fail-'
        );
        const stdout = captureStdout();
        mockProcessExitToThrow();

        try {
            await expect(validateCommand({ schema: workspace.schemaPath, json: true }))
                .rejects.toThrow('process.exit(1)');
            const parsed = JSON.parse(stdout.text());
            expect(parsed.valid).toBe(false);
            expect(parsed.errors[0].message).toContain('Failed to parse Prisma schema');
        } finally {
            await workspace.cleanup();
        }
    });

    it('prints human-readable output in non-JSON mode', async () => {
        const workspace = await createSchemaWorkspace(SIMPLE_SCHEMA, 'backgen-validate-human-');
        const logs = captureConsole('log');

        try {
            await validateCommand({ schema: workspace.schemaPath, json: false });
            expect(logs.text()).toContain('Backend Creator — Validate');
            expect(logs.text()).toContain('Schema is valid');
        } finally {
            await workspace.cleanup();
        }
    });
});
