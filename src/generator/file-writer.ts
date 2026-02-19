import { join } from 'path';
import fs from 'fs-extra';
import type { GeneratedFile } from '../parser/types.js';

/**
 * Write generated files to the output directory.
 * Creates directory structure as needed.
 */
export async function writeFiles(
    files: GeneratedFile[],
    outputDir: string
): Promise<void> {
    // Ensure output directory exists
    await fs.ensureDir(outputDir);

    for (const file of files) {
        const filePath = join(outputDir, file.path);
        await fs.ensureDir(join(filePath, '..'));
        await fs.writeFile(filePath, file.content, 'utf-8');
    }
}
