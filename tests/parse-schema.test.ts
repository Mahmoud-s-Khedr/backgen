import fs from 'fs-extra';
import { describe, expect, it } from 'vitest';
import { parseSchema } from '../src/parser/index.js';
import { parsePrismaAst } from '../src/parser/prisma-ast-parser.js';
import { createTempWorkspace } from './helpers/test-fs.js';

describe('parseSchema', () => {
    it('throws when schema file is empty', async () => {
        const workspace = await createTempWorkspace('backgen-parse-empty-');
        const schemaPath = workspace.resolve('schema.prisma');
        await fs.writeFile(schemaPath, '   \n\n', 'utf8');

        try {
            await expect(parseSchema(schemaPath)).rejects.toThrow(`Schema file is empty: ${schemaPath}`);
        } finally {
            await workspace.cleanup();
        }
    });

    it('wraps parser failures with a clear prefix', async () => {
        const workspace = await createTempWorkspace('backgen-parse-invalid-');
        const schemaPath = workspace.resolve('schema.prisma');
        await fs.writeFile(schemaPath, 'model User { id String @id', 'utf8');

        try {
            await expect(parseSchema(schemaPath)).rejects.toThrow('Failed to parse Prisma schema:');
        } finally {
            await workspace.cleanup();
        }
    });

    it('successfully parses schema content via prisma-ast handoff', async () => {
        const workspace = await createTempWorkspace('backgen-parse-success-');
        const schemaPath = workspace.resolve('schema.prisma');
        const schemaContent = `
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
        await fs.writeFile(schemaPath, schemaContent, 'utf8');

        try {
            const parsedViaFile = await parseSchema(schemaPath);
            const parsedDirect = parsePrismaAst(schemaContent);

            expect(parsedViaFile.models.length).toBe(parsedDirect.models.length);
            expect(parsedViaFile.enums.length).toBe(parsedDirect.enums.length);
            expect(parsedViaFile.datasource.provider).toBe(parsedDirect.datasource.provider);
            expect(parsedViaFile.models[0].name).toBe('User');
            expect(parsedViaFile.models[0].fields.some((field) => field.name === 'email')).toBe(true);
        } finally {
            await workspace.cleanup();
        }
    });
});
