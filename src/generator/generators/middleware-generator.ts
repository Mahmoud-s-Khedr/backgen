import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate middleware files: error, auth, rate-limit, validation.
 */
export function generateMiddlewareFiles(schema: ParsedSchema): GeneratedFile[] {
    const hasAnyAuth = schema.models.some(
        (m) => m.isAuthModel || m.directives.includes('protected') || m.directives.includes('auth')
    );
    const data = {};

    const files: GeneratedFile[] = [
        {
            path: 'src/middlewares/error.middleware.ts',
            content: renderTemplate('middleware/error.middleware.ts.ejs', data),
        },
        {
            path: 'src/middlewares/rate-limit.middleware.ts',
            content: renderTemplate('middleware/rate-limit.middleware.ts.ejs', data),
        },
        {
            path: 'src/middlewares/validation.middleware.ts',
            content: renderTemplate('middleware/validation.middleware.ts.ejs', data),
        },
    ];

    if (hasAnyAuth) {
        files.push({
            path: 'src/middlewares/auth.middleware.ts',
            content: renderTemplate('middleware/auth.middleware.ts.ejs', data),
        });
    }

    return files;
}
