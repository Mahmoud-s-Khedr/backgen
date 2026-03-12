import type { ParsedSchema, GeneratedFile, GenerateOptions } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';
import { basename, resolve } from 'path';

/**
 * Generate infrastructure files: Dockerfile, docker-compose, CI, .env.example,
 * .dockerignore, .gitignore, README, package.json, tsconfig.json.
 */
export function generateInfraFiles(schema: ParsedSchema, options?: GenerateOptions): GeneratedFile[] {
    const resolvedPath = resolve(options?.output || '.');
    const projectName = basename(resolvedPath) || 'api-server';
    const hasCache = schema.models.some((m) => m.cacheConfig != null);
    const hasUploads = schema.models.some((m) => m.fields.some((f) => f.directives.includes('upload')));
    const hasAuth = schema.models.some((m) => m.isAuthModel);
    const framework = options?.framework ?? 'express';
    const data = {
        models: schema.models,
        schema,
        projectName,
        provider: schema.datasource.provider,
        hasCache,
        hasUploads,
        hasAuth,
        framework,
    };

    return [
        {
            path: 'package.json',
            content: renderTemplate('package.json.ejs', data),
        },
        {
            path: 'prisma.config.ts',
            content: renderTemplate('config/prisma.config.ts.ejs', data),
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
            path: 'docker-entrypoint.sh',
            content: renderTemplate('infra/docker-entrypoint.sh.ejs', data),
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
            path: '.dockerignore',
            content: renderTemplate('infra/dockerignore.ejs', data),
        },
        {
            path: '.gitignore',
            content: renderTemplate('infra/gitignore.ejs', data),
        },
        {
            path: 'README.md',
            content: renderTemplate('infra/README.md.ejs', data),
        },
        {
            path: 'vitest.config.ts',
            content: renderTemplate('vitest.config.ts.ejs', data),
        },
    ];
}
