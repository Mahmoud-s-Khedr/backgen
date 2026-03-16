import { resolve, join, relative } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import type { ParsedSchema, GeneratedFile } from '../parser/types.js';
import { parseSchema } from '../parser/index.js';
import { generateProject } from '../generator/index.js';

interface DiffCommandOptions {
    schema: string;
    output: string;
    framework?: 'express' | 'fastify';
    json?: boolean;
}

interface FileDiff {
    path: string;
    hunks: string;
}

interface DiffJsonResult {
    new: string[];
    modified: FileDiff[];
    identical: string[];
    orphaned: string[];
}

/**
 * `bcm diff --schema <path> --output <path>`
 * Show a structured diff of what would change if you regenerated.
 */
export async function diffCommand(options: DiffCommandOptions): Promise<void> {
    const jsonMode = Boolean(options.json);
    const framework = options.framework ?? 'express';
    const schemaPath = resolve(process.cwd(), options.schema);
    const outputDir = resolve(process.cwd(), options.output);

    if (!jsonMode) {
        console.log(chalk.blue('\n🔧 Backend Creator — Diff\n'));
    }

    // 1. Validate inputs
    if (!(await fs.pathExists(schemaPath))) {
        const message = `Schema file not found: ${schemaPath}`;
        if (jsonMode) {
            emitJsonError(message);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    if (!(await fs.pathExists(outputDir))) {
        const message = `Output directory not found: ${outputDir}`;
        if (jsonMode) {
            emitJsonError(message);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    // 2. Parse schema and generate in-memory
    const spinner = !jsonMode ? ora('Generating in-memory for comparison...').start() : null;
    let parsedSchema: ParsedSchema;
    let generatedFiles: GeneratedFile[];
    try {
        parsedSchema = await parseSchema(schemaPath);
        const schemaContent = await fs.readFile(schemaPath, 'utf-8');
        generatedFiles = await generateProject(
            parsedSchema,
            { schema: options.schema, output: options.output, dryRun: true, force: false, framework },
            schemaContent
        );
        spinner?.succeed(chalk.green(`Generated ${generatedFiles.length} file(s) in-memory`));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spinner?.fail(chalk.red('Failed to generate'));
        if (jsonMode) {
            emitJsonError(message);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    // 3. Compare each generated file against disk
    const newFiles: string[] = [];
    const modifiedFiles: FileDiff[] = [];
    const identicalFiles: string[] = [];

    for (const file of generatedFiles) {
        const diskPath = join(outputDir, file.path);
        const exists = await fs.pathExists(diskPath);

        if (!exists) {
            newFiles.push(file.path);
            continue;
        }

        const diskContent = await fs.readFile(diskPath, 'utf-8');
        if (diskContent === file.content) {
            identicalFiles.push(file.path);
            continue;
        }

        const hunks = computeUnifiedDiff(file.path, diskContent, file.content);
        modifiedFiles.push({ path: file.path, hunks });
    }

    // 4. Detect orphaned module directories
    const orphaned = await findOrphanedModules(outputDir, parsedSchema);

    // 5. Output results
    if (jsonMode) {
        const result: DiffJsonResult = {
            new: newFiles,
            modified: modifiedFiles,
            identical: identicalFiles,
            orphaned,
        };
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
    }

    // Human-readable output
    const totalChanges = newFiles.length + modifiedFiles.length + orphaned.length;

    if (totalChanges === 0) {
        console.log(chalk.green('  No changes detected — generated output matches disk.\n'));
        return;
    }

    if (newFiles.length > 0) {
        console.log(chalk.green(`\n  + ${newFiles.length} new file(s):\n`));
        for (const f of newFiles) {
            console.log(`    ${chalk.green('+')} ${f}`);
        }
    }

    if (modifiedFiles.length > 0) {
        console.log(chalk.yellow(`\n  ~ ${modifiedFiles.length} modified file(s):\n`));
        for (const f of modifiedFiles) {
            console.log(`    ${chalk.yellow('~')} ${f.path}`);
            // Print a compact summary of the diff
            const lines = f.hunks.split('\n');
            const added = lines.filter((l) => l.startsWith('+')).length;
            const removed = lines.filter((l) => l.startsWith('-')).length;
            console.log(chalk.gray(`      ${chalk.green(`+${added}`)} ${chalk.red(`-${removed}`)} lines`));
        }
    }

    if (orphaned.length > 0) {
        console.log(chalk.red(`\n  ? ${orphaned.length} orphaned module(s) (not in schema):\n`));
        for (const o of orphaned) {
            console.log(`    ${chalk.red('?')} ${o}`);
        }
    }

    console.log(chalk.gray(`\n  ${identicalFiles.length} file(s) identical (unchanged)`));
    console.log(chalk.cyan(`\n  Summary: ${chalk.green(`+${newFiles.length} new`)} ${chalk.yellow(`~${modifiedFiles.length} modified`)} ${chalk.red(`?${orphaned.length} orphaned`)} ${chalk.gray(`=${identicalFiles.length} identical`)}\n`));
}

/**
 * Compute a simple unified diff between two strings.
 * Uses a line-by-line approach without external dependencies.
 */
function computeUnifiedDiff(filePath: string, oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const result: string[] = [];

    result.push(`--- a/${filePath}`);
    result.push(`+++ b/${filePath}`);

    // Simple line-by-line diff using longest common subsequence approach
    const lcs = computeLCS(oldLines, newLines);
    let oldIdx = 0;
    let newIdx = 0;

    for (const [oi, ni] of lcs) {
        // Lines removed from old before this common line
        while (oldIdx < oi) {
            result.push(`-${oldLines[oldIdx]}`);
            oldIdx++;
        }
        // Lines added in new before this common line
        while (newIdx < ni) {
            result.push(`+${newLines[newIdx]}`);
            newIdx++;
        }
        // Common line
        result.push(` ${oldLines[oi]}`);
        oldIdx = oi + 1;
        newIdx = ni + 1;
    }

    // Remaining lines
    while (oldIdx < oldLines.length) {
        result.push(`-${oldLines[oldIdx]}`);
        oldIdx++;
    }
    while (newIdx < newLines.length) {
        result.push(`+${newLines[newIdx]}`);
        newIdx++;
    }

    return result.join('\n');
}

/**
 * Compute the longest common subsequence indices between two arrays of lines.
 * Returns pairs of [oldIndex, newIndex] for matching lines.
 * Uses O(n*m) DP — acceptable for generated files (typically < 500 lines).
 */
function computeLCS(oldLines: string[], newLines: string[]): [number, number][] {
    const m = oldLines.length;
    const n = newLines.length;

    // For very large files, fall back to a simpler comparison
    if (m * n > 1_000_000) {
        return computeSimpleLCS(oldLines, newLines);
    }

    // Standard DP table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find the actual subsequence
    const result: [number, number][] = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
        if (oldLines[i - 1] === newLines[j - 1]) {
            result.unshift([i - 1, j - 1]);
            i--;
            j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return result;
}

/**
 * Simpler O(n) fallback for very large files: match lines greedily.
 */
function computeSimpleLCS(oldLines: string[], newLines: string[]): [number, number][] {
    const result: [number, number][] = [];
    let newIdx = 0;
    for (let oldIdx = 0; oldIdx < oldLines.length && newIdx < newLines.length; oldIdx++) {
        while (newIdx < newLines.length) {
            if (oldLines[oldIdx] === newLines[newIdx]) {
                result.push([oldIdx, newIdx]);
                newIdx++;
                break;
            }
            newIdx++;
        }
    }
    return result;
}

/**
 * Find module directories in the output that don't correspond to any model in the schema.
 */
async function findOrphanedModules(outputDir: string, schema: ParsedSchema): Promise<string[]> {
    const modulesDir = join(outputDir, 'src', 'modules');
    if (!(await fs.pathExists(modulesDir))) {
        return [];
    }

    const modelNames = new Set(
        schema.models.map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1))
    );

    // Also exclude 'auth' module directory (generated by app-generator, not a model module)
    modelNames.add('auth');

    const entries = await fs.readdir(modulesDir, { withFileTypes: true });
    const orphaned: string[] = [];

    for (const entry of entries) {
        if (entry.isDirectory() && !modelNames.has(entry.name)) {
            orphaned.push(`src/modules/${entry.name}/`);
        }
    }

    return orphaned;
}

function emitJsonError(message: string): never {
    process.stdout.write(`${JSON.stringify({ success: false, error: message })}\n`);
    process.exit(1);
}
