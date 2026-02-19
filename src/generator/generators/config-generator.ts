import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate config files: database, swagger, cors, logger, env.
 */
export function generateConfigFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = { schema };

    return [
        {
            path: 'src/config/database.ts',
            content: renderTemplate('config/database.ts.ejs', data),
        },
        {
            path: 'src/config/swagger.ts',
            content: renderTemplate('config/swagger.ts.ejs', data),
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
}
