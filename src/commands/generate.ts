import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import type { GenerateOptions, ModelDefinition, ParsedSchema, GeneratedFile } from '../parser/types.js';
import { parseSchema } from '../parser/index.js';
import { generateProject } from '../generator/index.js';
import {
    FileWriteConflictError,
    type FileWriteMode,
    writeFiles,
} from '../generator/file-writer.js';
import { resolveItemSelector } from '../generator/model-selector.js';

export type GenerateErrorStage = 'parse' | 'generate' | 'write' | 'unknown';

export interface CliJsonGeneratedFile {
    path: string;
    content: string;
    sizeBytes: number;
}

export interface CliGenerateJsonSuccess {
    success: true;
    warnings: string[];
    modelCount: number;
    enumCount: number;
    files: CliJsonGeneratedFile[];
    generatedAt: string;
    endpointCount?: number;
}

export interface CliGenerateJsonFailure {
    success: false;
    error: {
        stage: GenerateErrorStage;
        message: string;
    };
}

export type CliGenerateJsonResult = CliGenerateJsonSuccess | CliGenerateJsonFailure;

interface GenerateCommandOptions extends GenerateOptions {
    json?: boolean;
}

function normalizeFramework(value: string | undefined): 'express' | 'fastify' {
    if (!value) {
        return 'express';
    }
    if (value === 'express' || value === 'fastify') {
        return value;
    }
    throw new Error(`Invalid framework "${value}". Expected one of: express, fastify.`);
}

/**
 * Count generated CRUD endpoints using selector-aware rules:
 * - 6 endpoints for models with an item selector (list/get/create/update/patch/delete)
 * - 2 endpoints for models without item selector (list/create)
 */
export function computeCrudEndpointCount(models: ModelDefinition[]): number {
    return models.reduce((total, model) => {
        return total + (resolveItemSelector(model) ? 6 : 2);
    }, 0);
}

export function createJsonSuccessResult(
    parsedSchema: ParsedSchema,
    generatedFiles: GeneratedFile[],
    options: Pick<GenerateCommandOptions, 'only'>,
    now = new Date()
): CliGenerateJsonSuccess {
    const files = generatedFiles.map((file) => ({
        path: file.path,
        content: file.content,
        sizeBytes: Buffer.byteLength(file.content, 'utf-8'),
    }));

    return {
        success: true,
        warnings: parsedSchema.warnings,
        modelCount: parsedSchema.models.length,
        enumCount: parsedSchema.enums.length,
        files,
        generatedAt: now.toISOString(),
        ...(options.only ? {} : { endpointCount: computeCrudEndpointCount(parsedSchema.models) }),
    };
}

export function createJsonFailureResult(stage: GenerateErrorStage, message: string): CliGenerateJsonFailure {
    return {
        success: false,
        error: {
            stage,
            message,
        },
    };
}

function emitJson(payload: CliGenerateJsonResult): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function failWithJson(stage: GenerateErrorStage, message: string): never {
    emitJson(createJsonFailureResult(stage, message));
    process.exit(1);
}

/**
 * `bcm generate --schema <path> --output <path> [--dry-run] [--only <part>] [--force]`
 * Main generation command — parses schema, generates code, writes output.
 */
export async function generateCommand(options: GenerateCommandOptions): Promise<void> {
    const jsonMode = Boolean(options.json);
    let framework: 'express' | 'fastify';
    try {
        framework = normalizeFramework(options.framework);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (jsonMode) {
            failWithJson('generate', message);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }
    const schemaPath = resolve(process.cwd(), options.schema);
    const outputDir = resolve(process.cwd(), options.output);

    if (!jsonMode) {
        console.log(chalk.blue('\n🔧 Backend Creator — Generate\n'));
    }

    // 1. Validate schema file exists
    if (!(await fs.pathExists(schemaPath))) {
        const message = `Schema file not found: ${schemaPath}`;
        if (jsonMode) {
            failWithJson('parse', message);
        }
        console.error(
            chalk.red(`✖ ${message}`),
            chalk.yellow('\n  Make sure the path to your .prisma file is correct.')
        );
        process.exit(1);
    }

    // 2. Check output directory
    if ((await fs.pathExists(outputDir)) && !options.force && !options.dryRun && !options.only) {
        const hasFiles = (await fs.readdir(outputDir)).length > 0;
        if (hasFiles) {
            const message = `Output directory "${options.output}" is not empty.`;
            if (jsonMode) {
                failWithJson('write', message);
            }
            console.error(
                chalk.red(`✖ ${message}`),
                chalk.yellow('\n  Use --force to overwrite, or choose a different output path.')
            );
            process.exit(1);
        }
    }

    // 3. Parse schema
    const parseSpinner = !jsonMode ? ora('Parsing Prisma schema...').start() : null;
    let parsedSchema: ParsedSchema;
    try {
        parsedSchema = await parseSchema(schemaPath);
        parseSpinner?.succeed(
            chalk.green(
                `Parsed schema: ${parsedSchema.models.length} model(s), ${parsedSchema.enums.length} enum(s)`
            )
        );
        if (!jsonMode && parsedSchema.warnings.length > 0) {
            console.warn(chalk.yellow(`\n⚠ Directive warnings (${parsedSchema.warnings.length}):`));
            for (const warning of parsedSchema.warnings) {
                console.warn(chalk.yellow(`  - ${warning}`));
            }
            console.warn(chalk.gray('  Generation will continue.\n'));
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        parseSpinner?.fail(chalk.red('Failed to parse schema'));
        if (jsonMode) {
            failWithJson('parse', message);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    // Read schema content for passthrough
    const schemaContent = await fs.readFile(schemaPath, 'utf-8');

    // 4. Generate files
    const genSpinner = !jsonMode ? ora('Generating backend code...').start() : null;
    let generatedFiles: GeneratedFile[];
    try {
        generatedFiles = await generateProject(parsedSchema, { ...options, framework }, schemaContent);
        genSpinner?.succeed(chalk.green(`Generated ${generatedFiles.length} file(s)`));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        genSpinner?.fail(chalk.red('Failed to generate code'));
        if (jsonMode) {
            failWithJson('generate', message);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    // 5. Write or preview
    if (options.dryRun) {
        if (jsonMode) {
            emitJson(createJsonSuccessResult(parsedSchema, generatedFiles, options));
            return;
        }
        console.log(chalk.cyan('\n📋 Dry run — files that would be generated:\n'));
        for (const file of generatedFiles) {
            const sizeKb = (Buffer.byteLength(file.content, 'utf-8') / 1024).toFixed(1);
            console.log(`  ${chalk.gray('•')} ${chalk.white(file.path)} ${chalk.gray(`(${sizeKb} KB)`)}`);
        }
        console.log(chalk.yellow(`\n  Total: ${generatedFiles.length} files`));
        console.log(chalk.gray('  Run without --dry-run to write files.\n'));
        return;
    }

    const writeSpinner = !jsonMode ? ora('Writing files...').start() : null;
    try {
        const writeMode: FileWriteMode = options.only && !options.force
            ? 'error-on-conflict'
            : options.force
                ? 'overwrite-targeted'
                : 'skip-identical';
        await writeFiles(generatedFiles, outputDir, { mode: writeMode });
        writeSpinner?.succeed(chalk.green('Files written successfully'));
    } catch (error) {
        const message = error instanceof FileWriteConflictError
            ? `Refusing to overwrite existing files for --only without --force:\n${error.conflicts
                .map((file) => `- ${file}`)
                .join('\n')}`
            : error instanceof Error
                ? error.message
                : String(error);
        writeSpinner?.fail(chalk.red('Failed to write files'));
        if (jsonMode) {
            failWithJson('write', message);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    if (jsonMode) {
        emitJson(createJsonSuccessResult(parsedSchema, generatedFiles, options));
        return;
    }

    // 6. Summary
    console.log(chalk.cyan('\n✅ Generation complete!\n'));
    console.log(`  ${chalk.gray('Models:')}     ${chalk.bold(String(parsedSchema.models.length))}`);
    if (options.only) {
        console.log(`  ${chalk.gray('Endpoints:')}  ${chalk.gray('(partial — --only mode)')}`);
    } else {
        const totalEndpoints = computeCrudEndpointCount(parsedSchema.models);
        const modelsWithItemSelector = parsedSchema.models.filter((model) => !!resolveItemSelector(model)).length;
        const listCreateOnlyModels = parsedSchema.models.length - modelsWithItemSelector;
        console.log(
            `  ${chalk.gray('Endpoints:')}  ${chalk.bold(String(totalEndpoints))} ` +
            `(${modelsWithItemSelector} full CRUD model(s), ${listCreateOnlyModels} list/create-only model(s))`
        );
    }
    console.log(`  ${chalk.gray('Files:')}      ${chalk.bold(String(generatedFiles.length))}`);
    console.log(`  ${chalk.gray('Output:')}     ${chalk.bold(outputDir)}`);

    console.log(chalk.cyan('\n📋 Next steps:\n'));
    console.log(`  ${chalk.gray('1.')} cd ${chalk.bold(options.output)}`);
    console.log(`  ${chalk.gray('2.')} npm install`);
    console.log(`  ${chalk.gray('3.')} npx prisma migrate dev --name init`);
    console.log(`  ${chalk.gray('4.')} npm run dev`);
    console.log(chalk.gray(`\n  Swagger docs will be at: http://localhost:3000/api/docs\n`));
}
