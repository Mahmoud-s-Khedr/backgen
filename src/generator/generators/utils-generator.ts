import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate utility files: query-builder, response helpers.
 */
export function generateUtilsFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = { datasource: schema.datasource };

    return [
        {
            path: 'src/utils/query-builder.ts',
            content: renderTemplate('utils/query-builder.ts.ejs', data),
        },
        {
            path: 'src/utils/response.ts',
            content: renderTemplate('utils/response.ts.ejs', data),
        },
    ];
}
