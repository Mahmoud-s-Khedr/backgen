/**
 * Browser-compatible generator wrapper.
 *
 * Uses esbuild-bundled generator from the main package with templates
 * injected via setTemplateStore() at initialization time.
 *
 * This file is the single integration point between the playground UI
 * and the backgen generator core.
 */
import { TEMPLATES } from './generated/templates.js';

// We use dynamic import + the pre-built bundle approach.
// The generator is bundled into a single ESM file by the playground build script.
// For now, we re-implement just the parts needed for browser use.

import ejs from 'ejs';
import { getSchema } from '@mrleebo/prisma-ast';
import pluralizeLib from 'pluralize';

// Types (duplicated from main package to avoid import issues)
export interface FieldDefinition {
    name: string;
    type: string;
    isList: boolean;
    isOptional: boolean;
    isId: boolean;
    isUnique: boolean;
    isRelation: boolean;
    isEnum: boolean;
    relationModel?: string;
    relationField?: string;
    hasDefault: boolean;
    defaultValue?: string;
    directives: string[];
}

export interface ModelDefinition {
    name: string;
    fields: FieldDefinition[];
    directives: string[];
    authRoles?: string[];
}

export interface EnumDefinition {
    name: string;
    values: string[];
}

export interface DatasourceConfig {
    provider: string;
    url: string;
}

export interface ParsedSchema {
    models: ModelDefinition[];
    enums: EnumDefinition[];
    datasource: DatasourceConfig;
}

export interface GeneratedFile {
    path: string;
    content: string;
}

// ==================== Helpers ====================

const PRISMA_SCALAR_TYPES = new Set([
    'String', 'Int', 'Float', 'Boolean', 'DateTime',
    'Json', 'Bytes', 'BigInt', 'Decimal',
]);

const helpers = {
    toCamelCase(str: string) { return str.charAt(0).toLowerCase() + str.slice(1); },
    toPascalCase(str: string) { return str.charAt(0).toUpperCase() + str.slice(1); },
    toKebabCase(str: string) {
        return str.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase();
    },
    toSnakeCase(str: string) {
        return str.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
    },
    pluralize(str: string) { return pluralizeLib.plural(str); },
    singularize(str: string) { return pluralizeLib.singular(str); },
    toLowerCase(str: string) { return str.toLowerCase(); },
    prismaToZodType(prismaType: string) {
        const map: Record<string, string> = {
            'String': 'z.string()', 'Int': 'z.number().int()', 'Float': 'z.number()',
            'Decimal': 'z.number()', 'Boolean': 'z.boolean()', 'DateTime': 'z.string().datetime()',
            'Json': 'z.any()', 'Bytes': 'z.string()', 'BigInt': 'z.bigint()',
        };
        return map[prismaType] || 'z.string()';
    },
    prismaToTsType(prismaType: string) {
        const map: Record<string, string> = {
            'String': 'string', 'Int': 'number', 'Float': 'number', 'Decimal': 'number',
            'Boolean': 'boolean', 'DateTime': 'Date', 'Json': 'any', 'Bytes': 'Buffer', 'BigInt': 'bigint',
        };
        return map[prismaType] || prismaType;
    },
};

function renderTemplate(name: string, data: Record<string, unknown>): string {
    const content = TEMPLATES.get(name);
    if (!content) throw new Error(`Template not found: ${name}`);
    return ejs.render(content, { ...data, h: helpers }, {
        escape: (val: unknown) => String(val),
    });
}

// ==================== Parser ====================

function parseDirectives(schemaContent: string) {
    const lines = schemaContent.split('\n');
    const results = new Map<string, { modelDirectives: string[]; authRoles?: string[]; fields: Map<string, string[]>; warnings: string[] }>();
    let currentModel: string | null = null;
    let pendingFieldDirectives: string[] = [];
    let pendingModelDirectives: string[] = [];
    let pendingAuthRoles: string[] = [];

    const DIRECTIVE_REGEX = /^\/\/\/\s*@bcm\.(\w+)(?:\(([^)]*)\))?\s*$/;
    const MODEL_DIRECTIVES = new Set(['protected', 'softDelete', 'auth']);
    const FIELD_DIRECTIVES = new Set(['hidden', 'readonly', 'writeOnly', 'searchable', 'nested']);

    for (const line of lines) {
        const trimmed = line.trim();
        const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
        if (modelMatch) {
            currentModel = modelMatch[1];
            if (!results.has(currentModel)) {
                results.set(currentModel, {
                    modelDirectives: [...pendingModelDirectives],
                    authRoles: pendingAuthRoles.length > 0 ? [...pendingAuthRoles] : undefined,
                    fields: new Map(),
                    warnings: [],
                });
            }
            pendingFieldDirectives = []; pendingModelDirectives = []; pendingAuthRoles = [];
            continue;
        }
        if (trimmed === '}') { currentModel = null; pendingFieldDirectives = []; pendingModelDirectives = []; pendingAuthRoles = []; continue; }

        const directiveMatch = trimmed.match(DIRECTIVE_REGEX);
        if (directiveMatch) {
            const name = directiveMatch[1];
            const args = directiveMatch[2];
            if (MODEL_DIRECTIVES.has(name)) {
                if (!currentModel) {
                    pendingModelDirectives.push(name);
                    if (name === 'auth' && args) {
                        const roleMatch = args.match(/roles:\s*\[([^\]]*)\]/);
                        if (roleMatch) pendingAuthRoles = roleMatch[1].split(',').map(r => r.trim()).filter(Boolean);
                    }
                }
            } else if (FIELD_DIRECTIVES.has(name) && currentModel) {
                pendingFieldDirectives.push(name);
            }
            continue;
        }
        if (trimmed === '' || trimmed.startsWith('//')) continue;
        if (!currentModel) continue;
        const fieldMatch = trimmed.match(/^(\w+)\s+/);
        if (fieldMatch && pendingFieldDirectives.length > 0) {
            const result = results.get(currentModel)!;
            result.fields.set(fieldMatch[1], [...pendingFieldDirectives]);
        }
        pendingFieldDirectives = [];
    }
    return results;
}

export function parsePrismaSchema(schemaContent: string): ParsedSchema {
    const ast = getSchema(schemaContent);
    const directivesMap = parseDirectives(schemaContent);
    const models: ModelDefinition[] = [];
    const enums: EnumDefinition[] = [];
    let datasource: DatasourceConfig = { provider: 'postgresql', url: 'env("DATABASE_URL")' };

    const enumNames = new Set<string>();
    for (const block of ast.list as any[]) {
        if (block.type === 'enum') enumNames.add(block.name);
    }

    for (const block of ast.list as any[]) {
        if (block.type === 'model') {
            const fields: FieldDefinition[] = [];
            for (const prop of (block.properties || [])) {
                if (prop.type !== 'field') continue;
                const fieldType = typeof prop.fieldType === 'string' ? prop.fieldType : prop.fieldType?.name || 'String';
                const attrs = prop.attributes || [];
                const isId = attrs.some((a: any) => a.name === 'id');
                const isUnique = attrs.some((a: any) => a.name === 'unique');
                const defaultAttr = attrs.find((a: any) => a.name === 'default');
                const hasDefault = !!defaultAttr || attrs.some((a: any) => a.name === 'updatedAt');
                const relationAttr = attrs.find((a: any) => a.name === 'relation');
                const isRelation = !!relationAttr;
                const isEnum = enumNames.has(fieldType);
                const isImplicit = !isRelation && !isEnum && (prop.array || !PRISMA_SCALAR_TYPES.has(fieldType));

                // Extract FK field from relation
                let relationField: string | undefined;
                if (relationAttr) {
                    for (const arg of (relationAttr.args || [])) {
                        const kv = arg.value;
                        if (kv?.type === 'keyValue' && kv.key === 'fields' && kv.value?.type === 'array') {
                            relationField = kv.value.args?.join(', ');
                        }
                    }
                }

                const directives = directivesMap.get(block.name)?.fields.get(prop.name) || [];
                fields.push({
                    name: prop.name, type: fieldType,
                    isList: prop.array === true, isOptional: prop.optional === true,
                    isId, isUnique, isRelation: isRelation || isImplicit, isEnum,
                    relationModel: (isRelation || isImplicit) ? fieldType : undefined,
                    relationField,
                    hasDefault, defaultValue: undefined, directives,
                });
            }
            const modelResult = directivesMap.get(block.name);
            models.push({
                name: block.name, fields,
                directives: modelResult?.modelDirectives ?? [],
                authRoles: modelResult?.authRoles,
            });
        } else if (block.type === 'enum') {
            const values = (block.enumerators || block.properties || [])
                .filter((e: any) => e.type === 'enumerator').map((e: any) => e.name);
            enums.push({ name: block.name, values });
        } else if (block.type === 'datasource') {
            const assignments = block.assignments || block.properties || [];
            for (const a of assignments) {
                if (a.type === 'assignment' && a.key === 'provider') {
                    datasource.provider = typeof a.value === 'string' ? a.value.replace(/"/g, '') : String(a.value);
                }
            }
        }
    }
    return { models, enums, datasource };
}

// ==================== Generators ====================

function generateModuleFiles(schema: ParsedSchema): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    for (const model of schema.models) {
        const modelLower = helpers.toCamelCase(model.name);
        const modulePath = `src/modules/${modelLower}`;
        const scalarFields = model.fields.filter(f => !f.isRelation);
        const relationFields = model.fields.filter(f => f.isRelation);
        const createFields = scalarFields.filter(f => !f.isId && !f.directives.includes('hidden') && !f.directives.includes('readonly') && (!f.hasDefault || f.directives.includes('writeOnly')));
        const responseFields = scalarFields.filter(f => !f.directives.includes('hidden') && !f.directives.includes('writeOnly'));
        const fkFields = model.fields.map(f => f.relationField).filter((f): f is string => f !== undefined);
        const filterableFields = scalarFields.filter(f => !f.directives.includes('hidden') && !f.directives.includes('writeOnly')).map(f => f.name);
        const searchableFields = scalarFields.filter(f => f.directives.includes('searchable')).map(f => f.name);
        const isProtected = model.directives.includes('protected') || model.directives.includes('auth');
        const isSoftDelete = model.directives.includes('softDelete');
        const authRoles = model.authRoles ?? [];
        const nestedRelations = relationFields.filter(f => f.directives.includes('nested') && !f.isList && f.relationModel);
        const data = { model, modelLower, scalarFields, relationFields, createFields, responseFields, fkFields, filterableFields, searchableFields, nestedRelations, allModels: schema.models, enums: schema.enums, isProtected, isSoftDelete, authRoles };
        for (const tpl of ['controller', 'service', 'routes', 'dto', 'test']) {
            files.push({ path: `${modulePath}/${modelLower}.${tpl}.ts`, content: renderTemplate(`module/${tpl}.ts.ejs`, data) });
        }
    }
    return files;
}

function generateConfigFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = { models: schema.models, schema, enums: schema.enums, datasource: schema.datasource };
    return [
        { path: 'src/config/database.ts', content: renderTemplate('config/database.ts.ejs', data) },
        { path: 'src/config/swagger.ts', content: renderTemplate('config/swagger.ts.ejs', data) },
        { path: 'src/config/cors.ts', content: renderTemplate('config/cors.ts.ejs', data) },
        { path: 'src/config/logger.ts', content: renderTemplate('config/logger.ts.ejs', data) },
        { path: 'src/config/env.ts', content: renderTemplate('config/env.ts.ejs', data) },
    ];
}

function generateMiddlewareFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = { models: schema.models, schema };
    return [
        { path: 'src/middlewares/error.middleware.ts', content: renderTemplate('middleware/error.middleware.ts.ejs', data) },
        { path: 'src/middlewares/auth.middleware.ts', content: renderTemplate('middleware/auth.middleware.ts.ejs', data) },
        { path: 'src/middlewares/rate-limit.middleware.ts', content: renderTemplate('middleware/rate-limit.middleware.ts.ejs', data) },
        { path: 'src/middlewares/validation.middleware.ts', content: renderTemplate('middleware/validation.middleware.ts.ejs', data) },
    ];
}

function generateUtilsFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = { models: schema.models, schema, datasource: schema.datasource };
    return [
        { path: 'src/utils/query-builder.ts', content: renderTemplate('utils/query-builder.ts.ejs', data) },
        { path: 'src/utils/response.ts', content: renderTemplate('utils/response.ts.ejs', data) },
    ];
}

function generateAppFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = { models: schema.models, schema };
    return [
        { path: 'src/app.ts', content: renderTemplate('app.ts.ejs', data) },
        { path: 'src/server.ts', content: renderTemplate('server.ts.ejs', data) },
    ];
}

function generateInfraFiles(schema: ParsedSchema): GeneratedFile[] {
    const data = { models: schema.models, schema, projectName: 'my-api', provider: schema.datasource.provider };
    return [
        { path: 'package.json', content: renderTemplate('package.json.ejs', data) },
        { path: 'tsconfig.json', content: renderTemplate('tsconfig.json.ejs', data) },
        { path: 'Dockerfile', content: renderTemplate('infra/Dockerfile.ejs', data) },
        { path: 'docker-compose.yml', content: renderTemplate('infra/docker-compose.yml.ejs', data) },
        { path: '.github/workflows/ci.yml', content: renderTemplate('infra/ci.yml.ejs', data) },
        { path: '.env.example', content: renderTemplate('infra/env.example.ejs', data) },
        { path: '.gitignore', content: renderTemplate('infra/gitignore.ejs', data) },
        { path: 'README.md', content: renderTemplate('infra/README.md.ejs', data) },
    ];
}

function generatePrismaFiles(schema: ParsedSchema, schemaContent?: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    if (schemaContent) {
        files.push({ path: 'prisma/schema.prisma', content: schemaContent });
    }
    try {
        files.push({ path: 'prisma/seed.ts', content: renderTemplate('prisma/seed.ts.ejs', { models: schema.models, schema, enums: schema.enums, enumNames: new Set(schema.enums.map(e => e.name)) }) });
    } catch { /* seed template may fail in browser context — skip */ }
    return files;
}

// ==================== Swagger Generator ====================

function generateSwaggerFiles(schema: ParsedSchema): GeneratedFile[] {
    const paths: Record<string, unknown> = {};
    const schemas: Record<string, unknown> = {};

    paths['/health'] = {
        get: {
            tags: ['Health'], summary: 'Health check',
            responses: { '200': { description: 'Service is healthy', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, timestamp: { type: 'string', format: 'date-time' } } } } } } },
        },
    };

    function prismaToOpenApi(type: string): Record<string, unknown> {
        const map: Record<string, Record<string, unknown>> = {
            String: { type: 'string' }, Int: { type: 'integer' }, Float: { type: 'number', format: 'float' },
            Decimal: { type: 'number', format: 'double' }, Boolean: { type: 'boolean' },
            DateTime: { type: 'string', format: 'date-time' }, Json: { type: 'object' },
            Bytes: { type: 'string', format: 'byte' }, BigInt: { type: 'integer', format: 'int64' },
        };
        if (map[type]) return map[type];
        const enumDef = schema.enums.find(e => e.name === type);
        if (enumDef) return { $ref: `#/components/schemas/${type}` };
        return { type: 'string' };
    }

    function buildObjSchema(fields: FieldDefinition[], includeRequired: boolean) {
        const props: Record<string, unknown> = {};
        const req: string[] = [];
        for (const f of fields) {
            const p = prismaToOpenApi(f.type);
            props[f.name] = f.isList ? { type: 'array', items: p } : f.isOptional ? { ...p, nullable: true } : p;
            if (includeRequired && !f.isOptional && !f.hasDefault) req.push(f.name);
        }
        const r: Record<string, unknown> = { type: 'object', properties: props };
        if (includeRequired && req.length > 0) r.required = req;
        return r;
    }

    for (const model of schema.models) {
        const modelLower = helpers.toCamelCase(model.name);
        const modelPlural = helpers.pluralize(modelLower);
        const basePath = `/api/${modelPlural}`;
        const tag = model.name;
        const isProtected = model.directives.includes('protected') || model.directives.includes('auth');
        const authRoles = model.authRoles ?? [];

        const responseFields = model.fields.filter(f => !f.isRelation && !f.directives.includes('hidden') && !f.directives.includes('writeOnly'));
        const createFields = model.fields.filter(f => !f.isRelation && !f.isId && !f.directives.includes('readonly') && (!f.hasDefault || f.directives.includes('writeOnly')));
        const nestedRelations = model.fields.filter(f => f.directives.includes('nested') && !f.isList && f.relationModel);

        for (const nr of nestedRelations) {
            const targetModel = schema.models.find(m => m.name === nr.relationModel);
            if (targetModel) {
                const tcf = targetModel.fields.filter(f => !f.isRelation && !f.isId && !f.directives.includes('readonly') && (!f.hasDefault || f.directives.includes('writeOnly')));
                schemas[`${model.name}_${nr.name[0].toUpperCase() + nr.name.slice(1)}Input`] = {
                    type: 'object', properties: {
                        create: { ...buildObjSchema(tcf, true), description: 'Create a new related record' },
                        connect: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], description: 'Connect to an existing record by ID' },
                    }, description: `Nested input: provide either 'create' or 'connect'`,
                };
            }
        }

        schemas[`${model.name}Response`] = buildObjSchema(responseFields, false);

        const nestedFkFields = new Set(nestedRelations.filter(nr => nr.relationField).flatMap(nr => nr.relationField!.split(', ').map(f => f.trim())));
        const createFiltered = createFields.filter(f => !nestedFkFields.has(f.name));
        const createSchemaObj = buildObjSchema(createFiltered, true) as Record<string, Record<string, unknown>>;
        for (const nr of nestedRelations) {
            createSchemaObj.properties[nr.name] = { $ref: `#/components/schemas/${model.name}_${nr.name[0].toUpperCase() + nr.name.slice(1)}Input` };
        }
        schemas[`${model.name}Create`] = createSchemaObj;
        schemas[`${model.name}Update`] = buildObjSchema(createFields, true);
        schemas[`${model.name}Patch`] = buildObjSchema(createFields, false);

        const authResponses = {
            ...(isProtected ? { '401': { description: 'Unauthorized' } } : {}),
            ...(authRoles.length > 0 ? { '403': { description: `Forbidden — requires role: ${authRoles.join(', ')}` } } : {}),
        };
        const securityBlock = isProtected ? { security: [{ bearerAuth: [] }] } : {};

        paths[basePath] = {
            get: { tags: [tag], summary: `List all ${modelPlural}`, parameters: [
                { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
                { name: 'sort', in: 'query', schema: { type: 'string' } },
                { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
                { name: 'search', in: 'query', schema: { type: 'string' } },
                { name: 'include', in: 'query', schema: { type: 'string' } },
            ], responses: { '200': { description: `List of ${modelPlural}`, content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${model.name}Response` } }, meta: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } } } } } } },
            post: { tags: [tag], summary: `Create a new ${modelLower}`, requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${model.name}Create` } } } }, responses: { '201': { description: `${model.name} created`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${model.name}Response` } } } }, '422': { description: 'Validation error' }, ...authResponses }, ...securityBlock },
        };

        paths[`${basePath}/{id}`] = {
            get: { tags: [tag], summary: `Get ${modelLower} by ID`, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'include', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: `${model.name} details`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${model.name}Response` } } } }, '404': { description: 'Not found' } } },
            put: { tags: [tag], summary: `Update ${modelLower}`, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${model.name}Update` } } } }, responses: { '200': { description: `${model.name} updated`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${model.name}Response` } } } }, '404': { description: 'Not found' }, '422': { description: 'Validation error' }, ...authResponses }, ...securityBlock },
            patch: { tags: [tag], summary: `Partially update ${modelLower}`, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${model.name}Patch` } } } }, responses: { '200': { description: `${model.name} updated`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${model.name}Response` } } } }, '404': { description: 'Not found' }, '422': { description: 'Validation error' }, ...authResponses }, ...securityBlock },
            delete: { tags: [tag], summary: `Delete ${modelLower}`, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Deleted successfully' }, '404': { description: 'Not found' }, ...authResponses }, ...securityBlock },
        };
    }

    for (const enumDef of schema.enums) {
        schemas[enumDef.name] = { type: 'string', enum: enumDef.values };
    }

    const spec = {
        openapi: '3.0.3',
        info: { title: 'Generated API', description: 'REST API generated by Backend Creator (bcm)', version: '1.0.0' },
        servers: [{ url: 'http://localhost:3000', description: 'Development server' }],
        paths,
        components: { schemas, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    };

    return [{ path: 'openapi.json', content: JSON.stringify(spec, null, 2) }];
}

// ==================== Main entry ====================

export function generateProject(schema: ParsedSchema, schemaContent: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    files.push(...generateModuleFiles(schema));
    files.push(...generateConfigFiles(schema));
    files.push(...generateMiddlewareFiles(schema));
    files.push(...generateUtilsFiles(schema));
    files.push(...generateAppFiles(schema));
    files.push(...generateInfraFiles(schema));
    files.push(...generatePrismaFiles(schema, schemaContent));
    files.push(...generateSwaggerFiles(schema));
    return files;
}
