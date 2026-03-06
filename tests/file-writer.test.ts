import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    FileWriteConflictError,
    writeFiles,
} from '../src/generator/file-writer.js';
import type { GeneratedFile } from '../src/parser/types.js';
import { createTempWorkspace } from './helpers/test-fs.js';

function file(pathValue: string, content: string): GeneratedFile {
    return { path: pathValue, content };
}

describe('writeFiles', () => {
    it('creates nested directories and writes all generated files', async () => {
        const workspace = await createTempWorkspace('backgen-write-files-create-');

        try {
            await writeFiles([
                file('src/modules/user/user.controller.ts', 'export const controller = 1;\n'),
                file('openapi.json', '{"openapi":"3.0.3"}\n'),
            ], workspace.root);

            expect(await fs.pathExists(path.join(workspace.root, 'src/modules/user/user.controller.ts'))).toBe(true);
            expect(await fs.pathExists(path.join(workspace.root, 'openapi.json'))).toBe(true);
        } finally {
            await workspace.cleanup();
        }
    });

    it('skip-identical keeps identical file untouched and overwrites different content', async () => {
        const workspace = await createTempWorkspace('backgen-write-files-skip-identical-');
        const samePath = path.join(workspace.root, 'src/a.ts');
        const changedPath = path.join(workspace.root, 'src/b.ts');

        await fs.ensureDir(path.dirname(samePath));
        await fs.writeFile(samePath, 'const same = true;\n', 'utf8');
        await fs.writeFile(changedPath, 'const old = true;\n', 'utf8');

        try {
            await writeFiles([
                file('src/a.ts', 'const same = true;\n'),
                file('src/b.ts', 'const next = true;\n'),
            ], workspace.root, { mode: 'skip-identical' });

            expect(await fs.readFile(samePath, 'utf8')).toBe('const same = true;\n');
            expect(await fs.readFile(changedPath, 'utf8')).toBe('const next = true;\n');
        } finally {
            await workspace.cleanup();
        }
    });

    it('error-on-conflict throws FileWriteConflictError with accurate conflict list', async () => {
        const workspace = await createTempWorkspace('backgen-write-files-conflicts-');

        await fs.ensureDir(path.join(workspace.root, 'src'));
        await fs.writeFile(path.join(workspace.root, 'src/a.ts'), 'const oldA = true;\n', 'utf8');
        await fs.writeFile(path.join(workspace.root, 'src/b.ts'), 'const oldB = true;\n', 'utf8');

        try {
            await expect(writeFiles([
                file('src/a.ts', 'const newA = true;\n'),
                file('src/b.ts', 'const newB = true;\n'),
            ], workspace.root, { mode: 'error-on-conflict' })).rejects.toBeInstanceOf(FileWriteConflictError);

            await expect(writeFiles([
                file('src/a.ts', 'const newA = true;\n'),
                file('src/b.ts', 'const newB = true;\n'),
            ], workspace.root, { mode: 'error-on-conflict' })).rejects.toMatchObject({
                conflicts: ['src/a.ts', 'src/b.ts'],
            });
        } finally {
            await workspace.cleanup();
        }
    });

    it('error-on-conflict ignores identical files and only reports changed targets', async () => {
        const workspace = await createTempWorkspace('backgen-write-files-partial-conflicts-');

        await fs.ensureDir(path.join(workspace.root, 'src'));
        await fs.writeFile(path.join(workspace.root, 'src/a.ts'), 'const a = 1;\n', 'utf8');
        await fs.writeFile(path.join(workspace.root, 'src/b.ts'), 'const oldB = true;\n', 'utf8');

        try {
            await expect(writeFiles([
                file('src/a.ts', 'const a = 1;\n'),
                file('src/b.ts', 'const newB = true;\n'),
            ], workspace.root, { mode: 'error-on-conflict' })).rejects.toMatchObject({
                conflicts: ['src/b.ts'],
            });
        } finally {
            await workspace.cleanup();
        }
    });

    it('overwrite-targeted updates changed files', async () => {
        const workspace = await createTempWorkspace('backgen-write-files-overwrite-');
        const target = path.join(workspace.root, 'src/config/env.ts');

        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, 'export const env = { old: true };\n', 'utf8');

        try {
            await writeFiles([
                file('src/config/env.ts', 'export const env = { old: false };\n'),
            ], workspace.root, { mode: 'overwrite-targeted' });

            expect(await fs.readFile(target, 'utf8')).toBe('export const env = { old: false };\n');
        } finally {
            await workspace.cleanup();
        }
    });
});
