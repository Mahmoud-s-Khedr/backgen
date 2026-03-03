import { join } from 'path';
import fs from 'fs-extra';
import type { GeneratedFile } from '../parser/types.js';

export type FileWriteMode = 'skip-identical' | 'error-on-conflict' | 'overwrite-targeted';

export interface WriteFilesOptions {
    mode?: FileWriteMode;
}

interface PendingWrite {
    filePath: string;
    content: string;
}

export class FileWriteConflictError extends Error {
    constructor(public readonly conflicts: string[]) {
        super(
            `Refusing to overwrite ${conflicts.length} conflicting file(s):\n${conflicts
                .map((file) => `- ${file}`)
                .join('\n')}`
        );
        this.name = 'FileWriteConflictError';
    }
}

/**
 * Write generated files to the output directory.
 * Creates directory structure as needed.
 */
export async function writeFiles(
    files: GeneratedFile[],
    outputDir: string,
    options: WriteFilesOptions = {}
): Promise<void> {
    const mode = options.mode ?? 'overwrite-targeted';

    // Ensure output directory exists
    await fs.ensureDir(outputDir);

    const pendingWrites: PendingWrite[] = [];
    const conflicts: string[] = [];

    for (const file of files) {
        const filePath = join(outputDir, file.path);
        const exists = await fs.pathExists(filePath);

        if (!exists) {
            pendingWrites.push({ filePath, content: file.content });
            continue;
        }

        const existingContent = await fs.readFile(filePath, 'utf-8');
        if (existingContent === file.content) {
            continue;
        }

        if (mode === 'error-on-conflict') {
            conflicts.push(file.path);
            continue;
        }

        pendingWrites.push({ filePath, content: file.content });
    }

    if (conflicts.length > 0) {
        throw new FileWriteConflictError(conflicts);
    }

    for (const pending of pendingWrites) {
        await fs.ensureDir(join(pending.filePath, '..'));
        await fs.writeFile(pending.filePath, pending.content, 'utf-8');
    }
}
