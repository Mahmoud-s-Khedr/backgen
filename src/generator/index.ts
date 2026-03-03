import type { ParsedSchema, GeneratedFile, GenerateOptions, FieldDefinition } from '../parser/types.js';
import { generateModuleFiles } from './generators/module-generator.js';
import { generateConfigFiles } from './generators/config-generator.js';
import { generateMiddlewareFiles } from './generators/middleware-generator.js';
import { generateUtilsFiles } from './generators/utils-generator.js';
import { generateAppFiles } from './generators/app-generator.js';
import { generateInfraFiles } from './generators/infra-generator.js';
import { generatePrismaFiles } from './generators/prisma-generator.js';
import { generateSwaggerFiles } from './generators/swagger-generator.js';

/**
 * Main generation orchestrator.
 * Takes a parsed schema and options, runs all sub-generators,
 * and returns the complete list of files to write.
 */
export async function generateProject(
    schema: ParsedSchema,
    options: GenerateOptions,
    schemaContent?: string
): Promise<GeneratedFile[]> {
    validateAuthConfiguration(schema);
    validateSoftDeleteConfiguration(schema);
    validateHiddenRequiredForeignKeys(schema);
    validateReadonlyRequiredFields(schema);
    validateMixedRequiredRelationInputModes(schema);

    const files: GeneratedFile[] = [];

    // Define which generators to run based on --only flag
    const generators: Record<string, () => GeneratedFile[]> = {
        routes: () => generateModuleFiles(schema),
        config: () => generateConfigFiles(schema),
        middleware: () => generateMiddlewareFiles(schema),
        utils: () => generateUtilsFiles(schema),
        app: () => generateAppFiles(schema),
        infra: () => generateInfraFiles(schema, options),
        prisma: () => generatePrismaFiles(schema, schemaContent),
        swagger: () => generateSwaggerFiles(schema),
    };

    if (options.only) {
        // Generate only a specific part
        const generator = generators[options.only];
        if (!generator) {
            throw new Error(
                `Unknown --only value: "${options.only}". Valid options: ${Object.keys(generators).join(', ')}`
            );
        }
        files.push(...generator());
    } else {
        // Generate everything
        for (const generator of Object.values(generators)) {
            files.push(...generator());
        }
    }

    return files;
}

function relationFieldNames(relationField?: string): string[] {
    if (!relationField) {
        return [];
    }
    return relationField.split(',').map((name) => name.trim()).filter(Boolean);
}

function isRequiredInputScalar(field: FieldDefinition | undefined): field is FieldDefinition {
    return !!field
        && !field.isRelation
        && !field.isList
        && !field.isOptional
        && !field.hasDefault
        && !field.isServerDefault;
}

function validateAuthConfiguration(schema: ParsedSchema): void {
    const hasRbacModels = schema.models.some((m) => m.directives.includes('auth'));
    if (!hasRbacModels) {
        return;
    }

    const authModel = schema.models.find((m) => m.isAuthModel);
    if (!authModel) {
        throw new Error(
            'RBAC requires an auth model. Add /// @bcm.authModel to a model with /// @bcm.identifier, /// @bcm.password, and a scalar role field named "role".'
        );
    }

    if (!authModel.identifierField || !authModel.passwordField || !authModel.roleField) {
        throw new Error(
            `Auth model "${authModel.name}" is incomplete for RBAC. Required: /// @bcm.identifier, /// @bcm.password, and a scalar role field named "role".`
        );
    }

    const identifier = authModel.fields.find((f) => f.name === authModel.identifierField);
    if (!identifier || identifier.isRelation || identifier.isList || (!identifier.isUnique && !identifier.isId)) {
        throw new Error(
            `Auth model "${authModel.name}": @bcm.identifier field "${authModel.identifierField}" must be unique (@unique or @id), scalar, and non-list.`
        );
    }
}

function validateHiddenRequiredForeignKeys(schema: ParsedSchema): void {
    const violations: string[] = [];

    for (const model of schema.models) {
        const relationFields = model.fields.filter(
            (f) => f.isRelation && !f.isList && f.relationField
        );

        for (const relation of relationFields) {
            const fkNames = relationFieldNames(relation.relationField);
            for (const fkName of fkNames) {
                const fk = model.fields.find((f) => f.name === fkName);
                if (!isRequiredInputScalar(fk)) {
                    continue;
                }
                if (!fk.directives.includes('hidden')) {
                    continue;
                }

                const hasValidNestedPath = relation.directives.includes('nested');
                if (!hasValidNestedPath) {
                    violations.push(
                        `Model "${model.name}" relation "${relation.name}" uses hidden required FK field "${fk.name}" without a supported nested input path.`
                    );
                }
            }
        }
    }

    if (violations.length > 0) {
        const details = violations.map((v) => `- ${v}`).join('\n');
        throw new Error(
            `Invalid schema for API generation:\n${details}\n` +
            'Fix by adding /// @bcm.nested to the relation field, or removing /// @bcm.hidden from the required FK field, or making the FK optional/defaulted.'
        );
    }
}

function validateSoftDeleteConfiguration(schema: ParsedSchema): void {
    const violations: string[] = [];

    for (const model of schema.models) {
        if (!model.directives.includes('softDelete')) {
            continue;
        }

        const deletedAt = model.fields.find((field) => field.name === 'deletedAt');
        if (!deletedAt) {
            violations.push(
                `Model "${model.name}" uses @bcm.softDelete but is missing field "deletedAt". Expected deletedAt DateTime?.`
            );
            continue;
        }

        if (
            deletedAt.type !== 'DateTime'
            || !deletedAt.isOptional
            || deletedAt.isList
            || deletedAt.isRelation
            || deletedAt.isEnum
        ) {
            violations.push(
                `Model "${model.name}" field "deletedAt" is invalid for @bcm.softDelete. Expected deletedAt DateTime?.`
            );
        }
    }

    if (violations.length > 0) {
        const details = violations.map((violation) => `- ${violation}`).join('\n');
        throw new Error(
            `Invalid schema for API generation:\n${details}\n` +
            'Fix soft delete models by declaring deletedAt DateTime?.'
        );
    }
}

function validateReadonlyRequiredFields(schema: ParsedSchema): void {
    const violations: string[] = [];

    for (const model of schema.models) {
        for (const field of model.fields) {
            const isReadonlyRequiredScalar = field.directives.includes('readonly')
                && !field.isRelation
                && !field.isList
                && !field.isOptional
                && !field.hasDefault
                && !field.isServerDefault;
            if (!isReadonlyRequiredScalar) {
                continue;
            }
            violations.push(
                `Model "${model.name}" field "${field.name}" is required and marked @bcm.readonly, but readonly fields are excluded from create/update inputs.`
            );
        }
    }

    if (violations.length > 0) {
        const details = violations.map((v) => `- ${v}`).join('\n');
        throw new Error(
            `Invalid schema for API generation:\n${details}\n` +
            'Fix by removing /// @bcm.readonly, or making the field optional, or adding a default.'
        );
    }
}

function validateMixedRequiredRelationInputModes(schema: ParsedSchema): void {
    const violations: string[] = [];

    for (const model of schema.models) {
        const relationFields = model.fields.filter((f) => f.isRelation && !f.isList && f.relationField);
        const requiredRelations = relationFields.filter((relation) => {
            const fkNames = relationFieldNames(relation.relationField);
            if (fkNames.length === 0) {
                return false;
            }
            return fkNames.every((fkName) => isRequiredInputScalar(model.fields.find((f) => f.name === fkName)));
        });

        const requiredNested = requiredRelations.filter((relation) => relation.directives.includes('nested'));
        const requiredNonNested = requiredRelations.filter((relation) => !relation.directives.includes('nested'));

        if (requiredNested.length === 0 || requiredNonNested.length === 0) {
            continue;
        }

        const nestedNames = requiredNested.map((relation) => relation.name).join(', ');
        const nonNestedNames = requiredNonNested.map((relation) => relation.name).join(', ');
        violations.push(
            `Model "${model.name}" mixes required @bcm.nested relations (${nestedNames}) with required non-nested relations (${nonNestedNames}), which produces incompatible Prisma input shapes.`
        );
    }

    if (violations.length > 0) {
        const details = violations.map((v) => `- ${v}`).join('\n');
        throw new Error(
            `Invalid schema for API generation:\n${details}\n` +
            'Fix by choosing one input mode for required relations in a model: mark all required relations with /// @bcm.nested, or mark none of them.'
        );
    }
}
