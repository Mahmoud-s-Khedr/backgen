import { describe, expect, it } from 'vitest';
import { buildMetadataFile, buildZipFileName } from './zip.js';
import type { GenerationResult } from './generator.js';

const result: GenerationResult = {
    files: [
        { path: 'src/app.ts', content: 'export const app = 1;' },
        { path: 'prisma/schema.prisma', content: 'model User { id String @id }' },
    ],
    warnings: ['Example warning'],
    errors: [],
    modelCount: 1,
    enumCount: 0,
};

describe('zip helpers', () => {
    it('builds metadata file content', () => {
        const date = new Date('2026-02-22T12:00:00.000Z');
        const metadata = buildMetadataFile(result, date);
        expect(metadata.path).toBe('GENERATED_BY_BACKEND_CREATOR.md');
        expect(metadata.content).toContain('2026-02-22T12:00:00.000Z');
        expect(metadata.content).toContain('Models: 1');
        expect(metadata.content).toContain('- Example warning');
    });

    it('creates deterministic zip file name', () => {
        const date = new Date('2026-02-22T09:08:07.000Z');
        expect(buildZipFileName(date)).toBe('backend-creator-20260222-090807.zip');
    });
});
