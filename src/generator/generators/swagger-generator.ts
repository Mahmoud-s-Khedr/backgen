import type { ParsedSchema, GeneratedFile, FieldDefinition } from '../../parser/types.js';
import { helpers } from '../template-engine.js';

/**
 * Generate OpenAPI 3.0 specification from the parsed schema.
 * Produces a complete openapi.json file.
 */
export function generateSwaggerFiles(schema: ParsedSchema): GeneratedFile[] {
    const spec = generateOpenApiSpec(schema);

    return [
        {
            path: 'openapi.json',
            content: JSON.stringify(spec, null, 2),
        },
    ];
}

function generateOpenApiSpec(schema: ParsedSchema): any {
    const paths: Record<string, any> = {};
    const schemas: Record<string, any> = {};

    // Auth login endpoint (when @bcm.authModel is present)
    const authModel = schema.models.find(m => m.isAuthModel);
    if (authModel && authModel.identifierField && authModel.passwordField) {
        paths['/api/auth/login'] = {
            post: {
                tags: ['Auth'],
                summary: 'Login and get JWT token',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: [authModel.identifierField, authModel.passwordField],
                                properties: {
                                    [authModel.identifierField]: { type: 'string' },
                                    [authModel.passwordField]: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Login successful',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        data: {
                                            type: 'object',
                                            properties: {
                                                token: { type: 'string', description: 'JWT bearer token' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    '401': { description: 'Invalid credentials' },
                    '422': { description: 'Validation error' },
                },
            },
        };
    }

    // Health check endpoint
    paths['/health'] = {
        get: {
            tags: ['Health'],
            summary: 'Health check',
            responses: {
                '200': {
                    description: 'Service is healthy',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    status: { type: 'string', example: 'ok' },
                                    timestamp: { type: 'string', format: 'date-time' },
                                },
                            },
                        },
                    },
                },
            },
        },
    };

    // Generate paths and schemas for each model
    for (const model of schema.models) {
        const modelLower = helpers.toCamelCase(model.name);
        const modelPlural = helpers.pluralize(modelLower);
        const basePath = `/api/${modelPlural}`;
        const tag = model.name;
        const isProtected = model.directives.includes('protected') || model.directives.includes('auth');
        const authRoles = model.authRoles ?? [];

        // Build schema components
        const responseFields = model.fields.filter(
            (f) =>
                !f.isRelation &&
                !f.directives.includes('hidden') &&
                !f.directives.includes('writeOnly')
        );
        const createFields = model.fields.filter(
            (f) =>
                !f.isRelation &&
                !f.isId &&
                !f.directives.includes('readonly') &&
                (!f.isServerDefault || f.directives.includes('writeOnly'))
        );

        // Nested relations for this model
        const nestedRelations = model.fields.filter(
            (f) => f.directives.includes('nested') && !f.isList && f.relationModel
        );

        // Generate nested input schemas
        for (const nr of nestedRelations) {
            const targetModel = schema.models.find(m => m.name === nr.relationModel);
            if (targetModel) {
                const targetCreateFields = targetModel.fields.filter(
                    (f) => !f.isRelation && !f.isId && !f.directives.includes('readonly') && (!f.hasDefault || f.directives.includes('writeOnly'))
                );
                const createSchema = buildObjectSchema(targetCreateFields, schema, true);
                schemas[`${model.name}_${nr.name[0].toUpperCase() + nr.name.slice(1)}Input`] = {
                    type: 'object',
                    properties: {
                        create: { ...createSchema, description: 'Create a new related record' },
                        connect: {
                            type: 'object',
                            properties: { id: { type: 'string' } },
                            required: ['id'],
                            description: 'Connect to an existing record by ID',
                        },
                    },
                    description: `Nested input: provide either 'create' or 'connect'`,
                };
            }
        }

        // Response schema
        schemas[`${model.name}Response`] = buildObjectSchema(responseFields, schema, false);

        // Create schema (exclude FK fields that have nested counterparts)
        const nestedFkFields = new Set(
            nestedRelations
                .filter(nr => nr.relationField)
                .flatMap(nr => nr.relationField!.split(', ').map(f => f.trim()))
        );
        const createFieldsFiltered = createFields.filter(f => !nestedFkFields.has(f.name));
        const createSchemaObj = buildObjectSchema(createFieldsFiltered, schema, true);
        // Add nested relation properties
        for (const nr of nestedRelations) {
            const inputRef = `${model.name}_${nr.name[0].toUpperCase() + nr.name.slice(1)}Input`;
            createSchemaObj.properties[nr.name] = { $ref: `#/components/schemas/${inputRef}` };
        }
        schemas[`${model.name}Create`] = createSchemaObj;

        // Update schema (same as create)
        schemas[`${model.name}Update`] = buildObjectSchema(createFields, schema, true);

        // Patch schema (all optional)
        schemas[`${model.name}Patch`] = buildObjectSchema(createFields, schema, false);

        // List endpoint
        paths[basePath] = {
            get: {
                tags: [tag],
                summary: `List all ${modelPlural}`,
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
                    { name: 'sort', in: 'query', schema: { type: 'string' } },
                    { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
                    { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search term for @bcm.searchable fields' },
                    { name: 'include', in: 'query', schema: { type: 'string' }, description: 'Comma-separated relation names to include' },
                ],
                responses: {
                    '200': {
                        description: `List of ${modelPlural}`,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        data: {
                                            type: 'array',
                                            items: { $ref: `#/components/schemas/${model.name}Response` },
                                        },
                                        meta: {
                                            type: 'object',
                                            properties: {
                                                page: { type: 'integer' },
                                                limit: { type: 'integer' },
                                                total: { type: 'integer' },
                                                totalPages: { type: 'integer' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            post: {
                tags: [tag],
                summary: `Create a new ${modelLower}`,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: `#/components/schemas/${model.name}Create` },
                        },
                    },
                },
                responses: {
                    '201': {
                        description: `${model.name} created`,
                        content: {
                            'application/json': {
                                schema: { $ref: `#/components/schemas/${model.name}Response` },
                            },
                        },
                    },
                    '422': { description: 'Validation error' },
                    ...(isProtected ? { '401': { description: 'Unauthorized' } } : {}),
                    ...(authRoles.length > 0 ? { '403': { description: `Forbidden — requires role: ${authRoles.join(', ')}` } } : {}),
                },
                ...(isProtected ? { security: [{ bearerAuth: [] }] } : {}),
            },
        };

        // Single item endpoints
        paths[`${basePath}/{id}`] = {
            get: {
                tags: [tag],
                summary: `Get ${modelLower} by ID`,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'include', in: 'query', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: `${model.name} details`,
                        content: {
                            'application/json': {
                                schema: { $ref: `#/components/schemas/${model.name}Response` },
                            },
                        },
                    },
                    '404': { description: 'Not found' },
                },
            },
            put: {
                tags: [tag],
                summary: `Update ${modelLower}`,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: `#/components/schemas/${model.name}Update` },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: `${model.name} updated`,
                        content: {
                            'application/json': {
                                schema: { $ref: `#/components/schemas/${model.name}Response` },
                            },
                        },
                    },
                    '404': { description: 'Not found' },
                    '422': { description: 'Validation error' },
                    ...(isProtected ? { '401': { description: 'Unauthorized' } } : {}),
                    ...(authRoles.length > 0 ? { '403': { description: `Forbidden — requires role: ${authRoles.join(', ')}` } } : {}),
                },
                ...(isProtected ? { security: [{ bearerAuth: [] }] } : {}),
            },
            patch: {
                tags: [tag],
                summary: `Partially update ${modelLower}`,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: `#/components/schemas/${model.name}Patch` },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: `${model.name} updated`,
                        content: {
                            'application/json': {
                                schema: { $ref: `#/components/schemas/${model.name}Response` },
                            },
                        },
                    },
                    '404': { description: 'Not found' },
                    '422': { description: 'Validation error' },
                    ...(isProtected ? { '401': { description: 'Unauthorized' } } : {}),
                    ...(authRoles.length > 0 ? { '403': { description: `Forbidden — requires role: ${authRoles.join(', ')}` } } : {}),
                },
                ...(isProtected ? { security: [{ bearerAuth: [] }] } : {}),
            },
            delete: {
                tags: [tag],
                summary: `Delete ${modelLower}`,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                ],
                responses: {
                    '204': { description: 'Deleted successfully' },
                    '404': { description: 'Not found' },
                    ...(isProtected ? { '401': { description: 'Unauthorized' } } : {}),
                    ...(authRoles.length > 0 ? { '403': { description: `Forbidden — requires role: ${authRoles.join(', ')}` } } : {}),
                },
                ...(isProtected ? { security: [{ bearerAuth: [] }] } : {}),
            },
        };
    }

    // Enum schemas
    for (const enumDef of schema.enums) {
        schemas[enumDef.name] = {
            type: 'string',
            enum: enumDef.values,
        };
    }

    const hasAuth = schema.models.some(
        (m) => m.directives.includes('protected') || m.directives.includes('auth')
    );

    return {
        openapi: '3.0.3',
        info: {
            title: 'Generated API',
            description: 'REST API generated by Backend Creator (bcm)',
            version: '1.0.0',
        },
        servers: [
            { url: 'http://localhost:3000', description: 'Development server' },
        ],
        paths,
        components: {
            schemas,
            ...(hasAuth ? {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                    },
                },
            } : {}),
        },
    };
}

function buildObjectSchema(
    fields: FieldDefinition[],
    schema: ParsedSchema,
    includeRequired: boolean
): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const field of fields) {
        const prop = prismaTypeToOpenApi(field.type, schema);
        if (field.isList) {
            properties[field.name] = { type: 'array', items: prop };
        } else if (field.isOptional) {
            properties[field.name] = { ...prop, nullable: true };
        } else {
            properties[field.name] = prop;
        }

        if (includeRequired && !field.isOptional && !field.hasDefault) {
            required.push(field.name);
        }
    }

    const result: any = { type: 'object', properties };
    if (includeRequired && required.length > 0) {
        result.required = required;
    }
    return result;
}

function prismaTypeToOpenApi(type: string, schema: ParsedSchema): any {
    const map: Record<string, any> = {
        String: { type: 'string' },
        Int: { type: 'integer' },
        Float: { type: 'number', format: 'float' },
        Decimal: { type: 'number', format: 'double' },
        Boolean: { type: 'boolean' },
        DateTime: { type: 'string', format: 'date-time' },
        Json: { type: 'object' },
        Bytes: { type: 'string', format: 'byte' },
        BigInt: { type: 'integer', format: 'int64' },
    };

    if (map[type]) return map[type];

    // Check if it's an enum
    const enumDef = schema.enums.find((e) => e.name === type);
    if (enumDef) {
        return { $ref: `#/components/schemas/${type}` };
    }

    // Default to string
    return { type: 'string' };
}
