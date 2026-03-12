import type {
    ParsedSchema,
    ModelDefinition,
    EnumDefinition,
    GeneratedFile,
    FieldDefinition,
    ModelSelectorDefinition,
} from '../../parser/types.js';
import { helpers, renderTemplate } from '../template-engine.js';

const BCM_DIRECTIVE_REGEX = /^\s*\/\/\/\s*@bcm\.\w+.*\n?/gm;

interface SeedRelationConfig {
    relationName: string;
    targetModel: string;
    localFields: string[];
    referenceFields: string[];
    cacheKey: string;
    required: boolean;
    omit: boolean;
}

interface SeedUniqueSelectorConfig {
    fields: string[];
}

interface SeedScalarFieldConfig {
    name: string;
    type: string;
    isOptional: boolean;
    isUnique: boolean;
    isAuthIdentifier: boolean;
    isAuthPassword: boolean;
}

interface SeedEnumFieldConfig {
    name: string;
    values: string[];
    isOptional: boolean;
}

interface SeedAuthConfig {
    identifierField: string;
    passwordField: string;
    identifierIsEmail: boolean;
    sampleIdentifier: string;
}

interface SeedModelConfig {
    name: string;
    clientKey: string;
    seedLabel: string;
    scalarFields: SeedScalarFieldConfig[];
    enumFields: SeedEnumFieldConfig[];
    relationConfigs: SeedRelationConfig[];
    uniqueSelectors: SeedUniqueSelectorConfig[];
    auth?: SeedAuthConfig;
}

interface SeedRelationDescriptor extends SeedRelationConfig {
    modelName: string;
    isSelf: boolean;
    isCyclic: boolean;
    unsupported: boolean;
}

interface SeedAnalysis {
    sortedModels: ModelDefinition[];
    modelConfigs: SeedModelConfig[];
    unsupportedRequiredRelations: string[];
}

function relationFieldNames(value?: string): string[] {
    if (!value) {
        return [];
    }
    return value.split(',').map((field) => field.trim()).filter(Boolean);
}

function isRequiredInputScalar(field?: FieldDefinition): boolean {
    return !!field
        && !field.isRelation
        && !field.isList
        && !field.isOptional
        && !field.hasDefault
        && !field.isServerDefault;
}

function isEmailLikeField(fieldName: string): boolean {
    const normalized = fieldName.toLowerCase();
    return normalized === 'email' || normalized === 'emailaddress' || normalized.endsWith('email');
}

function isTrackableSeedSelector(selector: ModelSelectorDefinition): boolean {
    return selector.kind === 'unique' || (selector.kind === 'id' && selector.fields.length > 1);
}

function collectSeedRelations(models: ModelDefinition[]): SeedRelationDescriptor[] {
    const modelNames = new Set(models.map((model) => model.name));
    const descriptors: SeedRelationDescriptor[] = [];

    for (const model of models) {
        for (const field of model.fields) {
            if (!field.isRelation || field.isList || field.isEnum) continue;
            if (!field.relationModel || !modelNames.has(field.relationModel)) continue;

            const localFields = relationFieldNames(field.relationField);
            const referenceFields = relationFieldNames(field.relationReferences);
            if (localFields.length === 0 || referenceFields.length === 0) continue;
            if (localFields.length !== referenceFields.length) continue;

            const hasAllLocalScalarFields = localFields.every((localField) =>
                model.fields.some((candidate) => candidate.name === localField && !candidate.isRelation)
            );
            if (!hasAllLocalScalarFields) continue;

            const required = localFields.every((localField) =>
                isRequiredInputScalar(model.fields.find((candidate) => candidate.name === localField))
            );

            descriptors.push({
                modelName: model.name,
                relationName: field.name,
                targetModel: field.relationModel,
                localFields,
                referenceFields,
                cacheKey: `${field.relationModel}|${referenceFields.join(',')}`,
                required,
                omit: false,
                isSelf: model.name === field.relationModel,
                isCyclic: false,
                unsupported: false,
            });
        }
    }

    return descriptors;
}

function computeStronglyConnectedComponents(
    modelNames: string[],
    relations: SeedRelationDescriptor[]
): Map<string, string[]> {
    const adjacency = new Map<string, string[]>(
        modelNames.map((modelName) => [modelName, []])
    );

    for (const relation of relations) {
        adjacency.get(relation.modelName)?.push(relation.targetModel);
    }

    const indices = new Map<string, number>();
    const lowLinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const componentByModel = new Map<string, string[]>();
    let index = 0;

    function strongConnect(modelName: string): void {
        indices.set(modelName, index);
        lowLinks.set(modelName, index);
        index += 1;
        stack.push(modelName);
        onStack.add(modelName);

        for (const target of adjacency.get(modelName) ?? []) {
            if (!indices.has(target)) {
                strongConnect(target);
                lowLinks.set(
                    modelName,
                    Math.min(lowLinks.get(modelName) ?? 0, lowLinks.get(target) ?? 0)
                );
            } else if (onStack.has(target)) {
                lowLinks.set(
                    modelName,
                    Math.min(lowLinks.get(modelName) ?? 0, indices.get(target) ?? 0)
                );
            }
        }

        if ((lowLinks.get(modelName) ?? -1) !== (indices.get(modelName) ?? -2)) {
            return;
        }

        const component: string[] = [];
        let node: string | undefined;
        do {
            node = stack.pop();
            if (!node) break;
            onStack.delete(node);
            component.push(node);
        } while (node !== modelName);

        for (const member of component) {
            componentByModel.set(member, component);
        }
    }

    for (const modelName of modelNames) {
        if (!indices.has(modelName)) {
            strongConnect(modelName);
        }
    }

    return componentByModel;
}

function annotateSeedRelations(relations: SeedRelationDescriptor[], modelNames: string[]): SeedRelationDescriptor[] {
    const componentByModel = computeStronglyConnectedComponents(modelNames, relations);

    return relations.map((relation) => {
        const component = componentByModel.get(relation.modelName) ?? [relation.modelName];
        const sameComponent = component.includes(relation.targetModel);
        const isCyclic = relation.isSelf || (component.length > 1 && sameComponent);
        const omit = !relation.required && isCyclic;
        const unsupported = relation.required && isCyclic;

        return {
            ...relation,
            isCyclic,
            omit,
            unsupported,
        };
    });
}

function topoSortModels(models: ModelDefinition[], relations: SeedRelationDescriptor[]): ModelDefinition[] {
    const dependencyEdges = new Set<string>();
    const activeRelations = relations.filter((relation) => !relation.omit && !relation.unsupported);

    const adj = new Map<string, string[]>(models.map((model) => [model.name, []]));
    const inDeg = new Map<string, number>(models.map((model) => [model.name, 0]));

    for (const relation of activeRelations) {
        const edgeKey = `${relation.targetModel}->${relation.modelName}`;
        if (dependencyEdges.has(edgeKey)) continue;
        dependencyEdges.add(edgeKey);
        adj.get(relation.targetModel)?.push(relation.modelName);
        inDeg.set(relation.modelName, (inDeg.get(relation.modelName) ?? 0) + 1);
    }

    const queue = models.filter((model) => (inDeg.get(model.name) ?? 0) === 0).map((model) => model.name);
    const byName = new Map(models.map((model) => [model.name, model]));
    const result: ModelDefinition[] = [];

    while (queue.length > 0) {
        const modelName = queue.shift()!;
        result.push(byName.get(modelName)!);
        for (const dependent of adj.get(modelName) ?? []) {
            const next = (inDeg.get(dependent) ?? 1) - 1;
            inDeg.set(dependent, next);
            if (next === 0) {
                queue.push(dependent);
            }
        }
    }

    for (const model of models) {
        if (!result.includes(model)) {
            result.push(model);
        }
    }

    return result;
}

function formatUnsupportedRelation(relation: SeedRelationDescriptor): string {
    return `Model "${relation.modelName}" relation "${relation.relationName}" cannot be auto-seeded because required fields [${relation.localFields.join(', ')}] depend on ${relation.targetModel}[${relation.referenceFields.join(', ')}] within a cyclic/self relation.`;
}

function buildSeedModelConfig(
    model: ModelDefinition,
    enums: EnumDefinition[],
    relations: SeedRelationDescriptor[]
): SeedModelConfig {
    const handledFkFields = new Set(relations.flatMap((relation) => relation.localFields));
    const enumByName = new Map(enums.map((enumDef) => [enumDef.name, enumDef.values]));

    const scalarFields = model.fields
        .filter((field) =>
            !field.isId
            && !field.hasDefault
            && !field.isRelation
            && !field.isList
            && !field.isEnum
            && !field.directives.includes('readonly')
            && !handledFkFields.has(field.name)
        )
        .map((field) => ({
            name: field.name,
            type: field.type,
            isOptional: field.isOptional,
            isUnique: field.isUnique,
            isAuthIdentifier: model.isAuthModel === true && model.identifierField === field.name,
            isAuthPassword: model.isAuthModel === true && model.passwordField === field.name,
        }));

    const enumFields = model.fields
        .filter((field) =>
            field.isEnum
            && !field.isList
            && !field.hasDefault
            && !field.directives.includes('readonly')
        )
        .map((field) => ({
            name: field.name,
            values: enumByName.get(field.type) ?? [],
            isOptional: field.isOptional,
        }));

    const generatedFieldNames = new Set<string>([
        ...scalarFields.map((field) => field.name),
        ...enumFields.map((field) => field.name),
        ...relations.filter((relation) => !relation.omit && !relation.unsupported).flatMap((relation) => relation.localFields),
    ]);

    const uniqueSelectors = (model.selectors ?? [])
        .filter(isTrackableSeedSelector)
        .filter((selector) => selector.fields.every((field) => generatedFieldNames.has(field)))
        .map((selector) => ({ fields: selector.fields }));

    const auth = model.isAuthModel && model.identifierField && model.passwordField
        ? {
            identifierField: model.identifierField,
            passwordField: model.passwordField,
            identifierIsEmail: isEmailLikeField(model.identifierField),
            sampleIdentifier: isEmailLikeField(model.identifierField)
                ? `seed-${helpers.toKebabCase(model.name)}-1@example.com`
                : `seed-${helpers.toKebabCase(model.name)}-1`,
        }
        : undefined;

    return {
        name: model.name,
        clientKey: helpers.toCamelCase(model.name),
        seedLabel: helpers.toKebabCase(model.name),
        scalarFields,
        enumFields,
        relationConfigs: relations.map((relation) => ({
            relationName: relation.relationName,
            targetModel: relation.targetModel,
            localFields: relation.localFields,
            referenceFields: relation.referenceFields,
            cacheKey: relation.cacheKey,
            required: relation.required,
            omit: relation.omit,
        })),
        uniqueSelectors,
        ...(auth ? { auth } : {}),
    };
}

function buildSeedAnalysis(schema: ParsedSchema): SeedAnalysis {
    const collectedRelations = collectSeedRelations(schema.models);
    const annotatedRelations = annotateSeedRelations(
        collectedRelations,
        schema.models.map((model) => model.name)
    );
    const sortedModels = topoSortModels(schema.models, annotatedRelations);
    const relationsByModel = new Map<string, SeedRelationDescriptor[]>();

    for (const relation of annotatedRelations) {
        const entries = relationsByModel.get(relation.modelName) ?? [];
        entries.push(relation);
        relationsByModel.set(relation.modelName, entries);
    }

    return {
        sortedModels,
        modelConfigs: sortedModels.map((model) =>
            buildSeedModelConfig(model, schema.enums, relationsByModel.get(model.name) ?? [])
        ),
        unsupportedRequiredRelations: annotatedRelations
            .filter((relation) => relation.unsupported)
            .map(formatUnsupportedRelation),
    };
}

/**
 * Generate Prisma files: cleaned schema (without @bcm directives) and seed file.
 */
export function generatePrismaFiles(schema: ParsedSchema, schemaContent?: string): GeneratedFile[] {
    const seedAnalysis = buildSeedAnalysis(schema);

    const data = {
        models: seedAnalysis.sortedModels,
        schema,
        enums: schema.enums,
        seedModelConfigs: seedAnalysis.modelConfigs,
        unsupportedRequiredRelations: seedAnalysis.unsupportedRequiredRelations,
    };

    const files: GeneratedFile[] = [
        {
            path: 'prisma/seed.ts',
            content: renderTemplate('prisma/seed.ts.ejs', data),
        },
    ];

    if (schemaContent) {
        const cleanedSchema = schemaContent
            .replace(BCM_DIRECTIVE_REGEX, '')
            .replace(/^[ \t]*url\s*=\s*(?:env\([^)]+\)|"[^"]*"|'[^']*')[ \t]*\n?/gm, '')
            .replace(/\n{3,}/g, '\n\n');
        files.unshift({
            path: 'prisma/schema.prisma',
            content: cleanedSchema,
        });
    }

    return files;
}
