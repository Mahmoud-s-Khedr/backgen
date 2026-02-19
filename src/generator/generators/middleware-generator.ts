import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate middleware files: error, auth, rate-limit, validation.
 */
export function generateMiddlewareFiles(_schema: ParsedSchema): GeneratedFile[] {
    const data = {};

    return [
        {
            path: 'src/middlewares/error.middleware.ts',
            content: renderTemplate('middleware/error.middleware.ts.ejs', data),
        },
        {
            path: 'src/middlewares/auth.middleware.ts',
            content: renderTemplate('middleware/auth.middleware.ts.ejs', data),
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
}
