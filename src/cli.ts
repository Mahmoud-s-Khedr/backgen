#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { ejectCommand } from './commands/eject.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

program
    .name('bcm')
    .description(
        'Generate a complete, production-ready Express.js REST API backend from a Prisma schema file'
    )
    .version(pkg.version);

program
    .command('init')
    .description('Initialize a new project with starter files')
    .argument('<project-name>', 'Name of the project directory to create')
    .action(initCommand);

program
    .command('generate')
    .description('Generate backend from a Prisma schema file')
    .requiredOption(
        '-s, --schema <path>',
        'Path to the Prisma schema file (.prisma)'
    )
    .requiredOption('-o, --output <path>', 'Output directory for generated code')
    .option('--dry-run', 'Preview generated files without writing to disk', false)
    .option(
        '--only <part>',
        'Generate only a specific part (routes, config, middleware, utils, app, infra, prisma, swagger)'
    )
    .option('--json', 'Output machine-readable JSON only', false)
    .option('--force', 'Overwrite existing output directory', false)
    .action(generateCommand);

program
    .command('eject')
    .description('Strip @bcm directives from generated code')
    .argument('<path>', 'Path to the generated project directory')
    .action(ejectCommand);

program.parse();
