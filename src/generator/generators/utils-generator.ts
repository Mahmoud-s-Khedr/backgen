import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate utility files: query-builder, response helpers.
 */
export function generateUtilsFiles(
    schema: ParsedSchema,
    framework: 'express' | 'fastify' = 'express'
): GeneratedFile[] {
    const data = { datasource: schema.datasource, framework };

    return [
        {
            path: 'src/utils/query-builder.ts',
            content: renderTemplate('utils/query-builder.ts.ejs', data),
        },
        {
            path: 'src/utils/response.ts',
            content: renderTemplate(
                framework === 'fastify' ? 'utils/response-fastify.ts.ejs' : 'utils/response.ts.ejs',
                data
            ),
        },
    ];
}
