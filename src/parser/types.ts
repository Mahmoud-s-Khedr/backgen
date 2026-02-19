// ============================================================
// Core types for the Backend Creator schema parsing pipeline
// ============================================================

/** Prisma field directives extracted from /// @bcm.* comments */
export type FieldDirective = 'hidden' | 'readonly' | 'writeOnly';

/** Directives that apply at the model level (v1.1+) */
export type ModelDirective = 'protected' | 'softDelete';

/** Complete parsed schema representation */
export interface ParsedSchema {
    models: ModelDefinition[];
    enums: EnumDefinition[];
    datasource: DatasourceConfig;
}

/** A single Prisma model with all its metadata */
export interface ModelDefinition {
    name: string;
    fields: FieldDefinition[];
    directives: ModelDirective[];
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
    /** If a relation, the target model name */
    relationModel?: string;
    /** If a relation, the local FK field name */
    relationField?: string;
    /** Whether this field has a @default() value */
    hasDefault: boolean;
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
}

/** A single file to be written by the generator */
export interface GeneratedFile {
    /** Relative path from the output directory */
    path: string;
    /** File content */
    content: string;
}
