// ============================================================
// Core types for the Backend Creator schema parsing pipeline
// ============================================================

/** Prisma field directives extracted from /// @bcm.* comments */
export type FieldDirective = 'hidden' | 'readonly' | 'writeOnly' | 'searchable' | 'nested' | 'identifier' | 'password';

/** Directives that apply at the model level */
export type ModelDirective = 'protected' | 'softDelete' | 'auth' | 'authModel';

/** Complete parsed schema representation */
export interface ParsedSchema {
    models: ModelDefinition[];
    enums: EnumDefinition[];
    datasource: DatasourceConfig;
    warnings: string[];
}

/** A single Prisma model with all its metadata */
export interface ModelDefinition {
    name: string;
    fields: FieldDefinition[];
    /** Model-level unique/primary selectors used for item CRUD generation */
    selectors?: ModelSelectorDefinition[];
    directives: ModelDirective[];
    authRoles?: string[];
    /** True if this model is marked @bcm.authModel (used for login) */
    isAuthModel?: boolean;
    /** Field name marked @bcm.identifier (login credential, e.g. email) */
    identifierField?: string;
    /** Field name marked @bcm.password (login password; implies writeOnly) */
    passwordField?: string;
    /** Scalar field name used for JWT role claim (required for @bcm.auth RBAC models) */
    roleField?: string;
}

/** A model selector that can uniquely identify a single record */
export interface ModelSelectorDefinition {
    /** Primary key selector has higher precedence than non-primary unique selectors */
    kind: 'id' | 'unique';
    /** Selector field order (important for composite selectors and route param order) */
    fields: string[];
    /**
     * Prisma client selector key for composite selectors.
     * Uses explicit `name:` when provided; otherwise falls back to joined fields.
     * Example: @@id([userId, listingId], name: "favoriteKey") => favoriteKey
     */
    prismaKey?: string;
    /**
     * Optional explicit DB constraint name from Prisma schema `map:` argument.
     * Kept for reference/debugging.
     */
    constraintName?: string;
}

/** A single field within a model */
export interface FieldDefinition {
    name: string;
    /** Prisma type: String, Int, Float, Boolean, DateTime, Json, Bytes, BigInt, or a model/enum name */
    type: string;
    /** Whether this field is a list (e.g., Post[]) */
    isList: boolean;
    /** Whether this field is optional (e.g., String?) */
    isOptional: boolean;
    /** Whether this is the @id field */
    isId: boolean;
    /** Whether this field has @unique */
    isUnique: boolean;
    /** Whether this field is a relation (references another model) */
    isRelation: boolean;
    /** Whether this field references an enum type */
    isEnum: boolean;
    /** If a relation, the target model name */
    relationModel?: string;
    /** If a relation, the local FK field name */
    relationField?: string;
    /** Whether this field has a @default() value */
    hasDefault: boolean;
    /** True if the default is server-generated (uuid(), now(), autoincrement(), @updatedAt). False for user-overridable literals (false, 0, "USER"). */
    isServerDefault: boolean;
    /** The default value expression if present */
    defaultValue?: string;
    /** @bcm.* directives applied to this field */
    directives: FieldDirective[];
}

/** A Prisma enum definition */
export interface EnumDefinition {
    name: string;
    values: string[];
}

/** Datasource configuration from the schema */
export interface DatasourceConfig {
    provider: string; // postgresql, mysql, sqlite, etc.
    url: string;      // Usually env("DATABASE_URL")
}

/** Options passed to the generate command */
export interface GenerateOptions {
    schema: string;
    output: string;
    dryRun: boolean;
    only?: string;
    force: boolean;
    json?: boolean;
}

/** A single file to be written by the generator */
export interface GeneratedFile {
    /** Relative path from the output directory */
    path: string;
    /** File content */
    content: string;
}
