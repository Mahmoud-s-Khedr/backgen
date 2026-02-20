import type { ParsedSchema, GeneratedFile, GenerateOptions } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';
import { basename, resolve } from 'path';

/**
 * Generate infrastructure files: Dockerfile, docker-compose, CI, .env.example,
 * .gitignore, README, package.json, tsconfig.json.
 */
export function generateInfraFiles(schema: ParsedSchema, options?: GenerateOptions): GeneratedFile[] {
    const resolvedPath = resolve(options?.output || '.');
    const projectName = basename(resolvedPath) || 'api-server';
    const data = {
        models: schema.models,
        schema,
        projectName,
        provider: schema.datasource.provider,
    };

    return [
        {
            path: 'package.json',
            content: renderTemplate('package.json.ejs', data),
        },
        {
            path: 'tsconfig.json',
            content: renderTemplate('tsconfig.json.ejs', data),
        },
        {
            path: 'Dockerfile',
            content: renderTemplate('infra/Dockerfile.ejs', data),
        },
        {
            path: 'docker-compose.yml',
            content: renderTemplate('infra/docker-compose.yml.ejs', data),
        },
        {
            path: '.github/workflows/ci.yml',
            content: renderTemplate('infra/ci.yml.ejs', data),
        },
        {
            path: '.env.example',
            content: renderTemplate('infra/env.example.ejs', data),
        },
        {
            path: '.gitignore',
            content: renderTemplate('infra/gitignore.ejs', data),
        },
        {
            path: 'README.md',
            content: renderTemplate('infra/README.md.ejs', data),
        },
    ];
}
