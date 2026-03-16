#!/usr/bin/env node

import { Command, InvalidArgumentError } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { ejectCommand } from './commands/eject.js';
import { validateCommand } from './commands/validate.js';
import { addCommand } from './commands/add.js';
import { diffCommand } from './commands/diff.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

function parseFramework(value: string): 'express' | 'fastify' {
    if (value === 'express' || value === 'fastify') {
        return value;
    }
    throw new InvalidArgumentError(
        `Invalid framework "${value}". Expected one of: express, fastify.`
    );
}

function parseJobs(value: string): 'bullmq' | 'pg-boss' {
    if (value === 'bullmq' || value === 'pg-boss') {
        return value;
    }
    throw new InvalidArgumentError(
        `Invalid jobs provider "${value}". Expected one of: bullmq, pg-boss.`
    );
}

program
    .name('bcm')
    .description(
        'Generate a complete, production-ready REST API backend (Express or Fastify) from a Prisma schema file'
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
        'Generate only a specific part (routes, config, middleware, utils, app, infra, prisma, swagger, api-client, ws)'
    )
    .option('--json', 'Output machine-readable JSON only', false)
    .option('--force', 'Overwrite existing output directory', false)
    .option(
        '--framework <name>',
        'Target framework: express (default) or fastify',
        parseFramework,
        'express'
    )
    .option(
        '--jobs <provider>',
        'Add background job scaffolding (bullmq or pg-boss)',
        parseJobs
    )
    .option('--ws', 'Add WebSocket support for real-time model events')
    .action(generateCommand);

program
    .command('add')
    .description('Add a new module for a specific model from the schema')
    .argument('<model>', 'Model name from the Prisma schema (e.g., Comment)')
    .requiredOption(
        '-s, --schema <path>',
        'Path to the Prisma schema file (.prisma)'
    )
    .requiredOption('-o, --output <path>', 'Output directory of the existing generated project')
    .option('--json', 'Output machine-readable JSON only', false)
    .option('--force', 'Overwrite existing module directory', false)
    .option(
        '--framework <name>',
        'Target framework: express (default) or fastify',
        parseFramework,
        'express'
    )
    .action(addCommand);

program
    .command('diff')
    .description('Show what would change if you regenerated from the current schema')
    .requiredOption(
        '-s, --schema <path>',
        'Path to the Prisma schema file (.prisma)'
    )
    .requiredOption('-o, --output <path>', 'Output directory to compare against')
    .option('--json', 'Output machine-readable JSON only', false)
    .option(
        '--framework <name>',
        'Target framework: express (default) or fastify',
        parseFramework,
        'express'
    )
    .action(diffCommand);

program
    .command('eject')
    .description('Strip @bcm directives from generated code')
    .argument('<path>', 'Path to the generated project directory')
    .action(ejectCommand);

program
    .command('validate')
    .description('Check schema for directive issues without generating any files')
    .requiredOption('-s, --schema <path>', 'Path to the Prisma schema file (.prisma)')
    .option('--json', 'Output machine-readable JSON only', false)
    .action(validateCommand);

program.parse();
