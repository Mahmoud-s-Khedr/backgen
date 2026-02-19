import { getSchema } from '@mrleebo/prisma-ast';
import type {
    ParsedSchema,
    ModelDefinition,
    FieldDefinition,
    EnumDefinition,
    DatasourceConfig,
} from './types.js';
import { parseDirectives, getFieldDirectives } from './directive-parser.js';
import type { ModelDirectivesResult } from './directive-parser.js';

/** Attribute node from @mrleebo/prisma-ast (e.g., @id, @unique, @default, @relation) */
interface AstAttribute {
    name: string;
    args?: AstArg[];
}

/** Argument node inside an attribute */
interface AstArg {
    name?: string;
    value?: AstValue;
}

/** Possible value shapes inside an attribute argument */
type AstValue =
    | string
    | number
    | boolean
    | { type: 'function'; name: string; params?: string[] }
    | { type: 'array'; args?: Array<{ value?: string | number }> }
    | { type: string; [key: string]: unknown };

/** Field property node from @mrleebo/prisma-ast */
interface AstField {
    type: 'field';
    name: string;
    fieldType: string | { name: string };
    optional?: boolean;
    array?: boolean;
    attributes?: AstAttribute[];
}

/** Generic block property (field, assignment, etc.) */
interface AstProperty {
    type: string;
    name?: string;
    key?: string;
    value?: AstValue;
    enumerators?: Array<{ type: string; name: string }>;
    [key: string]: unknown;
}

/** Top-level block in the AST (model, enum, datasource, generator) */
interface AstBlock {
    type: string;
    name: string;
    properties?: AstProperty[];
    enumerators?: Array<{ type: string; name: string }>;
}

/**
 * Parse a Prisma schema using @mrleebo/prisma-ast.
 *
 * This is the primary parser. It reads the raw .prisma file content,
 * parses it into an AST, and normalizes it into our ParsedSchema format.
 */
export function parsePrismaAst(schemaContent: string): ParsedSchema {
    const ast = getSchema(schemaContent);
    const directivesMap = parseDirectives(schemaContent);

    const models: ModelDefinition[] = [];
    const enums: EnumDefinition[] = [];
    let datasource: DatasourceConfig = { provider: 'postgresql', url: 'env("DATABASE_URL")' };

    for (const block of ast.list as AstBlock[]) {
        if (block.type === 'model') {
            models.push(parseModelBlock(block, directivesMap));
        } else if (block.type === 'enum') {
            enums.push(parseEnumBlock(block));
        } else if (block.type === 'datasource') {
            datasource = parseDatasourceBlock(block);
        }
    }

    return { models, enums, datasource };
}

function parseModelBlock(
    block: AstBlock,
    directivesMap: Map<string, ModelDirectivesResult>
): ModelDefinition {
    const modelName: string = block.name;
    const fields: FieldDefinition[] = [];

    // Get all model names for relation detection
    const properties = (block.properties || []) as AstProperty[];

    for (const prop of properties) {
        if (prop.type !== 'field') continue;
        const field = prop as unknown as AstField;

        const fieldName: string = field.name;
        const fieldType: string = typeof field.fieldType === 'string'
            ? field.fieldType
            : field.fieldType?.name || 'String';

        const isOptional = field.optional === true;
        const isList = field.array === true;

        // Check attributes
        const attributes: AstAttribute[] = field.attributes || [];
        const isId = attributes.some((a) => a.name === 'id');
        const isUnique = attributes.some((a) => a.name === 'unique');
        const defaultAttr = attributes.find((a) => a.name === 'default');
        const hasDefault = !!defaultAttr || attributes.some((a) => a.name === 'updatedAt');
        const defaultValue = defaultAttr
            ? extractDefaultValue(defaultAttr)
            : undefined;

        // Detect relations
        const relationAttr = attributes.find((a) => a.name === 'relation');
        const isRelation = !!relationAttr;
        let relationModel: string | undefined;
        let relationField: string | undefined;

        if (isRelation && relationAttr) {
            const relArgs: AstArg[] = relationAttr.args || [];
            for (const arg of relArgs) {
                if (arg.name === 'fields') {
                    // Extract FK field name(s)
                    relationField = extractArrayArg(arg);
                }
                if (arg.name === 'references') {
                    // The referenced model is the field type
                    relationModel = fieldType;
                }
            }
            if (!relationModel) {
                relationModel = fieldType;
            }
        }

        // Also detect implicit relations (field type matches a model name, is a list, no @relation)
        // These will be picked up as relation fields without a FK
        const isImplicitRelation = !isRelation && (isList || isNonScalarType(fieldType));

        // Get directives
        const directives = getFieldDirectives(directivesMap, modelName, fieldName);

        fields.push({
            name: fieldName,
            type: fieldType,
            isList,
            isOptional,
            isId,
            isUnique,
            isRelation: isRelation || isImplicitRelation,
            relationModel: isRelation || isImplicitRelation ? fieldType : undefined,
            relationField,
            hasDefault,
            defaultValue,
            directives,
        });
    }

    const modelResult = directivesMap.get(modelName);
    return {
        name: modelName,
        fields,
        directives: modelResult?.modelDirectives ?? [],
    };
}

function parseEnumBlock(block: AstBlock): EnumDefinition {
    const values: string[] = [];
    const enumerators = block.enumerators || block.properties || [];
    for (const e of enumerators) {
        if (e.type === 'enumerator') {
            values.push(e.name as string);
        }
    }
    return { name: block.name, values };
}

function parseDatasourceBlock(block: AstBlock): DatasourceConfig {
    let provider = 'postgresql';
    let url = 'env("DATABASE_URL")';

    const assignments = (block.properties || []) as AstProperty[];
    for (const a of assignments) {
        if (a.type === 'assignment') {
            if (a.key === 'provider') {
                provider = typeof a.value === 'string' ? a.value.replace(/"/g, '') : String(a.value);
            }
            if (a.key === 'url') {
                url = typeof a.value === 'string' ? a.value : extractFuncCall(a.value);
            }
        }
    }

    return { provider, url };
}

/**
 * Check if a type is non-scalar (i.e., references another model or enum).
 */
function isNonScalarType(type: string): boolean {
    const scalarTypes = new Set([
        'String', 'Int', 'Float', 'Boolean', 'DateTime',
        'Json', 'Bytes', 'BigInt', 'Decimal',
    ]);
    return !scalarTypes.has(type);
}

function extractDefaultValue(attr: AstAttribute): string | undefined {
    const args: AstArg[] = attr.args || [];
    if (args.length === 0) return undefined;
    const val = args[0]?.value;
    if (typeof val === 'object' && val !== null && 'type' in val && val.type === 'function') {
        const fn = val as { type: 'function'; name: string };
        return `${fn.name}()`;
    }
    return String(val);
}

function extractArrayArg(arg: AstArg): string | undefined {
    const val = arg.value;
    if (typeof val === 'object' && val !== null && 'type' in val && val.type === 'array') {
        const arr = val as { type: 'array'; args?: Array<{ value?: string | number }> };
        return arr.args?.map((a) => a.value ?? a).join(', ');
    }
    if (typeof val === 'string') return val;
    return undefined;
}

function extractFuncCall(value: AstValue | undefined): string {
    if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'function') {
        const fn = value as { type: 'function'; name: string; params?: string[] };
        const args = fn.params?.map((p) => `"${p}"`)?.join(', ') || '';
        return `${fn.name}(${args})`;
    }
    return String(value);
}
