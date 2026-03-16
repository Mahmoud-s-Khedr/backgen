import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { createTempWorkspace } from './helpers/test-fs.js';
import { captureConsole, mockProcessExitToThrow } from './helpers/test-io.js';

async function runInitInTempDir(
    projectName: string,
    onAfterInit?: (projectDir: string) => Promise<void> | void
): Promise<void> {
    const workspace = await createTempWorkspace('backgen-init-test-');
    const originalCwd = process.cwd();

    try {
        process.chdir(workspace.root);
        await initCommand(projectName);
        if (onAfterInit) {
            await onAfterInit(path.join(workspace.root, projectName));
        }
    } finally {
        process.chdir(originalCwd);
        await workspace.cleanup();
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('initCommand', () => {
    it('fails when target directory already exists', async () => {
        const workspace = await createTempWorkspace('backgen-init-exists-');
        const originalCwd = process.cwd();
        const errors = captureConsole('error');
        mockProcessExitToThrow();

        try {
            const projectName = 'existing-project';
            await fs.ensureDir(path.join(workspace.root, projectName));

            process.chdir(workspace.root);
            await expect(initCommand(projectName)).rejects.toThrow('process.exit(1)');
            expect(errors.text()).toContain(`Directory "${projectName}" already exists`);
        } finally {
            process.chdir(originalCwd);
            await workspace.cleanup();
        }
    });

    it('creates the expected scaffold files and directories', async () => {
        await runInitInTempDir('demo-scaffold-check', async (projectDir) => {
            const requiredPaths = [
                'package.json',
                'tsconfig.json',
                '.gitignore',
                'prisma/schema.prisma',
                'src',
            ];

            for (const relativePath of requiredPaths) {
                const absolutePath = path.join(projectDir, relativePath);
                expect(await fs.pathExists(absolutePath)).toBe(true);
            }

            const packageJson = await fs.readJson(path.join(projectDir, 'package.json'));
            expect(packageJson.name).toBe('demo-scaffold-check');
            expect(packageJson.scripts).toHaveProperty('dev');
            expect(packageJson.scripts).toHaveProperty('test');
        });
    });

    it('writes starter schema guidance with directives and --force for in-place generation', async () => {
        await runInitInTempDir('demo-schema-check', async (projectDir) => {
            const schema = await fs.readFile(path.join(projectDir, 'prisma', 'schema.prisma'), 'utf8');
            expect(schema).toContain('/// @bcm.hidden');
            expect(schema).toContain('/// @bcm.writeOnly');
            expect(schema).toContain('/// @bcm.softDelete');
            expect(schema).toContain('bcm generate --schema ./prisma/schema.prisma --output . --force');
        });
    });

    it('prints next-step guidance with --force for in-place generation', async () => {
        const logs = captureConsole('log');

        await runInitInTempDir('demo-log-check');

        expect(logs.text()).toContain('bcm generate --schema ./prisma/schema.prisma --output . --force');
        expect(logs.text()).toContain('pnpm install');
        expect(logs.text()).toContain('pnpm exec prisma migrate dev --name init');
        expect(logs.text()).toContain('pnpm dev');
    });
});
