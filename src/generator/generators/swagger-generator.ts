import type { ParsedSchema, GeneratedFile, FieldDefinition, ModelDefinition } from '../../parser/types.js';
import type {
    OpenApiDocument,
    OpenApiParameterObject,
    OpenApiPathItemObject,
    OpenApiSchema,
} from '../openapi-types.js';
import { helpers } from '../template-engine.js';
import { getOpenApiItemPath, resolveItemSelector } from '../model-selector.js';

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

function generateOpenApiSpec(schema: ParsedSchema): OpenApiDocument {
    const paths: Record<string, OpenApiPathItemObject> = {};
    const schemas: Record<string, OpenApiSchema> = {};

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
        const itemSelector = resolveItemSelector(model);

        // Build schema components
        const responseFields = model.fields.filter(
            (f) =>
                !f.isRelation &&
                !f.directives.includes('hidden') &&
                !f.directives.includes('writeOnly')
        );
        // Nested relations for this model
        const nestedRelations = model.fields.filter(
            (f) => f.directives.includes('nested') && f.relationModel
        );

        // Generate nested input schemas
        for (const nr of nestedRelations) {
            const targetModel = schema.models.find(m => m.name === nr.relationModel);
            if (targetModel) {
                const targetCreateFields = getCreateLikeFields(targetModel);
                const createSchema = buildObjectSchema(targetCreateFields, schema, true);
                const targetSelector = resolveItemSelector(targetModel);
                const connectSchema = targetSelector
                    ? buildNestedConnectSchema(targetModel, targetSelector, schema)
                    : undefined;
                const nestedCreateSchema: OpenApiSchema = nr.isList
                    ? { type: 'array', items: createSchema, minItems: 1 }
                    : { ...createSchema };
                const nestedProperties: Record<string, OpenApiSchema> = {
                    create: {
                        ...nestedCreateSchema,
                        description: `Create ${nr.isList ? 'one or more' : 'a'} related record${nr.isList ? 's' : ''}`,
                    },
                };
                const nestedInputSchema: OpenApiSchema = {
                    type: 'object',
                    properties: nestedProperties,
                    description: connectSchema
                        ? `Nested input: provide either 'create' or 'connect'`
                        : `Nested input: provide 'create' (target model has no unique selector for connect)`,
                };
                if (connectSchema) {
                    nestedProperties.connect = {
                        ...(nr.isList
                            ? { type: 'array', items: connectSchema, minItems: 1 }
                            : connectSchema),
                        description: 'Connect to an existing record by unique selector',
                    };
                    nestedInputSchema.anyOf = [{ required: ['create'] }, { required: ['connect'] }];
                } else {
                    nestedInputSchema.required = ['create'];
                }
                schemas[`${model.name}_${nr.name[0].toUpperCase() + nr.name.slice(1)}Input`] = nestedInputSchema;
            }
        }

        // Response schema
        schemas[`${model.name}Response`] = buildObjectSchema(responseFields, schema, false);
        schemas[`${model.name}DataResponse`] = {
            type: 'object',
            properties: {
                data: { $ref: `#/components/schemas/${model.name}Response` },
            },
        };

        const createLikeSchemaRequired = buildCreateLikeSchema(model, schema, true);
        const createLikeSchemaOptional = buildCreateLikeSchema(model, schema, false);
        schemas[`${model.name}Create`] = createLikeSchemaRequired;
        schemas[`${model.name}Update`] = createLikeSchemaRequired;
        schemas[`${model.name}Patch`] = createLikeSchemaOptional;

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
                                schema: { $ref: `#/components/schemas/${model.name}DataResponse` },
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

        if (itemSelector) {
            const itemPath = `${basePath}${getOpenApiItemPath(itemSelector)}`;
            const itemPathParameters: OpenApiParameterObject[] = itemSelector.fields.map((field) => ({
                name: field,
                in: 'path',
                required: true,
                schema: (() => {
                    const selectorField = model.fields.find((f) => f.name === field);
                    return selectorField ? prismaTypeToOpenApi(selectorField.type, schema) : { type: 'string' };
                })(),
            }));

            // Single item endpoints
            paths[itemPath] = {
            get: {
                tags: [tag],
                summary: `Get ${modelLower} by key`,
                parameters: [
                    ...itemPathParameters,
                    { name: 'include', in: 'query', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: `${model.name} details`,
                        content: {
                            'application/json': {
                                schema: { $ref: `#/components/schemas/${model.name}DataResponse` },
                            },
                        },
                    },
                    '404': { description: 'Not found' },
                },
            },
            put: {
                tags: [tag],
                summary: `Update ${modelLower}`,
                parameters: itemPathParameters,
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
                                schema: { $ref: `#/components/schemas/${model.name}DataResponse` },
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
                parameters: itemPathParameters,
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
                                schema: { $ref: `#/components/schemas/${model.name}DataResponse` },
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
                parameters: itemPathParameters,
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
): OpenApiSchema {
    const properties: Record<string, OpenApiSchema> = {};
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

    const result: OpenApiSchema = { type: 'object', properties };
    if (includeRequired && required.length > 0) {
        result.required = required;
    }
    return result;
}

function getCreateLikeFields(model: ModelDefinition): FieldDefinition[] {
    return model.fields.filter(
        (f) =>
            !f.isRelation &&
            !f.isId &&
            !f.directives.includes('hidden') &&
            !f.directives.includes('readonly') &&
            (!f.isServerDefault || f.directives.includes('writeOnly'))
    );
}

function buildCreateLikeSchema(
    model: ModelDefinition,
    schema: ParsedSchema,
    includeRequired: boolean
): OpenApiSchema {
    const baseFields = getCreateLikeFields(model);
    const nestedRelations = model.fields.filter(
        (f) => f.directives.includes('nested') && f.relationModel
    );
    const nestedFkFields = new Set(
        nestedRelations
            .filter((nr) => nr.relationField)
            .flatMap((nr) => nr.relationField!.split(', ').map((f) => f.trim()))
    );
    const createFieldsFiltered = baseFields.filter((f) => !nestedFkFields.has(f.name));
    const createSchemaObj = buildObjectSchema(createFieldsFiltered, schema, includeRequired);
    const createSchemaProperties = createSchemaObj.properties ?? {};
    createSchemaObj.properties = createSchemaProperties;
    const nestedRequiredProps: string[] = [];

    for (const nr of nestedRelations) {
        const inputRef = `${model.name}_${nr.name[0].toUpperCase() + nr.name.slice(1)}Input`;
        createSchemaProperties[nr.name] = { $ref: `#/components/schemas/${inputRef}` };
        if (!includeRequired) {
            continue;
        }
        const fkNames = nr.relationField ? nr.relationField.split(', ').map((f) => f.trim()) : [];
        const isRequiredNested = fkNames.length > 0 && fkNames.every((fkName) => {
            const fk = model.fields.find((field) => field.name === fkName);
            return !!fk && !fk.isOptional && !fk.hasDefault && !fk.isServerDefault;
        });
        if (isRequiredNested) {
            nestedRequiredProps.push(nr.name);
        }
    }

    if (includeRequired && nestedRequiredProps.length > 0) {
        createSchemaObj.required = [...(createSchemaObj.required ?? []), ...nestedRequiredProps];
    }
    return createSchemaObj;
}

function buildNestedConnectSchema(
    targetModel: ModelDefinition,
    selector: ReturnType<typeof resolveItemSelector>,
    schema: ParsedSchema
): OpenApiSchema | undefined {
    if (!selector) return undefined;

    const selectorFields = selector.fields
        .map((fieldName) => targetModel.fields.find((f) => f.name === fieldName))
        .filter((f): f is FieldDefinition => !!f);
    if (selectorFields.length === 0) return undefined;

    if (selector.isComposite) {
        const whereKey = selector.prismaWhereKey || selector.fields.join('_');
        const innerProperties: Record<string, OpenApiSchema> = {};
        for (const field of selectorFields) {
            innerProperties[field.name] = prismaTypeToOpenApi(field.type, schema);
        }
        return {
            type: 'object',
            properties: {
                [whereKey]: {
                    type: 'object',
                    properties: innerProperties,
                    required: selectorFields.map((f) => f.name),
                },
            },
            required: [whereKey],
        };
    }

    const field = selectorFields[0];
    return {
        type: 'object',
        properties: {
            [field.name]: prismaTypeToOpenApi(field.type, schema),
        },
        required: [field.name],
    };
}

function prismaTypeToOpenApi(type: string, schema: ParsedSchema): OpenApiSchema {
    const map: Record<string, OpenApiSchema> = {
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
