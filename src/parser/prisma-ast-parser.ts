import { getSchema } from '@mrleebo/prisma-ast';
import type {
    ParsedSchema,
    ModelDefinition,
    ModelSelectorDefinition,
    FieldDefinition,
    EnumDefinition,
    DatasourceConfig,
} from './types.js';
import { parseDirectives, getFieldDirectives } from './directive-parser.js';
import type { ModelDirectivesResult } from './directive-parser.js';
import { PRISMA_SCALAR_TYPES } from '../generator/template-engine.js';

/** Attribute node from @mrleebo/prisma-ast (e.g., @id, @unique, @default, @relation) */
interface AstAttribute {
    type?: string;
    name: string;
    kind?: string;
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
    | { type: 'keyValue'; key?: string; value?: AstValue }
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

    // First pass: collect enum names for distinguishing enums from relations
    const enumNames = new Set<string>();
    for (const block of ast.list as AstBlock[]) {
        if (block.type === 'enum') {
            enumNames.add(block.name);
        }
    }

    for (const block of ast.list as AstBlock[]) {
        if (block.type === 'model') {
            models.push(parseModelBlock(block, directivesMap, enumNames));
        } else if (block.type === 'enum') {
            enums.push(parseEnumBlock(block));
        } else if (block.type === 'datasource') {
            datasource = parseDatasourceBlock(block);
        }
    }

    const warnings = [
        ...Array.from(directivesMap.values()).flatMap((v) => v.warnings),
        ...findHiddenRequiredFieldWarnings(models),
    ];

    return { models, enums, datasource, warnings };
}

function findHiddenRequiredFieldWarnings(models: ModelDefinition[]): string[] {
    const warnings: string[] = [];

    for (const model of models) {
        for (const field of model.fields) {
            // @bcm.hidden removes the field from all generated API input schemas.
            // If the field is required by Prisma and has no default, create flows are unsatisfiable.
            if (
                field.directives.includes('hidden') &&
                !field.isRelation &&
                !field.isList &&
                !field.isId &&
                !field.isOptional &&
                !field.hasDefault
            ) {
                warnings.push(
                    `Model "${model.name}" field "${field.name}" is required but marked @bcm.hidden; API create/update inputs cannot provide it. Consider @bcm.writeOnly, making it optional (?), or adding a default.`
                );
            }
        }
    }

    return warnings;
}

function parseModelBlock(
    block: AstBlock,
    directivesMap: Map<string, ModelDirectivesResult>,
    enumNames: Set<string>
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
        // Server-generated: @updatedAt or a function-call default like uuid(), now(), autoincrement()
        const isServerDefault = attributes.some((a) => a.name === 'updatedAt') ||
            isFunctionDefault(defaultAttr);

        // Detect relations
        const relationAttr = attributes.find((a) => a.name === 'relation');
        const isRelation = !!relationAttr;
        let relationModel: string | undefined;
        let relationField: string | undefined;

        if (isRelation && relationAttr) {
            const relArgs: AstArg[] = relationAttr.args || [];
            for (const arg of relArgs) {
                // prisma-ast wraps named args as { value: { type: 'keyValue', key: ..., value: ... } }
                const argAny = arg as Record<string, unknown>;
                const keyValue = argAny.value as { type?: string; key?: string; value?: AstValue } | undefined;
                const argKey = arg.name || (keyValue?.type === 'keyValue' ? keyValue.key : undefined);

                if (argKey === 'fields') {
                    // Extract FK field name(s)
                    if (keyValue?.type === 'keyValue' && keyValue.value) {
                        relationField = extractArrayArgFromValue(keyValue.value);
                    } else {
                        relationField = extractArrayArg(arg);
                    }
                }
                if (argKey === 'references') {
                    // The referenced model is the field type
                    relationModel = fieldType;
                }
            }
            if (!relationModel) {
                relationModel = fieldType;
            }
        }

        // Check if this field references an enum type
        const isEnum = enumNames.has(fieldType);

        // Also detect implicit relations (field type matches a model name, is a list, no @relation)
        // Enum types are NOT relations — they are scalar-like values
        const isImplicitRelation = !isRelation && !isEnum && (isList || isNonScalarType(fieldType));

        // Get directives; @bcm.password implies writeOnly (excluded from responses)
        const rawDirectives = getFieldDirectives(directivesMap, modelName, fieldName);
        const directives = rawDirectives.includes('password') && !rawDirectives.includes('writeOnly')
            ? [...rawDirectives, 'writeOnly' as const]
            : rawDirectives;

        fields.push({
            name: fieldName,
            type: fieldType,
            isList,
            isOptional,
            isId,
            isUnique,
            isRelation: isRelation || isImplicitRelation,
            isEnum,
            relationModel: isRelation || isImplicitRelation ? fieldType : undefined,
            relationField,
            hasDefault,
            isServerDefault,
            defaultValue,
            directives,
        });
    }

    const modelAttributes = properties
        .filter((p) => p.type === 'attribute')
        .map((p) => p as unknown as AstAttribute);
    const selectors = parseModelSelectors(fields, modelAttributes);

    const modelResult = directivesMap.get(modelName);
    const modelDirectives = modelResult?.modelDirectives ?? [];
    const isAuthModel = modelDirectives.includes('authModel');
    const identifierField = isAuthModel
        ? fields.find(f => f.directives.includes('identifier'))?.name
        : undefined;
    const passwordField = isAuthModel
        ? fields.find(f => f.directives.includes('password'))?.name
        : undefined;
    const roleField = isAuthModel
        ? fields.find(f => !f.isRelation && f.name === 'role')?.name
        : undefined;

    return {
        name: modelName,
        fields,
        selectors,
        directives: modelDirectives,
        authRoles: modelResult?.authRoles,
        isAuthModel,
        identifierField,
        passwordField,
        roleField,
    };
}

function parseModelSelectors(fields: FieldDefinition[], modelAttributes: AstAttribute[]): ModelSelectorDefinition[] {
    const selectors: ModelSelectorDefinition[] = [];

    const scalarIdField = fields.find((f) => f.isId);
    if (scalarIdField) {
        selectors.push({
            kind: 'id',
            fields: [scalarIdField.name],
        });
    }

    for (const attr of modelAttributes) {
        if (!attr || attr.kind !== 'object') continue;
        if (attr.name !== 'id' && attr.name !== 'unique') continue;
        const fieldsArg = attr.args?.find((arg) => getArgKey(arg) === undefined);
        const selectorFields = fieldsArg
            ? (extractArrayArg(fieldsArg) || '').split(',').map((v) => v.trim()).filter(Boolean)
            : [];
        if (selectorFields.length === 0) continue;

        selectors.push({
            kind: attr.name === 'id' ? 'id' : 'unique',
            fields: selectorFields,
            prismaKey: extractNamedStringArg(attr, 'name') || selectorFields.join('_'),
            constraintName: extractNamedStringArg(attr, 'map'),
        });
    }

    const scalarUniqueFields = fields.filter((f) => f.isUnique && !f.isId);
    for (const field of scalarUniqueFields) {
        selectors.push({
            kind: 'unique',
            fields: [field.name],
        });
    }

    return selectors;
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

    // prisma-ast uses "assignments" for datasource blocks, not "properties"
    const blockAny = block as unknown as Record<string, unknown>;
    const assignments = (blockAny.assignments || block.properties || []) as AstProperty[];
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
    return !PRISMA_SCALAR_TYPES.has(type);
}

function extractDefaultValue(attr: AstAttribute): string | undefined {
    const args: AstArg[] = attr.args || [];
    if (args.length === 0) return undefined;
    const val = unwrapAstValue(args[0]?.value);
    if (typeof val === 'object' && val !== null && 'type' in val && val.type === 'function') {
        const fn = val as { type: 'function'; name: string };
        return `${fn.name}()`;
    }
    return String(val);
}

function isFunctionDefault(attr?: AstAttribute): boolean {
    if (!attr) {
        return false;
    }
    const value = unwrapAstValue(attr.args?.[0]?.value);
    return typeof value === 'object' && value !== null && 'type' in value && value.type === 'function';
}

function unwrapAstValue(value: AstValue | undefined): AstValue | undefined {
    if (
        typeof value === 'object'
        && value !== null
        && 'type' in value
        && value.type === 'keyValue'
        && 'value' in value
    ) {
        return value.value as AstValue | undefined;
    }
    return value;
}

function getArgKey(arg: AstArg): string | undefined {
    const argAny = arg as Record<string, unknown>;
    const keyValue = argAny.value as { type?: string; key?: string } | undefined;
    return arg.name || (keyValue?.type === 'keyValue' ? keyValue.key : undefined);
}

function extractNamedStringArg(attr: AstAttribute, key: string): string | undefined {
    const args = attr.args || [];
    for (const arg of args) {
        if (getArgKey(arg) !== key) continue;
        const argAny = arg as Record<string, unknown>;
        const keyValue = argAny.value as { type?: string; value?: AstValue } | undefined;
        const value = keyValue?.type === 'keyValue' ? keyValue.value : arg.value;
        if (typeof value === 'string') return value.replace(/"/g, '');
    }
    return undefined;
}

function extractArrayArg(arg: AstArg): string | undefined {
    return extractArrayArgFromValue(arg.value);
}

function extractArrayArgFromValue(val: AstValue | undefined): string | undefined {
    if (typeof val === 'object' && val !== null && 'type' in val && val.type === 'array') {
        const arr = val as { type: 'array'; args?: Array<string | number | { value?: string | number }> };
        return arr.args?.map((a) => (typeof a === 'object' && a !== null && 'value' in a) ? a.value ?? a : a).join(', ');
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
