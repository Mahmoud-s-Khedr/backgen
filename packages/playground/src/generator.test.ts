import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateFromSchema } from './generator.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('playground generator adapter', () => {
    it('maps successful API responses to generation result', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                warnings: ['warn'],
                modelCount: 2,
                enumCount: 1,
                files: [
                    { path: 'src/app.ts', content: 'export const app = 1;', sizeBytes: 21 },
                ],
                generatedAt: new Date().toISOString(),
                endpointCount: 12,
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateFromSchema('model User { id String @id }');

        expect(fetchMock).toHaveBeenCalledWith('/api/generate', expect.objectContaining({ method: 'POST' }));
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual(['warn']);
        expect(result.modelCount).toBe(2);
        expect(result.files[0].path).toBe('src/app.ts');
        expect(result.files[0].content).toContain('app = 1');
    });

    it('returns structured CLI error messages when API reports failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 422,
            json: async () => ({
                success: false,
                error: {
                    stage: 'generate',
                    message: 'RBAC requires an auth model',
                },
            }),
        }));

        const result = await generateFromSchema('invalid');
        expect(result.files).toEqual([]);
        expect(result.errors[0]).toContain('RBAC requires an auth model');
    });

    it('returns network errors when request fails before response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

        const result = await generateFromSchema('model User { id String @id }');
        expect(result.files).toEqual([]);
        expect(result.errors[0]).toContain('network down');
    });
});
