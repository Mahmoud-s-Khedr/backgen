import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';

async function runInitInTempDir(
    projectName: string,
    onAfterInit?: (projectDir: string) => Promise<void> | void
): Promise<void> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'backgen-init-test-'));
    const originalCwd = process.cwd();

    try {
        process.chdir(tempRoot);
        await initCommand(projectName);
        if (onAfterInit) {
            await onAfterInit(path.join(tempRoot, projectName));
        }
    } finally {
        process.chdir(originalCwd);
        await fs.remove(tempRoot);
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('initCommand', () => {
    it('writes starter schema guidance with --force for in-place generation', async () => {
        await runInitInTempDir('demo-schema-check', async (projectDir) => {
            const schema = await fs.readFile(path.join(projectDir, 'prisma', 'schema.prisma'), 'utf8');
            expect(schema).toContain('bcm generate --schema ./prisma/schema.prisma --output . --force');
        });
    });

    it('prints next-step guidance with --force for in-place generation', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.map((arg) => String(arg)).join(' '));
        });

        await runInitInTempDir('demo-log-check');

        expect(logs.join('\n')).toContain('bcm generate --schema ./prisma/schema.prisma --output . --force');
    });
});
