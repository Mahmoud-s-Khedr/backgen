import { join, resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';

/**
 * `bcm init <project-name>`
 * Scaffolds an empty project directory with starter files.
 */
export async function initCommand(projectName: string): Promise<void> {
    const projectDir = resolve(process.cwd(), projectName);

    console.log(
        chalk.blue('\n🚀 Initializing Backend Creator project:'),
        chalk.bold(projectName)
    );

    // Check if directory already exists
    if (await fs.pathExists(projectDir)) {
        console.error(
            chalk.red(`\n✖ Directory "${projectName}" already exists.`),
            chalk.yellow('Choose a different name or remove the existing directory.')
        );
        process.exit(1);
    }

    const spinner = ora('Creating project structure...').start();

    try {
        // Create base directories
        await fs.ensureDir(join(projectDir, 'prisma'));
        await fs.ensureDir(join(projectDir, 'src'));

        // Write starter package.json
        const packageJson = {
            name: projectName,
            version: '0.1.0',
            private: true,
            scripts: {
                dev: 'tsx watch src/server.ts',
                build: 'tsc',
                start: 'node dist/server.js',
                test: 'jest',
                migrate: 'prisma migrate dev',
                seed: 'tsx prisma/seed.ts',
                studio: 'prisma studio',
            },
        };
        await fs.writeJson(join(projectDir, 'package.json'), packageJson, {
            spaces: 2,
        });

        // Write starter tsconfig.json
        const tsconfig = {
            compilerOptions: {
                target: 'ES2022',
                module: 'Node16',
                moduleResolution: 'Node16',
                outDir: './dist',
                rootDir: './src',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
                resolveJsonModule: true,
                declaration: true,
                sourceMap: true,
            },
            include: ['src/**/*'],
            exclude: ['node_modules', 'dist'],
        };
        await fs.writeJson(join(projectDir, 'tsconfig.json'), tsconfig, {
            spaces: 2,
        });

        // Write starter Prisma schema
        const starterSchema = `// This is your Prisma schema file.
// Learn more: https://pris.ly/d/prisma-schema
//
// After editing, run:
//   bcm generate --schema ./prisma/schema.prisma --output .

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// Define your models below. Use /// @bcm.* directives for API behavior.
// Available directives:
//   /// @bcm.hidden    - Exclude field from all API responses
//   /// @bcm.readonly  - Field cannot be set via API
//   /// @bcm.writeOnly - Accept on write, never return in response

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  /// @bcm.hidden
  password  String
  name      String?
  /// @bcm.readonly
  createdAt DateTime @default(now())
  /// @bcm.readonly
  updatedAt DateTime @updatedAt
}
`;
        await fs.writeFile(join(projectDir, 'prisma', 'schema.prisma'), starterSchema);

        // Write .gitignore
        const gitignore = `node_modules/
dist/
.env
*.log
`;
        await fs.writeFile(join(projectDir, '.gitignore'), gitignore);

        spinner.succeed(chalk.green('Project created successfully!'));

        // Print next steps
        console.log(chalk.cyan('\n📋 Next steps:\n'));
        console.log(`  ${chalk.gray('1.')} cd ${chalk.bold(projectName)}`);
        console.log(
            `  ${chalk.gray('2.')} Edit ${chalk.bold('prisma/schema.prisma')} with your models`
        );
        console.log(
            `  ${chalk.gray('3.')} bcm generate --schema ./prisma/schema.prisma --output .`
        );
        console.log(`  ${chalk.gray('4.')} npm install`);
        console.log(`  ${chalk.gray('5.')} npx prisma migrate dev --name init`);
        console.log(`  ${chalk.gray('6.')} npm run dev`);
        console.log();
    } catch (error) {
        spinner.fail(chalk.red('Failed to create project'));
        console.error(error);
        process.exit(1);
    }
}
