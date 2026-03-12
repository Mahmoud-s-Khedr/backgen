import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { parseSchema } from '../parser/index.js';
import { validateSchema, type ValidationIssue } from '../generator/validate.js';

interface ValidateCommandOptions {
    schema: string;
    json?: boolean;
}

interface ValidateJsonResult {
    valid: boolean;
    modelCount: number;
    enumCount: number;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
}

/**
 * `bcm validate --schema <path> [--json]`
 * Parses a Prisma schema and runs all directive/structural checks
 * without generating any files. Exits with code 1 if errors are found.
 */
export async function validateCommand(options: ValidateCommandOptions): Promise<void> {
    const jsonMode = Boolean(options.json);
    const schemaPath = resolve(process.cwd(), options.schema);

    if (!jsonMode) {
        console.log(chalk.blue('\n🔍 Backend Creator — Validate\n'));
    }

    // 1. Check file exists
    if (!(await fs.pathExists(schemaPath))) {
        const message = `Schema file not found: ${schemaPath}`;
        if (jsonMode) {
            emitJson({ valid: false, modelCount: 0, enumCount: 0, errors: [{ severity: 'error', message }], warnings: [] });
            process.exit(1);
        }
        console.error(chalk.red(`✖ ${message}`));
        process.exit(1);
    }

    // 2. Parse schema
    const parseSpinner = !jsonMode ? ora('Parsing Prisma schema...').start() : null;
    let parsedSchema: Awaited<ReturnType<typeof parseSchema>>;
    try {
        parsedSchema = await parseSchema(schemaPath);
        parseSpinner?.succeed(
            chalk.green(`Parsed schema: ${parsedSchema.models.length} model(s), ${parsedSchema.enums.length} enum(s)`)
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        parseSpinner?.fail(chalk.red('Failed to parse schema'));
        if (jsonMode) {
            emitJson({ valid: false, modelCount: 0, enumCount: 0, errors: [{ severity: 'error', message }], warnings: [] });
            process.exit(1);
        }
        console.error(chalk.red(`  ${message}`));
        process.exit(1);
    }

    // 3. Validate
    const result = validateSchema(parsedSchema);

    if (jsonMode) {
        const payload: ValidateJsonResult = {
            valid: result.valid,
            modelCount: parsedSchema.models.length,
            enumCount: parsedSchema.enums.length,
            errors: result.errors,
            warnings: result.warnings,
        };
        emitJson(payload);
        process.exit(result.valid ? 0 : 1);
    }

    // 4. Human-readable output
    const totalIssues = result.errors.length + result.warnings.length;

    if (totalIssues === 0) {
        console.log(chalk.green('✔ Schema is valid — no issues found.\n'));
        return;
    }

    if (result.warnings.length > 0) {
        console.log(chalk.yellow(`\n⚠ Warnings (${result.warnings.length}):\n`));
        for (const issue of result.warnings) {
            const location = formatLocation(issue);
            console.log(chalk.yellow(`  ⚠ ${location}${issue.message}`));
        }
    }

    if (result.errors.length > 0) {
        console.log(chalk.red(`\n✖ Errors (${result.errors.length}):\n`));
        for (const issue of result.errors) {
            const location = formatLocation(issue);
            console.log(chalk.red(`  ✖ ${location}${issue.message}`));
        }
        console.log(chalk.red(`\nSchema validation failed with ${result.errors.length} error(s).\n`));
        process.exit(1);
    }

    // Only warnings — still valid
    console.log(chalk.yellow(`\nSchema is valid with ${result.warnings.length} warning(s).\n`));
}

function formatLocation(issue: ValidationIssue): string {
    const parts: string[] = [];
    if (issue.model) parts.push(issue.model);
    if (issue.field) parts.push(issue.field);
    if (issue.directive) parts.push(`@bcm.${issue.directive}`);
    return parts.length > 0 ? chalk.bold(`[${parts.join(' › ')}] `) : '';
}

function emitJson(payload: ValidateJsonResult): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}
