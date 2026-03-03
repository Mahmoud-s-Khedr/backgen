export interface OpenApiSchema {
    $ref?: string;
    type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
    format?: string;
    enum?: string[];
    nullable?: boolean;
    description?: string;
    example?: unknown;
    default?: string | number | boolean;
    minItems?: number;
    items?: OpenApiSchema;
    properties?: Record<string, OpenApiSchema>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
}

export interface OpenApiMediaTypeObject {
    schema: OpenApiSchema;
}

export interface OpenApiResponseObject {
    description: string;
    content?: Record<string, OpenApiMediaTypeObject>;
}

export interface OpenApiParameterObject {
    name: string;
    in: 'query' | 'path';
    required?: boolean;
    schema: OpenApiSchema;
    description?: string;
}

export interface OpenApiRequestBodyObject {
    required?: boolean;
    content: Record<string, OpenApiMediaTypeObject>;
}

export interface OpenApiOperationObject {
    tags?: string[];
    summary?: string;
    parameters?: OpenApiParameterObject[];
    requestBody?: OpenApiRequestBodyObject;
    responses: Record<string, OpenApiResponseObject>;
    security?: Array<Record<string, string[]>>;
}

export interface OpenApiPathItemObject {
    get?: OpenApiOperationObject;
    post?: OpenApiOperationObject;
    put?: OpenApiOperationObject;
    patch?: OpenApiOperationObject;
    delete?: OpenApiOperationObject;
}

export interface OpenApiComponentsObject {
    schemas: Record<string, OpenApiSchema>;
    securitySchemes?: Record<string, {
        type: 'http';
        scheme: string;
        bearerFormat?: string;
    }>;
}

export interface OpenApiDocument {
    openapi: string;
    info: {
        title: string;
        description: string;
        version: string;
    };
    servers: Array<{
        url: string;
        description?: string;
    }>;
    paths: Record<string, OpenApiPathItemObject>;
    components: OpenApiComponentsObject;
}
