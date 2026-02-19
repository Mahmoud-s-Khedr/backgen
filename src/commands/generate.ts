import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import type { GenerateOptions } from '../parser/types.js';
import { parseSchema } from '../parser/index.js';
import { generateProject } from '../generator/index.js';
import { writeFiles } from '../generator/file-writer.js';

/**
 * `bcm generate --schema <path> --output <path> [--dry-run] [--only <part>] [--force]`
 * Main generation command — parses schema, generates code, writes output.
 */
export async function generateCommand(options: GenerateOptions): Promise<void> {
    const schemaPath = resolve(process.cwd(), options.schema);
    const outputDir = resolve(process.cwd(), options.output);

    console.log(chalk.blue('\n🔧 Backend Creator — Generate\n'));

    // 1. Validate schema file exists
    if (!(await fs.pathExists(schemaPath))) {
        console.error(
            chalk.red(`✖ Schema file not found: ${schemaPath}`),
            chalk.yellow('\n  Make sure the path to your .prisma file is correct.')
        );
        process.exit(1);
    }

    // 2. Check output directory
    if ((await fs.pathExists(outputDir)) && !options.force && !options.dryRun) {
        const hasFiles = (await fs.readdir(outputDir)).length > 0;
        if (hasFiles) {
            console.error(
                chalk.red(`✖ Output directory "${options.output}" is not empty.`),
                chalk.yellow('\n  Use --force to overwrite, or choose a different output path.')
            );
            process.exit(1);
        }
    }

    // 3. Parse schema
    const parseSpinner = ora('Parsing Prisma schema...').start();
    let parsedSchema;
    try {
        parsedSchema = await parseSchema(schemaPath);
        parseSpinner.succeed(
            chalk.green(
                `Parsed schema: ${parsedSchema.models.length} model(s), ${parsedSchema.enums.length} enum(s)`
            )
        );
    } catch (error) {
        parseSpinner.fail(chalk.red('Failed to parse schema'));
        if (error instanceof Error) {
            console.error(chalk.red(`  ${error.message}`));
        }
        process.exit(1);
    }

    // Read schema content for passthrough
    const schemaContent = await fs.readFile(schemaPath, 'utf-8');

    // 4. Generate files
    const genSpinner = ora('Generating backend code...').start();
    let generatedFiles;
    try {
        generatedFiles = await generateProject(parsedSchema, options, schemaContent);
        genSpinner.succeed(
            chalk.green(`Generated ${generatedFiles.length} file(s)`)
        );
    } catch (error) {
        genSpinner.fail(chalk.red('Failed to generate code'));
        if (error instanceof Error) {
            console.error(chalk.red(`  ${error.message}`));
        }
        process.exit(1);
    }

    // 5. Write or preview
    if (options.dryRun) {
        console.log(chalk.cyan('\n📋 Dry run — files that would be generated:\n'));
        for (const file of generatedFiles) {
            const sizeKb = (Buffer.byteLength(file.content, 'utf-8') / 1024).toFixed(1);
            console.log(`  ${chalk.gray('•')} ${chalk.white(file.path)} ${chalk.gray(`(${sizeKb} KB)`)}`);
        }
        console.log(
            chalk.yellow(`\n  Total: ${generatedFiles.length} files`)
        );
        console.log(chalk.gray('  Run without --dry-run to write files.\n'));
    } else {
        const writeSpinner = ora('Writing files...').start();
        try {
            await writeFiles(generatedFiles, outputDir);
            writeSpinner.succeed(chalk.green('Files written successfully'));
        } catch (error) {
            writeSpinner.fail(chalk.red('Failed to write files'));
            if (error instanceof Error) {
                console.error(chalk.red(`  ${error.message}`));
            }
            process.exit(1);
        }

        // 6. Summary
        console.log(chalk.cyan('\n✅ Generation complete!\n'));
        console.log(`  ${chalk.gray('Models:')}     ${chalk.bold(String(parsedSchema.models.length))}`);
        if (options.only) {
            console.log(`  ${chalk.gray('Endpoints:')}  ${chalk.gray('(partial — --only mode)')}`);
        } else {
            const totalEndpoints = parsedSchema.models.length * 6; // 6 CRUD endpoints per model
            console.log(`  ${chalk.gray('Endpoints:')}  ${chalk.bold(String(totalEndpoints))} (${parsedSchema.models.length} × 6 CRUD)`);
        }
        console.log(`  ${chalk.gray('Files:')}      ${chalk.bold(String(generatedFiles.length))}`);
        console.log(`  ${chalk.gray('Output:')}     ${chalk.bold(outputDir)}`);

        console.log(chalk.cyan('\n📋 Next steps:\n'));
        console.log(`  ${chalk.gray('1.')} cd ${chalk.bold(options.output)}`);
        console.log(`  ${chalk.gray('2.')} npm install`);
        console.log(`  ${chalk.gray('3.')} npx prisma migrate dev --name init`);
        console.log(`  ${chalk.gray('4.')} npm run dev`);
        console.log(
            chalk.gray(`\n  Swagger docs will be at: http://localhost:3000/api/docs\n`)
        );
    }
}
