import type { ParsedSchema, FieldDefinition } from '../parser/types.js';

export interface ValidationIssue {
    severity: 'error' | 'warning';
    model?: string;
    field?: string;
    directive?: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
}

/**
 * Runs all directive and structural validation checks on a parsed schema.
 * Returns a ValidationResult instead of throwing, so callers can choose
 * whether to surface issues interactively (validate command) or throw (generate command).
 */
export function validateSchema(schema: ParsedSchema): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    checkAuthConfiguration(schema, errors);
    checkSoftDeleteConfiguration(schema, errors);
    checkHiddenRequiredForeignKeys(schema, errors);
    checkReadonlyRequiredFields(schema, errors);
    checkMixedRequiredRelationInputModes(schema, errors);
    checkCursorConfiguration(schema, errors);

    // Parser-level warnings become validation warnings
    for (const w of schema.warnings) {
        warnings.push({ severity: 'warning', message: w });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Validates and throws on the first category of errors — used by the generate command
 * to preserve the existing fail-fast behaviour.
 */
export function validateSchemaOrThrow(schema: ParsedSchema): void {
    throwIfErrors(checkAuthConfiguration, schema);
    throwIfErrors(checkSoftDeleteConfiguration, schema);
    throwIfErrors(checkHiddenRequiredForeignKeys, schema);
    throwIfErrors(checkReadonlyRequiredFields, schema);
    throwIfErrors(checkMixedRequiredRelationInputModes, schema);
    throwIfErrors(checkCursorConfiguration, schema);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function throwIfErrors(
    check: (schema: ParsedSchema, errors: ValidationIssue[]) => void,
    schema: ParsedSchema
): void {
    const errors: ValidationIssue[] = [];
    check(schema, errors);
    if (errors.length > 0) {
        const details = errors.map((e) => `- ${e.message}`).join('\n');
        throw new Error(`Invalid schema for API generation:\n${details}`);
    }
}

function relationFieldNames(relationField?: string): string[] {
    if (!relationField) return [];
    return relationField.split(',').map((n) => n.trim()).filter(Boolean);
}

function isRequiredInputScalar(field: FieldDefinition | undefined): field is FieldDefinition {
    return (
        !!field &&
        !field.isRelation &&
        !field.isList &&
        !field.isOptional &&
        !field.hasDefault &&
        !field.isServerDefault
    );
}

function checkAuthConfiguration(schema: ParsedSchema, errors: ValidationIssue[]): void {
    const hasRbacModels = schema.models.some((m) => m.directives.includes('auth'));
    if (!hasRbacModels) return;

    const authModel = schema.models.find((m) => m.isAuthModel);
    if (!authModel) {
        errors.push({
            severity: 'error',
            directive: 'auth',
            message:
                'RBAC requires an auth model. Add /// @bcm.authModel to a model with /// @bcm.identifier, /// @bcm.password, and a scalar role field named "role".',
        });
        return;
    }

    if (!authModel.identifierField || !authModel.passwordField || !authModel.roleField) {
        errors.push({
            severity: 'error',
            model: authModel.name,
            directive: 'authModel',
            message:
                `Auth model "${authModel.name}" is incomplete for RBAC. Required: /// @bcm.identifier, /// @bcm.password, and a scalar role field named "role".`,
        });
        return;
    }

    const identifier = authModel.fields.find((f) => f.name === authModel.identifierField);
    if (!identifier || identifier.isRelation || identifier.isList || (!identifier.isUnique && !identifier.isId)) {
        errors.push({
            severity: 'error',
            model: authModel.name,
            field: authModel.identifierField,
            directive: 'identifier',
            message:
                `Auth model "${authModel.name}": @bcm.identifier field "${authModel.identifierField}" must be unique (@unique or @id), scalar, and non-list.`,
        });
    }
}

function checkSoftDeleteConfiguration(schema: ParsedSchema, errors: ValidationIssue[]): void {
    for (const model of schema.models) {
        if (!model.directives.includes('softDelete')) continue;

        const deletedAt = model.fields.find((f) => f.name === 'deletedAt');
        if (!deletedAt) {
            errors.push({
                severity: 'error',
                model: model.name,
                directive: 'softDelete',
                message: `Model "${model.name}" uses @bcm.softDelete but is missing field "deletedAt". Expected: deletedAt DateTime?`,
            });
            continue;
        }

        if (
            deletedAt.type !== 'DateTime' ||
            !deletedAt.isOptional ||
            deletedAt.isList ||
            deletedAt.isRelation ||
            deletedAt.isEnum
        ) {
            errors.push({
                severity: 'error',
                model: model.name,
                field: 'deletedAt',
                directive: 'softDelete',
                message: `Model "${model.name}" field "deletedAt" is invalid for @bcm.softDelete. Expected: deletedAt DateTime?`,
            });
        }
    }
}

function checkHiddenRequiredForeignKeys(schema: ParsedSchema, errors: ValidationIssue[]): void {
    for (const model of schema.models) {
        const relationFields = model.fields.filter((f) => f.isRelation && !f.isList && f.relationField);

        for (const relation of relationFields) {
            const fkNames = relationFieldNames(relation.relationField);
            for (const fkName of fkNames) {
                const fk = model.fields.find((f) => f.name === fkName);
                if (!isRequiredInputScalar(fk)) continue;
                if (!fk.directives.includes('hidden')) continue;
                if (relation.directives.includes('nested')) continue;

                errors.push({
                    severity: 'error',
                    model: model.name,
                    field: fkName,
                    directive: 'hidden',
                    message:
                        `Model "${model.name}" relation "${relation.name}" uses hidden required FK field "${fkName}" without a supported nested input path. ` +
                        'Add /// @bcm.nested to the relation, or remove /// @bcm.hidden from the FK, or make the FK optional/defaulted.',
                });
            }
        }
    }
}

function checkReadonlyRequiredFields(schema: ParsedSchema, errors: ValidationIssue[]): void {
    for (const model of schema.models) {
        for (const field of model.fields) {
            const isReadonlyRequiredScalar =
                field.directives.includes('readonly') &&
                !field.isRelation &&
                !field.isList &&
                !field.isOptional &&
                !field.hasDefault &&
                !field.isServerDefault;

            if (!isReadonlyRequiredScalar) continue;

            errors.push({
                severity: 'error',
                model: model.name,
                field: field.name,
                directive: 'readonly',
                message:
                    `Model "${model.name}" field "${field.name}" is required and marked @bcm.readonly, but readonly fields are excluded from create/update inputs. ` +
                    'Fix by removing /// @bcm.readonly, or making the field optional, or adding a default.',
            });
        }
    }
}

function checkMixedRequiredRelationInputModes(schema: ParsedSchema, errors: ValidationIssue[]): void {
    for (const model of schema.models) {
        const relationFields = model.fields.filter((f) => f.isRelation && !f.isList && f.relationField);
        const requiredRelations = relationFields.filter((relation) => {
            const fkNames = relationFieldNames(relation.relationField);
            if (fkNames.length === 0) return false;
            return fkNames.every((fkName) => isRequiredInputScalar(model.fields.find((f) => f.name === fkName)));
        });

        const requiredNested = requiredRelations.filter((r) => r.directives.includes('nested'));
        const requiredNonNested = requiredRelations.filter((r) => !r.directives.includes('nested'));

        if (requiredNested.length === 0 || requiredNonNested.length === 0) continue;

        const nestedNames = requiredNested.map((r) => r.name).join(', ');
        const nonNestedNames = requiredNonNested.map((r) => r.name).join(', ');
        errors.push({
            severity: 'error',
            model: model.name,
            directive: 'nested',
            message:
                `Model "${model.name}" mixes required @bcm.nested relations (${nestedNames}) with required non-nested relations (${nonNestedNames}), ` +
                'which produces incompatible Prisma input shapes. Mark all or none required relations with /// @bcm.nested.',
        });
    }
}

function checkCursorConfiguration(schema: ParsedSchema, errors: ValidationIssue[]): void {
    for (const model of schema.models) {
        const cursorField = model.cursorConfig?.field;
        if (!cursorField) continue;

        const hasSupportedSelector = model.selectors?.some(
            (selector) => selector.fields.length === 1 && selector.fields[0] === cursorField
        );

        if (hasSupportedSelector) continue;

        errors.push({
            severity: 'error',
            model: model.name,
            field: cursorField,
            directive: 'cursor',
            message:
                `Model "${model.name}" uses @bcm.cursor(field: "${cursorField}") but "${cursorField}" is not a single-field @id or @unique selector.`,
        });
    }
}
