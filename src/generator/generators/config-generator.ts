import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate config files: database, swagger, cors, logger, env.
 * Conditionally generates redis.ts and upload.ts when schema uses those features.
 */
export function generateConfigFiles(schema: ParsedSchema, framework: 'express' | 'fastify' = 'express', jobsProvider?: 'bullmq' | 'pg-boss'): GeneratedFile[] {
    const hasCache = schema.models.some((m) => m.cacheConfig != null);
    const hasUploads = schema.models.some((m) => m.fields.some((f) => f.directives.includes('upload')));
    const hasAuth = schema.models.some((m) => m.isAuthModel);
    const data = { schema, hasCache, hasUploads, hasAuth, framework, provider: schema.datasource.provider, jobsProvider: jobsProvider ?? null };

    const files: GeneratedFile[] = [
        {
            path: 'src/config/database.ts',
            content: renderTemplate('config/database.ts.ejs', data),
        },
        {
            path: 'src/config/swagger.ts',
            content: renderTemplate(
                framework === 'fastify' ? 'config/swagger-fastify.ts.ejs' : 'config/swagger.ts.ejs',
                data
            ),
        },
        {
            path: 'src/config/cors.ts',
            content: renderTemplate('config/cors.ts.ejs', data),
        },
        {
            path: 'src/config/logger.ts',
            content: renderTemplate('config/logger.ts.ejs', data),
        },
        {
            path: 'src/config/env.ts',
            content: renderTemplate('config/env.ts.ejs', data),
        },
    ];

    if (hasCache || hasAuth || jobsProvider === 'bullmq') {
        files.push({
            path: 'src/config/redis.ts',
            content: renderTemplate('config/redis.ts.ejs', data),
        });
    }

    if (hasUploads) {
        files.push({
            path: 'src/config/upload.ts',
            content: renderTemplate(
                framework === 'fastify' ? 'config/upload-fastify.ts.ejs' : 'config/upload.ts.ejs',
                data
            ),
        });
    }

    return files;
}
