import { resolve, join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';

const BCM_DIRECTIVE_REGEX = /^\s*\/\/\/\s*@bcm\.\w+.*$/gm;
const BOOTSTRAP_COMMENT = '// Bootstrapped with Backend Creator (bcm) — https://github.com/Mahmoud-s-Khedr/backgen';

/**
 * `bcm eject <path>`
 * Strips all /// @bcm.* directive comments from generated code
 * and adds a bootstrapped-by header comment.
 */
export async function ejectCommand(projectPath: string): Promise<void> {
    const targetDir = resolve(process.cwd(), projectPath);

    console.log(chalk.blue('\n🔓 Backend Creator — Eject\n'));

    // Validate directory exists
    if (!(await fs.pathExists(targetDir))) {
        console.error(
            chalk.red(`✖ Directory not found: ${targetDir}`)
        );
        process.exit(1);
    }

    const spinner = ora('Stripping @bcm directives...').start();

    try {
        let filesModified = 0;
        let directivesRemoved = 0;

        // Walk all .ts, .prisma files
        const extensions = ['.ts', '.prisma', '.tsx', '.js', '.jsx'];
        const files = await walkFiles(targetDir, extensions);

        for (const filePath of files) {
            const content = await fs.readFile(filePath, 'utf-8');
            const matches = content.match(BCM_DIRECTIVE_REGEX);

            if (matches && matches.length > 0) {
                // Remove @bcm directive lines
                let cleaned = content.replace(BCM_DIRECTIVE_REGEX, '');
                // Clean up consecutive empty lines left behind
                cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

                // Add bootstrap header if not already present
                if (!cleaned.includes(BOOTSTRAP_COMMENT)) {
                    cleaned = BOOTSTRAP_COMMENT + '\n\n' + cleaned;
                }

                await fs.writeFile(filePath, cleaned);
                filesModified++;
                directivesRemoved += matches.length;
            }
        }

        spinner.succeed(chalk.green('Eject complete'));
        console.log(`  ${chalk.gray('Files modified:')}    ${chalk.bold(String(filesModified))}`);
        console.log(`  ${chalk.gray('Directives removed:')} ${chalk.bold(String(directivesRemoved))}`);
        console.log(
            chalk.gray('\n  Your project is now fully independent of Backend Creator.\n')
        );
    } catch (error) {
        spinner.fail(chalk.red('Eject failed'));
        if (error instanceof Error) {
            console.error(chalk.red(`  ${error.message}`));
        }
        process.exit(1);
    }
}

/**
 * Recursively walk a directory for files with given extensions.
 */
async function walkFiles(dir: string, extensions: string[]): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            // Skip node_modules and .git
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            results.push(...(await walkFiles(fullPath, extensions)));
        } else if (entry.isFile()) {
            const hasExt = extensions.some((ext) => entry.name.endsWith(ext));
            if (hasExt) {
                results.push(fullPath);
            }
        }
    }

    return results;
}
