import { resolve, join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import type { ParsedSchema, GeneratedFile, ModelDefinition } from '../parser/types.js';
import { parseSchema } from '../parser/index.js';
import { generateModuleFiles } from '../generator/generators/module-generator.js';
import { validateSchemaOrThrow } from '../generator/validate.js';
import { writeFiles } from '../generator/file-writer.js';

interface AddCommandOptions {
    schema: string;
    output: string;
    framework?: 'express' | 'fastify';
    force?: boolean;
    json?: boolean;
}

interface AddJsonSuccess {
    success: true;
    model: string;
    files: { path: string; sizeBytes: number }[];
}

interface AddJsonFailure {
    success: false;
    error: string;
}

interface FollowUpGeneration {
    part: 'app' | 'config' | 'middleware' | 'utils' | 'prisma' | 'infra';
    reason: string;
}

function toPascalCase(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function collectFollowUpGenerations(model: ModelDefinition): FollowUpGeneration[] {
    const requirements = new Map<FollowUpGeneration['part'], string[]>();
    const addRequirement = (part: FollowUpGeneration['part'], reason: string) => {
        const reasons = requirements.get(part) ?? [];
        reasons.push(reason);
        requirements.set(part, reasons);
    };

    const hasUploads = model.fields.some((field) => field.directives.includes('upload'));
    const usesAuthGuards = model.directives.includes('protected') || model.directives.includes('auth');

    if (model.isAuthModel) {
        addRequirement('app', '@bcm.authModel generates shared auth routes');
        addRequirement('config', '@bcm.authModel requires shared auth configuration');
        addRequirement('middleware', '@bcm.authModel relies on generated auth middleware');
        addRequirement('infra', '@bcm.authModel updates generated package/env scaffolding');
    }
    if (usesAuthGuards) {
        addRequirement('middleware', 'protected/auth routes import shared auth middleware');
    }
    if (model.rateLimitConfig) {
        addRequirement('middleware', '@bcm.rateLimit imports shared rate-limit middleware');
    }
    if (hasUploads) {
        addRequirement('middleware', '@bcm.upload imports shared upload middleware');
        addRequirement('config', '@bcm.upload requires shared upload configuration');
    }
    if (model.cacheConfig) {
        addRequirement('config', '@bcm.cache requires shared Redis configuration');
        addRequirement('infra', '@bcm.cache updates generated package/env scaffolding');
    }
    if (model.isEvent) {
        addRequirement('utils', '@bcm.event generates shared event-bus utilities');
    }
    if (model.isAudit) {
        addRequirement('utils', '@bcm.audit generates shared audit utilities');
        addRequirement('prisma', '@bcm.audit augments the generated Prisma schema');
    }

    return [...requirements.entries()].map(([part, reasons]) => ({
        part,
        reason: reasons.join('; '),
    }));
}

function buildGenerateCommand(
    part: string,
    schemaPath: string,
    outputDir: string,
    framework: 'express' | 'fastify'
): string {
    return `bcm generate --schema ${schemaPath} --output ${outputDir} --framework ${framework} --only ${part}`;
}

function buildUnsafeAddMessage(
    modelName: string,
    followUps: FollowUpGeneration[],
    options: { schema: string; output: string; framework: 'express' | 'fastify' }
): string {
    const requirementLines = followUps
        .map(({ part, reason }) => `- ${part}: ${reason}`)
        .join('\n');
    const commandLines = followUps
        .map(({ part }) => `  ${buildGenerateCommand(part, options.schema, options.output, options.framework)}`)
        .join('\n');

    return [
        `Module "${modelName}" cannot be added safely with bcm add because it requires non-module generated files:`,
        requirementLines,
        '',
        'Run the needed generators first:',
        commandLines,
        '',
        `Or run the full generator:`,
        `  bcm generate --schema ${options.schema} --output ${options.output} --framework ${options.framework}`,
    ].join('\n');
}

/**
 * `bcm add <ModelName> --schema <path> --output <path>`
 * Generate module files for a single model without touching existing modules.
 */
export async function addCommand(modelName: string, options: AddCommandOptions): Promise<void> {
    const jsonMode = Boolean(options.json);
    const framework = options.framework ?? 'express';
    const schemaPath = resolve(process.cwd(), options.schema);
    const outputDir = resolve(process.cwd(), options.output);
    const normalizedModel = toPascalCase(modelName);

    if (!jsonMode) {
        console.log(chalk.blue('\n🔧 Backend Creator — Add Module\n'));
    }

    // 1. Validate schema file exists
    if (!(await fs.pathExists(schemaPath))) {
        const message = `Schema file not found: ${schemaPath}`;
        if (jsonMode) {
            emitJson({ success: false, error: message });
            process.exit(1);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    // 2. Parse schema
    const parseSpinner = !jsonMode ? ora('Parsing Prisma schema...').start() : null;
    let parsedSchema: ParsedSchema;
    try {
        parsedSchema = await parseSchema(schemaPath);
        parseSpinner?.succeed(chalk.green('Schema parsed'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        parseSpinner?.fail(chalk.red('Failed to parse schema'));
        if (jsonMode) {
            emitJson({ success: false, error: message });
            process.exit(1);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    // 3. Find the model (case-insensitive match)
    const targetModel = parsedSchema.models.find(
        (m) => m.name.toLowerCase() === normalizedModel.toLowerCase()
    );

    if (!targetModel) {
        const available = parsedSchema.models.map((m) => m.name).join(', ');
        const message = `Model "${modelName}" not found in schema. Available models: ${available}`;
        if (jsonMode) {
            emitJson({ success: false, error: message });
            process.exit(1);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    // 4. Check if module already exists
    const modelLower = targetModel.name.charAt(0).toLowerCase() + targetModel.name.slice(1);
    const modulePath = join(outputDir, 'src', 'modules', modelLower);

    if ((await fs.pathExists(modulePath)) && !options.force) {
        const message = `Module directory already exists: src/modules/${modelLower}/\n  Use --force to overwrite.`;
        if (jsonMode) {
            emitJson({ success: false, error: `Module directory already exists: src/modules/${modelLower}/` });
            process.exit(1);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    // 5. Validate schema
    try {
        validateSchemaOrThrow(parsedSchema);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (jsonMode) {
            emitJson({ success: false, error: message });
            process.exit(1);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    const followUps = collectFollowUpGenerations(targetModel);
    if (followUps.length > 0) {
        const message = buildUnsafeAddMessage(targetModel.name, followUps, {
            schema: options.schema,
            output: options.output,
            framework,
        });
        if (jsonMode) {
            emitJson({ success: false, error: message });
            process.exit(1);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    // 6. Generate module files for ALL models (so relations resolve), then filter
    const genSpinner = !jsonMode ? ora(`Generating module for ${targetModel.name}...`).start() : null;
    let moduleFiles: GeneratedFile[];
    try {
        const allModuleFiles = generateModuleFiles(parsedSchema, framework);
        // Filter to only the target model's files
        const modulePrefix = `src/modules/${modelLower}/`;
        moduleFiles = allModuleFiles.filter((f) => f.path.startsWith(modulePrefix));
        genSpinner?.succeed(chalk.green(`Generated ${moduleFiles.length} file(s) for ${targetModel.name}`));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        genSpinner?.fail(chalk.red('Failed to generate module'));
        if (jsonMode) {
            emitJson({ success: false, error: message });
            process.exit(1);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    // 7. Write files
    const writeSpinner = !jsonMode ? ora('Writing files...').start() : null;
    try {
        const writeMode = options.force ? 'overwrite-targeted' as const : 'error-on-conflict' as const;
        await writeFiles(moduleFiles, outputDir, { mode: writeMode });
        writeSpinner?.succeed(chalk.green('Files written successfully'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeSpinner?.fail(chalk.red('Failed to write files'));
        if (jsonMode) {
            emitJson({ success: false, error: message });
            process.exit(1);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    if (jsonMode) {
        const result: AddJsonSuccess = {
            success: true,
            model: targetModel.name,
            files: moduleFiles.map((f) => ({
                path: f.path,
                sizeBytes: Buffer.byteLength(f.content, 'utf-8'),
            })),
        };
        emitJson(result);
        return;
    }

    // 8. Summary
    console.log(chalk.cyan(`\n✅ Module "${targetModel.name}" added successfully!\n`));
    for (const file of moduleFiles) {
        console.log(`  ${chalk.gray('•')} ${chalk.white(file.path)}`);
    }

    console.log(chalk.yellow('\n⚠  Remember to:'));
    console.log(`  ${chalk.gray('1.')} Update ${chalk.bold('src/app.ts')} to import and register the new routes`);
    console.log(`  ${chalk.gray('2.')} Run ${chalk.bold('bcm generate --only app')} to regenerate app.ts with the new module`);
    console.log(`  ${chalk.gray('3.')} Run ${chalk.bold('npx prisma migrate dev')} if you added new models to the schema\n`);
}

function emitJson(payload: AddJsonSuccess | AddJsonFailure): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}
