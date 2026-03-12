import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate middleware files: error, auth, rate-limit, validation.
 */
export function generateMiddlewareFiles(schema: ParsedSchema, framework: 'express' | 'fastify' = 'express'): GeneratedFile[] {
    const hasAnyAuth = schema.models.some(
        (m) => m.isAuthModel || m.directives.includes('protected') || m.directives.includes('auth')
    );
    const hasUploads = schema.models.some((m) => m.fields.some((f) => f.directives.includes('upload')));
    const data = { framework };

    const isFastify = framework === 'fastify';

    const files: GeneratedFile[] = [
        {
            path: 'src/middlewares/error.middleware.ts',
            content: renderTemplate(
                isFastify ? 'middleware/error-fastify.middleware.ts.ejs' : 'middleware/error.middleware.ts.ejs',
                data
            ),
        },
        {
            path: 'src/middlewares/rate-limit.middleware.ts',
            content: renderTemplate(
                isFastify
                    ? 'middleware/rate-limit-fastify.middleware.ts.ejs'
                    : 'middleware/rate-limit.middleware.ts.ejs',
                data
            ),
        },
        {
            path: 'src/middlewares/validation.middleware.ts',
            content: renderTemplate(
                isFastify
                    ? 'middleware/validation-fastify.middleware.ts.ejs'
                    : 'middleware/validation.middleware.ts.ejs',
                data
            ),
        },
    ];

    if (hasAnyAuth) {
        files.push({
            path: 'src/middlewares/auth.middleware.ts',
            content: renderTemplate(
                isFastify ? 'middleware/auth-fastify.middleware.ts.ejs' : 'middleware/auth.middleware.ts.ejs',
                data
            ),
        });
    }

    if (hasUploads) {
        files.push({
            path: 'src/middlewares/upload.middleware.ts',
            content: renderTemplate(
                isFastify
                    ? 'middleware/upload-fastify.middleware.ts.ejs'
                    : 'middleware/upload.middleware.ts.ejs',
                data
            ),
        });
    }

    return files;
}
