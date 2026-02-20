/**
 * Template engine utilities.
 * Provides EJS rendering with common helper functions for code generation.
 */

import ejs from 'ejs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// Default import: `pluralize` is CJS with `module.exports = fn`. Named imports not available.
import pluralizeLib from 'pluralize';

/** Canonical set of Prisma scalar types. Shared by parser and generators. */
export const PRISMA_SCALAR_TYPES = new Set([
    'String', 'Int', 'Float', 'Boolean', 'DateTime',
    'Json', 'Bytes', 'BigInt', 'Decimal',
]);

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
        if (!map[prismaType]) {
            console.warn(`Warning: Unknown Prisma type "${prismaType}", defaulting to z.string()`);
        }
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
 * Optional in-memory template store for browser environments.
 * When set, renderTemplate reads from this map instead of the filesystem.
 */
let templateStore: Map<string, string> | null = null;

/**
 * Set an in-memory template store (for browser/playground use).
 * Pass null to revert to filesystem-based template loading.
 */
export function setTemplateStore(store: Map<string, string> | null): void {
    templateStore = store;
}

/**
 * Render an EJS template with data and helpers.
 *
 * @param templateName - Relative path within the templates directory (e.g., 'module/controller.ts.ejs')
 * @param data - Template-specific data
 * @returns Rendered template content
 */
export function renderTemplate(templateName: string, data: Record<string, any>): string {
    let templateContent: string;

    if (templateStore) {
        // Browser mode: read from in-memory store
        const content = templateStore.get(templateName);
        if (!content) {
            throw new Error(`Template not found in store: "${templateName}"`);
        }
        templateContent = content;
    } else {
        // Node.js mode: read from filesystem
        const templatePath = join(TEMPLATES_DIR, templateName);
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
    }

    return ejs.render(templateContent, { ...data, h: helpers }, {
        filename: templateName, // For EJS includes
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
