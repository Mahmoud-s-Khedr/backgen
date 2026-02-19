/**
 * Template engine utilities.
 * Provides EJS rendering with common helper functions for code generation.
 */

import ejs from 'ejs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pluralizeLib from 'pluralize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve template path relative to the templates directory */
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

export interface TemplateHelpers {
    toCamelCase: (str: string) => string;
    toPascalCase: (str: string) => string;
    toKebabCase: (str: string) => string;
    toSnakeCase: (str: string) => string;
    pluralize: (str: string) => string;
    singularize: (str: string) => string;
    toLowerCase: (str: string) => string;
    prismaToZodType: (prismaType: string) => string;
    prismaToTsType: (prismaType: string) => string;
}

/**
 * Common helpers injected into every EJS template.
 */
export const helpers: TemplateHelpers = {
    toCamelCase(str: string): string {
        return str.charAt(0).toLowerCase() + str.slice(1);
    },

    toPascalCase(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    toKebabCase(str: string): string {
        return str
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
    },

    toSnakeCase(str: string): string {
        return str
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .toLowerCase();
    },

    pluralize(str: string): string {
        return pluralizeLib.plural(str);
    },

    singularize(str: string): string {
        return pluralizeLib.singular(str);
    },

    toLowerCase(str: string): string {
        return str.toLowerCase();
    },

    /** Map Prisma scalar types to Zod validation */
    prismaToZodType(prismaType: string): string {
        const map: Record<string, string> = {
            'String': 'z.string()',
            'Int': 'z.number().int()',
            'Float': 'z.number()',
            'Decimal': 'z.number()',
            'Boolean': 'z.boolean()',
            'DateTime': 'z.string().datetime()',
            'Json': 'z.any()',
            'Bytes': 'z.string()',
            'BigInt': 'z.bigint()',
        };
        return map[prismaType] || `z.string()`;
    },

    /** Map Prisma scalar types to TypeScript types */
    prismaToTsType(prismaType: string): string {
        const map: Record<string, string> = {
            'String': 'string',
            'Int': 'number',
            'Float': 'number',
            'Decimal': 'number',
            'Boolean': 'boolean',
            'DateTime': 'Date',
            'Json': 'any',
            'Bytes': 'Buffer',
            'BigInt': 'bigint',
        };
        return map[prismaType] || prismaType;
    },
};

/**
 * Render an EJS template with data and helpers.
 *
 * @param templateName - Relative path within the templates directory (e.g., 'module/controller.ts.ejs')
 * @param data - Template-specific data
 * @returns Rendered template content
 */
export function renderTemplate(templateName: string, data: Record<string, any>): string {
    const templatePath = join(TEMPLATES_DIR, templateName);

    // When running from source (dev), templates are in src/templates/
    // When running from dist, they need to be copied
    let templateContent: string;
    try {
        templateContent = readFileSync(templatePath, 'utf-8');
    } catch {
        // Fallback: templates may be in src/ when running in development (tsx)
        const srcPath = join(__dirname, '..', '..', 'src', 'templates', templateName);
        try {
            templateContent = readFileSync(srcPath, 'utf-8');
        } catch {
            throw new Error(
                `Template not found: "${templateName}"\n  Tried: ${templatePath}\n  Tried: ${srcPath}`
            );
        }
    }

    return ejs.render(templateContent, { ...data, h: helpers }, {
        filename: templatePath, // For EJS includes
        escape: (val: any) => String(val), // Disable HTML escaping — we're generating code, not HTML
    });
}

/**
 * Render a template from a raw EJS string (for inline templates).
 */
export function renderInline(template: string, data: Record<string, any>): string {
    return ejs.render(template, { ...data, h: helpers }, {
        escape: (val: any) => String(val),
    });
}
