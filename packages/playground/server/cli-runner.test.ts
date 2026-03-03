import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { runCliGenerate } from './cli-runner.js';

function createMockChild(): ChildProcessWithoutNullStreams {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    (child as unknown as { stdout: PassThrough }).stdout = new PassThrough();
    (child as unknown as { stderr: PassThrough }).stderr = new PassThrough();
    (child as unknown as { kill: ReturnType<typeof vi.fn> }).kill = vi.fn().mockReturnValue(true);
    return child;
}

describe('runCliGenerate', () => {
    it('parses CLI JSON success and always cleans temporary directory', async () => {
        const child = createMockChild();
        const rmMock = vi.fn().mockResolvedValue(undefined);

        const spawnMock = vi.fn(() => {
            setTimeout(() => {
                child.stdout.emit('data', Buffer.from(JSON.stringify({
                    success: true,
                    warnings: [],
                    modelCount: 1,
                    enumCount: 0,
                    files: [{ path: 'src/app.ts', content: 'x', sizeBytes: 1 }],
                    generatedAt: new Date().toISOString(),
                })));
                child.emit('close', 0, null);
            }, 0);
            return child;
        });

        const result = await runCliGenerate(
            { schema: 'model User { id String @id }' },
            { repoRoot: '/repo', cliPath: '/repo/dist/generator/cli.js', timeoutMs: 1000 },
            {
                accessImpl: vi.fn().mockResolvedValue(undefined),
                mkdtempImpl: vi.fn().mockResolvedValue('/tmp/backgen-playground-abc'),
                writeFileImpl: vi.fn().mockResolvedValue(undefined),
                rmImpl: rmMock,
                spawnImpl: spawnMock,
            }
        );

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.files[0].path).toBe('src/app.ts');
        }
        expect(rmMock).toHaveBeenCalledWith('/tmp/backgen-playground-abc', { recursive: true, force: true });
    });

    it('kills long-running CLI process and returns timeout failure', async () => {
        const child = createMockChild();
        const killMock = vi.fn().mockImplementation(() => {
            setTimeout(() => {
                child.emit('close', 1, null);
            }, 0);
            return true;
        });
        (child as unknown as { kill: typeof killMock }).kill = killMock;

        const spawnMock = vi.fn(() => child);

        const result = await runCliGenerate(
            { schema: 'model User { id String @id }' },
            { repoRoot: '/repo', cliPath: '/repo/dist/generator/cli.js', timeoutMs: 5 },
            {
                accessImpl: vi.fn().mockResolvedValue(undefined),
                mkdtempImpl: vi.fn().mockResolvedValue('/tmp/backgen-playground-timeout'),
                writeFileImpl: vi.fn().mockResolvedValue(undefined),
                rmImpl: vi.fn().mockResolvedValue(undefined),
                spawnImpl: spawnMock,
            }
        );

        expect(killMock).toHaveBeenCalledWith('SIGKILL');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.message).toContain('timed out');
        }
    });
});
