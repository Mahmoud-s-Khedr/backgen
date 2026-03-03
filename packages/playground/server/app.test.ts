import { describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';

async function withServer<T>(
    runGenerate: ReturnType<typeof vi.fn>,
    cb: (baseUrl: string) => Promise<T>,
    overrides: Partial<Parameters<typeof createApp>[0]> = {}
): Promise<T> {
    const app = createApp({
        cliRunnerConfig: {
            repoRoot: '/repo',
            cliPath: '/repo/dist/generator/cli.js',
            timeoutMs: 20_000,
        },
        runGenerate: runGenerate as NonNullable<Parameters<typeof createApp>[0]['runGenerate']>,
        rateLimitMaxRequests: 30,
        rateLimitWindowMs: 60_000,
        ...overrides,
    });

    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        return await cb(baseUrl);
    } finally {
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
}

describe('playground server app', () => {
    it('returns 400 for empty schema payload', async () => {
        const runGenerate = vi.fn();
        await withServer(runGenerate, async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schema: '' }),
            });
            const body = await res.json() as { error: { message: string } };
            expect(res.status).toBe(400);
            expect(body.error.message).toContain('non-empty string');
            expect(runGenerate).not.toHaveBeenCalled();
        });
    });

    it('returns 413 when schema exceeds size cap', async () => {
        const runGenerate = vi.fn();
        await withServer(runGenerate, async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schema: 'a'.repeat(350 * 1024) }),
            });
            const body = await res.json() as { error: { message: string } };
            expect(res.status).toBe(413);
            expect(body.error.message).toContain('exceeds maximum size');
        });
    });

    it('maps timeout-like CLI failures to 504', async () => {
        const runGenerate = vi.fn().mockResolvedValue({
            success: false,
            error: {
                stage: 'unknown',
                message: 'Generation timed out after 20000ms.',
            },
        });

        await withServer(runGenerate, async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schema: 'model User { id String @id }' }),
            });
            expect(res.status).toBe(504);
        });
    });

    it('returns 429 when request rate exceeds configured threshold', async () => {
        const runGenerate = vi.fn().mockResolvedValue({
            success: true,
            warnings: [],
            modelCount: 1,
            enumCount: 0,
            files: [{ path: 'src/app.ts', content: 'x', sizeBytes: 1 }],
            generatedAt: new Date().toISOString(),
        });

        await withServer(
            runGenerate,
            async (baseUrl) => {
                const payload = JSON.stringify({ schema: 'model User { id String @id }' });
                const first = await fetch(`${baseUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                });
                const second = await fetch(`${baseUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                });

                expect(first.status).toBe(200);
                expect(second.status).toBe(429);
            },
            {
                rateLimitMaxRequests: 1,
                rateLimitWindowMs: 60_000,
            }
        );
    });
});
