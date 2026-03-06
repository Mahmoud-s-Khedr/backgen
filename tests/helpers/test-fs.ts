import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

export interface TempWorkspace {
    root: string;
    resolve: (...parts: string[]) => string;
    cleanup: () => Promise<void>;
}

export async function createTempWorkspace(prefix = 'backgen-test-'): Promise<TempWorkspace> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

    return {
        root,
        resolve: (...parts: string[]) => path.join(root, ...parts),
        cleanup: async () => {
            await fs.remove(root);
        },
    };
}

export interface TempSchemaWorkspace extends TempWorkspace {
    schemaPath: string;
    outputPath: string;
}

export async function createSchemaWorkspace(
    schema: string,
    prefix = 'backgen-schema-test-'
): Promise<TempSchemaWorkspace> {
    const workspace = await createTempWorkspace(prefix);
    const schemaPath = workspace.resolve('schema.prisma');
    const outputPath = workspace.resolve('out');
    await fs.writeFile(schemaPath, schema, 'utf8');

    return {
        ...workspace,
        schemaPath,
        outputPath,
    };
}

export async function writeWorkspaceFile(
    workspaceRoot: string,
    relativePath: string,
    content: string
): Promise<string> {
    const targetPath = path.join(workspaceRoot, relativePath);
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content, 'utf8');
    return targetPath;
}

export async function readWorkspaceFile(
    workspaceRoot: string,
    relativePath: string
): Promise<string> {
    return fs.readFile(path.join(workspaceRoot, relativePath), 'utf8');
}
