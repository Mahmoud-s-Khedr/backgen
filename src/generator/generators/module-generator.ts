import type {
    ParsedSchema,
    GeneratedFile,
    FieldDefinition,
    ModelDefinition,
} from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';
import { resolveItemSelector, getExpressItemPath } from '../model-selector.js';

type FilterFieldType = 'string' | 'enum' | 'number' | 'bigint' | 'boolean' | 'datetime' | 'other';

interface SelectorFieldMeta {
    name: string;
    tsType: string;
    filterType: FilterFieldType;
}

interface NestedRelationConnectMeta {
    hasConnect: boolean;
    selector?: {
        isComposite: boolean;
        prismaWhereKey?: string;
        fields: SelectorFieldMeta[];
    };
}

function toFilterFieldType(field: FieldDefinition): FilterFieldType {
    if (field.isEnum) return 'enum';
    if (field.type === 'Int' || field.type === 'Float' || field.type === 'Decimal') return 'number';
    if (field.type === 'BigInt') return 'bigint';
    if (field.type === 'Boolean') return 'boolean';
    if (field.type === 'DateTime') return 'datetime';
    if (field.type === 'String') return 'string';
    return 'other';
}

function toTsType(field: FieldDefinition): string {
    if (field.isEnum) return 'string';
    if (field.type === 'Int' || field.type === 'Float' || field.type === 'Decimal') return 'number';
    if (field.type === 'BigInt') return 'bigint';
    if (field.type === 'Boolean') return 'boolean';
    if (field.type === 'DateTime') return 'Date';
    return 'string';
}

function getSelectorFieldMeta(
    model: ModelDefinition,
    selectorFieldName: string
): SelectorFieldMeta {
    const field = model.fields.find((f) => f.name === selectorFieldName);
    if (!field) {
        return {
            name: selectorFieldName,
            tsType: 'string',
            filterType: 'string',
        };
    }
    return {
        name: field.name,
        tsType: toTsType(field),
        filterType: toFilterFieldType(field),
    };
}

/**
 * Generate module files for each model: controller, service, routes, dto, test.
 */
export function generateModuleFiles(schema: ParsedSchema, framework: 'express' | 'fastify' = 'express'): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    for (const model of schema.models) {
        const modelLower = model.name.charAt(0).toLowerCase() + model.name.slice(1);
        const modulePath = `src/modules/${modelLower}`;

        // Separate field categories for template use
        // Enum fields are scalar-like (not relations)
        const scalarFields = model.fields.filter((f) => !f.isRelation);
        const relationFields = model.fields.filter((f) => f.isRelation);
        const includeRelations = relationFields.filter(
            (f) => !f.directives.includes('hidden') && !f.directives.includes('writeOnly')
        );
        const responseFields = scalarFields.filter(
            (f) =>
                !f.directives.includes('hidden') &&
                !f.directives.includes('writeOnly') &&
                !f.directives.includes('password')
        );
        const fkFields = model.fields
            .map((f) => f.relationField)
            .filter((f): f is string => f !== undefined);

        // Filterable fields: scalar, non-hidden, non-writeOnly (safe for query filtering)
        const filterableFieldDefs = scalarFields
            .filter((f) => !f.directives.includes('hidden') && !f.directives.includes('writeOnly'));
        const filterableFields = filterableFieldDefs.map((f) => f.name);
        const filterFieldTypes = Object.fromEntries(
            filterableFieldDefs.map((f) => [f.name, toFilterFieldType(f)])
        ) as Record<string, FilterFieldType>;

        // Searchable fields: fields with @bcm.searchable directive
        const searchableFields = scalarFields
            .filter((f) => f.directives.includes('searchable'))
            .map((f) => f.name);

        const isProtected = model.directives.includes('protected') || model.directives.includes('auth');
        const isSoftDelete = model.directives.includes('softDelete');
        const authRoles = model.authRoles ?? [];
        const itemSelector = resolveItemSelector(model);
        const itemPath = itemSelector ? getExpressItemPath(itemSelector) : '';
        const itemSelectorFieldMeta = itemSelector
            ? itemSelector.fields.map((fieldName) => getSelectorFieldMeta(model, fieldName))
            : [];
        const defaultSortField = (
            itemSelector?.fields.find((fieldName) => filterableFields.includes(fieldName))
            || filterableFields[0]
        );

        // Nested relations: single (non-list) relation fields with @bcm.nested directive
        const nestedRelations = relationFields.filter(
            (f) => f.directives.includes('nested') && f.relationModel
        );
        const nestedFkFields = new Set(
            nestedRelations
                .filter((nr) => nr.relationField)
                .flatMap((nr) => nr.relationField!.split(',').map((f) => f.trim()).filter(Boolean))
        );
        const createFields = scalarFields.filter(
            (f) =>
                !f.isId &&
                !f.directives.includes('hidden') &&
                !f.directives.includes('readonly') &&
                (!f.isServerDefault || f.directives.includes('writeOnly')) &&
                !nestedFkFields.has(f.name)
        );
        const nestedRelationConnectMeta = Object.fromEntries(
            nestedRelations.map((relation) => {
                const targetModel = relation.relationModel
                    ? schema.models.find((m) => m.name === relation.relationModel)
                    : undefined;
                if (!targetModel) {
                    return [relation.name, { hasConnect: false } satisfies NestedRelationConnectMeta];
                }
                const targetSelector = resolveItemSelector(targetModel);
                if (!targetSelector) {
                    return [relation.name, { hasConnect: false } satisfies NestedRelationConnectMeta];
                }
                const selectorFieldMeta = targetSelector.fields.map(
                    (fieldName) => getSelectorFieldMeta(targetModel, fieldName)
                );
                return [
                    relation.name,
                    {
                        hasConnect: true,
                        selector: {
                            isComposite: targetSelector.isComposite,
                            prismaWhereKey: targetSelector.prismaWhereKey,
                            fields: selectorFieldMeta,
                        },
                    } satisfies NestedRelationConnectMeta,
                ];
            })
        ) as Record<string, NestedRelationConnectMeta>;

        const uploadFields = scalarFields.filter((f) => f.directives.includes('upload'));
        const cacheConfig = model.cacheConfig ?? null;

        const templateData = {
            model,
            modelLower,
            scalarFields,
            relationFields,
            includeRelations,
            createFields,
            responseFields,
            fkFields,
            filterableFields,
            filterFieldTypes,
            searchableFields,
            defaultSortField,
            nestedRelations,
            nestedRelationConnectMeta,
            allModels: schema.models,
            enums: schema.enums,
            isProtected,
            isSoftDelete,
            authRoles,
            itemSelector,
            itemSelectorFieldMeta,
            itemPath,
            cacheConfig,
            uploadFields,
            hasUploads: uploadFields.length > 0,
            framework,
        };

        const routesTemplate = framework === 'fastify'
            ? 'module/routes-fastify.ts.ejs'
            : 'module/routes.ts.ejs';
        const testTemplate = framework === 'fastify'
            ? 'module/test-fastify.ts.ejs'
            : 'module/test.ts.ejs';

        files.push({
            path: `${modulePath}/${modelLower}.repository.ts`,
            content: renderTemplate('module/repository.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.controller.ts`,
            content: renderTemplate('module/controller.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.service.ts`,
            content: renderTemplate('module/service.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.routes.ts`,
            content: renderTemplate(routesTemplate, templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.dto.ts`,
            content: renderTemplate('module/dto.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.test.ts`,
            content: renderTemplate(testTemplate, templateData),
        });
    }

    return files;
}
