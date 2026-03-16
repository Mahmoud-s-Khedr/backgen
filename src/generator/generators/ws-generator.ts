import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate WebSocket support files.
 * Only called when --ws flag is provided.
 */
export function generateWsFiles(schema: ParsedSchema): GeneratedFile[] {
    const wsModels = schema.models
        .filter(m => m.directives.includes('ws'))
        .map(m => m.name);

    const data = { wsModels };

    return [
        {
            path: 'src/ws/ws-types.ts',
            content: renderTemplate('ws/ws-types.ts.ejs', data),
        },
        {
            path: 'src/ws/ws-server.ts',
            content: renderTemplate('ws/ws-server.ts.ejs', data),
        },
        {
            path: 'src/ws/ws-broadcast.ts',
            content: renderTemplate('ws/ws-broadcast.ts.ejs', data),
        },
    ];
}
