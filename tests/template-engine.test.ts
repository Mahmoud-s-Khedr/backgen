import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    helpers,
    PRISMA_SCALAR_TYPES,
    renderInline,
    renderTemplate,
    setTemplateStore,
} from '../src/generator/template-engine.js';

afterEach(() => {
    setTemplateStore(null);
    vi.restoreAllMocks();
});

describe('PRISMA_SCALAR_TYPES', () => {
    it('contains all expected scalar types', () => {
        const expected = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'BigInt', 'Decimal'];
        for (const type of expected) {
            expect(PRISMA_SCALAR_TYPES.has(type)).toBe(true);
        }
    });

    it('does not contain non-scalar types', () => {
        expect(PRISMA_SCALAR_TYPES.has('User')).toBe(false);
        expect(PRISMA_SCALAR_TYPES.has('Post')).toBe(false);
        expect(PRISMA_SCALAR_TYPES.has('Role')).toBe(false);
    });
});

describe('helpers', () => {
    describe('toCamelCase', () => {
        it('lowercases first character', () => {
            expect(helpers.toCamelCase('User')).toBe('user');
            expect(helpers.toCamelCase('BlogPost')).toBe('blogPost');
        });

        it('preserves already-camelCase strings', () => {
            expect(helpers.toCamelCase('user')).toBe('user');
        });

        it('normalizes acronyms, separators, and whitespace', () => {
            expect(helpers.toCamelCase('APIUser')).toBe('apiUser');
            expect(helpers.toCamelCase('user_profile')).toBe('userProfile');
            expect(helpers.toCamelCase('user-profile')).toBe('userProfile');
            expect(helpers.toCamelCase('api user')).toBe('apiUser');
        });
    });

    describe('toPascalCase', () => {
        it('uppercases first character', () => {
            expect(helpers.toPascalCase('user')).toBe('User');
            expect(helpers.toPascalCase('blogPost')).toBe('BlogPost');
        });

        it('preserves already-PascalCase strings', () => {
            expect(helpers.toPascalCase('User')).toBe('User');
        });

        it('normalizes acronyms, separators, and whitespace', () => {
            expect(helpers.toPascalCase('APIUser')).toBe('ApiUser');
            expect(helpers.toPascalCase('user_profile')).toBe('UserProfile');
            expect(helpers.toPascalCase('user-profile')).toBe('UserProfile');
            expect(helpers.toPascalCase('api user')).toBe('ApiUser');
        });
    });

    describe('toKebabCase', () => {
        it('converts PascalCase to kebab-case', () => {
            expect(helpers.toKebabCase('BlogPost')).toBe('blog-post');
            expect(helpers.toKebabCase('UserProfile')).toBe('user-profile');
        });

        it('handles single word', () => {
            expect(helpers.toKebabCase('User')).toBe('user');
        });

        it('converts spaces and underscores to hyphens', () => {
            expect(helpers.toKebabCase('my api')).toBe('my-api');
            expect(helpers.toKebabCase('my_api')).toBe('my-api');
        });
    });

    describe('toSnakeCase', () => {
        it('converts PascalCase to snake_case', () => {
            expect(helpers.toSnakeCase('BlogPost')).toBe('blog_post');
        });

        it('converts spaces and hyphens to underscores', () => {
            expect(helpers.toSnakeCase('my api')).toBe('my_api');
            expect(helpers.toSnakeCase('my-api')).toBe('my_api');
        });
    });

    describe('pluralize', () => {
        it('pluralizes common words', () => {
            expect(helpers.pluralize('User')).toBe('Users');
            expect(helpers.pluralize('Post')).toBe('Posts');
            expect(helpers.pluralize('Category')).toBe('Categories');
            expect(helpers.pluralize('Person')).toBe('People');
        });
    });

    describe('singularize', () => {
        it('singularizes common words', () => {
            expect(helpers.singularize('Users')).toBe('User');
            expect(helpers.singularize('Categories')).toBe('Category');
            expect(helpers.singularize('People')).toBe('Person');
        });
    });

    describe('toLowerCase', () => {
        it('lowercases strings', () => {
            expect(helpers.toLowerCase('User')).toBe('user');
            expect(helpers.toLowerCase('ABC')).toBe('abc');
        });
    });

    describe('prismaToZodType', () => {
        it('maps String to z.string()', () => {
            expect(helpers.prismaToZodType('String')).toBe('z.string()');
        });

        it('maps Int to z.number().int()', () => {
            expect(helpers.prismaToZodType('Int')).toBe('z.number().int()');
        });

        it('maps Float to z.number()', () => {
            expect(helpers.prismaToZodType('Float')).toBe('z.number()');
        });

        it('maps Boolean to z.boolean()', () => {
            expect(helpers.prismaToZodType('Boolean')).toBe('z.boolean()');
        });

        it('maps DateTime to z.string().datetime()', () => {
            expect(helpers.prismaToZodType('DateTime')).toBe('z.string().datetime()');
        });

        it('maps Json to z.any()', () => {
            expect(helpers.prismaToZodType('Json')).toBe('z.any()');
        });

        it('maps BigInt to z.bigint()', () => {
            expect(helpers.prismaToZodType('BigInt')).toBe('z.bigint()');
        });

        it('maps Decimal to z.number()', () => {
            expect(helpers.prismaToZodType('Decimal')).toBe('z.number()');
        });

        it('defaults unknown types to z.string() silently', () => {
            expect(helpers.prismaToZodType('UnknownType')).toBe('z.string()');
        });
    });

    describe('prismaToTsType', () => {
        it('maps String to string', () => {
            expect(helpers.prismaToTsType('String')).toBe('string');
        });

        it('maps Int/Float/Decimal to number', () => {
            expect(helpers.prismaToTsType('Int')).toBe('number');
            expect(helpers.prismaToTsType('Float')).toBe('number');
            expect(helpers.prismaToTsType('Decimal')).toBe('number');
        });

        it('maps Boolean to boolean', () => {
            expect(helpers.prismaToTsType('Boolean')).toBe('boolean');
        });

        it('maps DateTime to Date', () => {
            expect(helpers.prismaToTsType('DateTime')).toBe('Date');
        });

        it('returns unknown types as-is', () => {
            expect(helpers.prismaToTsType('Role')).toBe('Role');
        });
    });
});

describe('renderInline', () => {
    it('renders simple EJS template with data', () => {
        const result = renderInline('Hello <%= name %>!', { name: 'World' });
        expect(result).toBe('Hello World!');
    });

    it('injects helpers as h', () => {
        const result = renderInline('<%= h.toCamelCase(name) %>', { name: 'BlogPost' });
        expect(result).toBe('blogPost');
    });

    it('renders with conditionals', () => {
        const template = '<% if (show) { %>visible<% } else { %>hidden<% } %>';
        expect(renderInline(template, { show: true })).toBe('visible');
        expect(renderInline(template, { show: false })).toBe('hidden');
    });

    it('renders loops', () => {
        const template = '<% for (const item of items) { %><%= item %> <% } %>';
        const result = renderInline(template, { items: ['a', 'b', 'c'] });
        expect(result).toBe('a b c ');
    });

    it('does not HTML-escape code output', () => {
        const result = renderInline('<%= code %>', { code: 'a<b>c' });
        expect(result).toBe('a<b>c');
    });
});

describe('renderTemplate', () => {
    it('renders templates from in-memory store when setTemplateStore is configured', () => {
        setTemplateStore(new Map([
            ['mock/template.ejs', 'Hello <%= name %> from <%= h.toPascalCase(place) %>'],
        ]));

        const result = renderTemplate('mock/template.ejs', { name: 'mk', place: 'playground' });
        expect(result).toBe('Hello mk from Playground');
    });

    it('throws a clear error when template is missing in in-memory store', () => {
        setTemplateStore(new Map([
            ['known.ejs', 'ok'],
        ]));

        expect(() => renderTemplate('unknown.ejs', {})).toThrow('Template not found in store: "unknown.ejs"');
    });

    it('falls back to second read attempt when the first filesystem read fails', async () => {
        vi.resetModules();

        let readAttempts = 0;
        vi.doMock('fs', async () => {
            const actual = await vi.importActual<typeof import('fs')>('fs');
            return {
                ...actual,
                readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
                    readAttempts += 1;
                    if (readAttempts === 1) {
                        throw new Error('Simulated missing primary template path');
                    }
                    return actual.readFileSync(...args);
                }) as typeof actual.readFileSync,
            };
        });

        const isolatedModule = await import('../src/generator/template-engine.js');
        const rendered = isolatedModule.renderTemplate('config/logger.ts.ejs', {});

        expect(rendered).toContain("import { pino } from 'pino'");
        expect(readAttempts).toBe(2);

        isolatedModule.setTemplateStore(null);
        vi.doUnmock('fs');
        vi.resetModules();
    });

    it('throws a descriptive error when template does not exist on disk', () => {
        setTemplateStore(null);

        expect(() => renderTemplate('missing/template.ejs', {})).toThrow('Template not found: "missing/template.ejs"');
        expect(() => renderTemplate('missing/template.ejs', {})).toThrow('Tried:');
    });
});
