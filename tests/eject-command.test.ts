import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ejectCommand } from '../src/commands/eject.js';
import { createTempWorkspace, writeWorkspaceFile } from './helpers/test-fs.js';
import { captureConsole, mockProcessExitToThrow } from './helpers/test-io.js';

const BOOTSTRAP_COMMENT = '// Bootstrapped with Backend Creator (bcm) — https://github.com/Mahmoud-s-Khedr/backgen';

async function runEject(workspaceRoot: string, targetRelativePath: string): Promise<void> {
    const originalCwd = process.cwd();
    try {
        process.chdir(workspaceRoot);
        await ejectCommand(targetRelativePath);
    } finally {
        process.chdir(originalCwd);
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ejectCommand', () => {
    it('strips only /// @bcm.* directives and keeps non-directive content', async () => {
        const workspace = await createTempWorkspace('backgen-eject-strip-');
        const projectName = 'project';
        const targetDir = path.join(workspace.root, projectName);

        await writeWorkspaceFile(targetDir, 'src/user.ts', `// normal comment\n/// @bcm.hidden\nexport const user = {\n  /// @bcm.readonly\n  name: 'mk',\n};\n`);

        try {
            await runEject(workspace.root, projectName);

            const content = await fs.readFile(path.join(targetDir, 'src/user.ts'), 'utf8');
            expect(content).toContain(BOOTSTRAP_COMMENT);
            expect(content).toContain('// normal comment');
            expect(content).toContain("name: 'mk'");
            expect(content).not.toContain('@bcm.hidden');
            expect(content).not.toContain('@bcm.readonly');
        } finally {
            await workspace.cleanup();
        }
    });

    it('adds bootstrap header once and stays idempotent on repeated runs', async () => {
        const workspace = await createTempWorkspace('backgen-eject-idempotent-');
        const projectName = 'project';
        const targetDir = path.join(workspace.root, projectName);

        await writeWorkspaceFile(targetDir, 'src/post.ts', `/// @bcm.writeOnly\nexport const post = true;\n`);

        try {
            await runEject(workspace.root, projectName);
            await runEject(workspace.root, projectName);

            const content = await fs.readFile(path.join(targetDir, 'src/post.ts'), 'utf8');
            const headerCount = (content.match(new RegExp(BOOTSTRAP_COMMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
            expect(headerCount).toBe(1);
            expect(content).not.toContain('@bcm.writeOnly');
        } finally {
            await workspace.cleanup();
        }
    });

    it('recursively processes supported extensions and skips .git/node_modules', async () => {
        const workspace = await createTempWorkspace('backgen-eject-recursive-');
        const projectName = 'project';
        const targetDir = path.join(workspace.root, projectName);

        await Promise.all([
            writeWorkspaceFile(targetDir, 'src/a.ts', '/// @bcm.hidden\nexport const a = 1;\n'),
            writeWorkspaceFile(targetDir, 'prisma/schema.prisma', '/// @bcm.protected\nmodel A {\n  id String @id\n}\n'),
            writeWorkspaceFile(targetDir, 'web/app.tsx', '/// @bcm.readonly\nexport const App = () => null;\n'),
            writeWorkspaceFile(targetDir, 'legacy/index.js', '/// @bcm.writeOnly\nmodule.exports = 1;\n'),
            writeWorkspaceFile(targetDir, 'legacy/view.jsx', '/// @bcm.searchable\nexport default function View() { return null; }\n'),
            writeWorkspaceFile(targetDir, 'docs/keep.txt', '/// @bcm.hidden\nThis should stay untouched.\n'),
            writeWorkspaceFile(targetDir, 'node_modules/pkg/skip.ts', '/// @bcm.hidden\nexport const skip = true;\n'),
            writeWorkspaceFile(targetDir, '.git/hooks/skip.ts', '/// @bcm.hidden\nexport const skipGit = true;\n'),
        ]);

        try {
            await runEject(workspace.root, projectName);

            const processedFiles = [
                'src/a.ts',
                'prisma/schema.prisma',
                'web/app.tsx',
                'legacy/index.js',
                'legacy/view.jsx',
            ];
            for (const file of processedFiles) {
                const content = await fs.readFile(path.join(targetDir, file), 'utf8');
                expect(content).toContain(BOOTSTRAP_COMMENT);
                expect(content).not.toContain('@bcm.');
            }

            const txtContent = await fs.readFile(path.join(targetDir, 'docs/keep.txt'), 'utf8');
            expect(txtContent).toContain('/// @bcm.hidden');

            const nodeModulesContent = await fs.readFile(path.join(targetDir, 'node_modules/pkg/skip.ts'), 'utf8');
            expect(nodeModulesContent).toContain('/// @bcm.hidden');

            const gitContent = await fs.readFile(path.join(targetDir, '.git/hooks/skip.ts'), 'utf8');
            expect(gitContent).toContain('/// @bcm.hidden');
        } finally {
            await workspace.cleanup();
        }
    });

    it('prints files-modified and directives-removed counters', async () => {
        const workspace = await createTempWorkspace('backgen-eject-counts-');
        const projectName = 'project';
        const targetDir = path.join(workspace.root, projectName);

        await Promise.all([
            writeWorkspaceFile(targetDir, 'src/a.ts', '/// @bcm.hidden\nexport const a = 1;\n'),
            writeWorkspaceFile(targetDir, 'src/b.ts', '/// @bcm.readonly\n/// @bcm.writeOnly\nexport const b = 2;\n'),
        ]);

        const logs = captureConsole('log');

        try {
            await runEject(workspace.root, projectName);

            const output = logs.text();
            expect(output).toContain('Files modified:');
            expect(output).toContain('Directives removed:');
            expect(output).toContain('2');
            expect(output).toContain('3');
        } finally {
            await workspace.cleanup();
        }
    });

    it('fails when target directory does not exist', async () => {
        const workspace = await createTempWorkspace('backgen-eject-missing-');
        const errors = captureConsole('error');
        mockProcessExitToThrow();

        try {
            await expect(runEject(workspace.root, 'missing-dir')).rejects.toThrow('process.exit(1)');
            expect(errors.text()).toContain('Directory not found');
        } finally {
            await workspace.cleanup();
        }
    });
});
