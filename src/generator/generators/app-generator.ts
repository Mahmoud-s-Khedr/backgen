import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate app.ts and server.ts entry points.
 */
export function generateAppFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = {
        models: schema.models,
        schema,
    };

    return [
        {
            path: 'src/app.ts',
            content: renderTemplate('app.ts.ejs', data),
        },
        {
            path: 'src/server.ts',
            content: renderTemplate('server.ts.ejs', data),
        },
    ];
}
