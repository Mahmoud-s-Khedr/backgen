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
    const hasEvent = schema.models.some((m) => m.isEvent) || schema.models.some((m) => m.directives.includes('ws'));
    const hasAudit = schema.models.some((m) => m.isAudit);

    const files: GeneratedFile[] = [
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

    if (hasEvent) {
        files.push({
            path: 'src/utils/event-bus.ts',
            content: renderTemplate('utils/event-bus.ts.ejs', data),
        });
    }

    if (hasAudit) {
        files.push({
            path: 'src/utils/audit.ts',
            content: renderTemplate('utils/audit.ts.ejs', data),
        });
    }

    return files;
}
