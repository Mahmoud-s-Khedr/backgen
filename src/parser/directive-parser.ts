import type { FieldDirective, ModelDirective } from './types.js';

/** Result of parsing directives for a single field */
export interface DirectiveResult {
    fieldName: string;
    directives: FieldDirective[];
    warnings: string[];
}

/** Parsed directives for all fields in a model */
export interface ModelDirectivesResult {
    modelName: string;
    modelDirectives: ModelDirective[];
    authRoles?: string[];
    fields: Map<string, FieldDirective[]>;
    warnings: string[];
}

const DIRECTIVE_REGEX = /^\/\/\/\s*@bcm\.(\w+)(?:\(([^)]*)\))?\s*$/;

const VALID_FIELD_DIRECTIVES: Set<string> = new Set([
    'hidden',
    'readonly',
    'writeOnly',
    'searchable',
    'nested',
    'identifier',
    'password',
]);

const VALID_MODEL_DIRECTIVES: Set<string> = new Set([
    'protected',
    'softDelete',
    'auth',
    'authModel',
]);

/**
 * Parse role names from @bcm.auth(roles: [ADMIN, MODERATOR]) arguments.
 */
function parseAuthRoles(rawArgs: string): string[] {
    const match = rawArgs.match(/roles:\s*\[([^\]]*)\]/);
    if (!match) return [];
    return match[1].split(',').map(r => r.trim()).filter(Boolean);
}

const CONFLICTING_PAIRS: [FieldDirective, FieldDirective][] = [
    ['hidden', 'writeOnly'],   // contradictory: hidden excludes from inputs, writeOnly accepts in inputs
    ['hidden', 'readonly'],    // redundant: hidden already excludes from inputs and outputs; readonly only excludes inputs
    ['readonly', 'writeOnly'], // Can't be both readonly and writeOnly
    ['password', 'writeOnly'], // redundant: @bcm.password already implies writeOnly
    ['password', 'readonly'],  // Can't be both password and readonly
    ['password', 'hidden'],    // Can't be both password and hidden
];

/**
 * Parse @bcm.* directives from raw schema file content.
 *
 * Reads the file line by line and associates each directive with the
 * model or field declaration that immediately follows it.
 *
 * - Model-level directives (e.g., @bcm.protected): placed before `model X {`
 * - Field-level directives (e.g., @bcm.readonly): placed before a field line
 *
 * @param schemaContent - Raw content of the .prisma file
 * @returns Map of model name → directives result
 */
export function parseDirectives(
    schemaContent: string
): Map<string, ModelDirectivesResult> {
    const lines = schemaContent.split('\n');
    const results = new Map<string, ModelDirectivesResult>();

    let currentModel: string | null = null;
    let pendingFieldDirectives: FieldDirective[] = [];
    let pendingModelDirectives: ModelDirective[] = [];
    let pendingAuthRoles: string[] = [];
    let pendingWarnings: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineNum = i + 1;

        // Detect model block start — attach any pending model-level directives
        const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
        if (modelMatch) {
            currentModel = modelMatch[1];
            if (!results.has(currentModel)) {
                results.set(currentModel, {
                    modelName: currentModel,
                    modelDirectives: [...pendingModelDirectives],
                    authRoles: pendingAuthRoles.length > 0 ? [...pendingAuthRoles] : undefined,
                    fields: new Map(),
                    warnings: [...pendingWarnings],
                });
            } else {
                const result = results.get(currentModel)!;
                result.modelDirectives.push(...pendingModelDirectives);
                if (pendingAuthRoles.length > 0) {
                    result.authRoles = [...pendingAuthRoles];
                }
                result.warnings.push(...pendingWarnings);
            }
            pendingFieldDirectives = [];
            pendingModelDirectives = [];
            pendingAuthRoles = [];
            pendingWarnings = [];
            continue;
        }

        // Detect block end
        if (line === '}') {
            // Flush any straggling field directives that weren't attached to a field
            if (pendingFieldDirectives.length > 0 && currentModel) {
                const result = results.get(currentModel)!;
                result.warnings.push(
                    `Line ${lineNum}: Found @bcm directives without a following field declaration`
                );
            }
            currentModel = null;
            pendingFieldDirectives = [];
            pendingModelDirectives = [];
            pendingAuthRoles = [];
            pendingWarnings = [];
            continue;
        }

        // Check for directive comment (inside or outside a model block)
        const directiveMatch = line.match(DIRECTIVE_REGEX);
        if (directiveMatch) {
            const directiveName = directiveMatch[1];
            const directiveArgs = directiveMatch[2]; // e.g., "roles: [ADMIN, MODERATOR]"

            if (VALID_MODEL_DIRECTIVES.has(directiveName)) {
                if (currentModel) {
                    // Model directive inside a model block — warn and skip
                    pendingWarnings.push(
                        `Line ${lineNum}: @bcm.${directiveName} is a model-level directive; place it before the model declaration`
                    );
                } else {
                    pendingModelDirectives.push(directiveName as ModelDirective);
                    if (directiveName === 'auth' && directiveArgs) {
                        pendingAuthRoles = parseAuthRoles(directiveArgs);
                    }
                }
                continue;
            }

            if (VALID_FIELD_DIRECTIVES.has(directiveName)) {
                if (!currentModel) {
                    // Field directive outside a model block — warn
                    pendingWarnings.push(
                        `Line ${lineNum}: @bcm.${directiveName} is a field directive but appears outside a model block — it will be ignored`
                    );
                    continue;
                }
                pendingFieldDirectives.push(directiveName as FieldDirective);
                continue;
            }

            // Unknown directive
            pendingWarnings.push(
                `Line ${lineNum}: Unknown directive @bcm.${directiveName}`
            );
            continue;
        }

        // Skip empty lines and regular comments
        if (line === '' || line.startsWith('//')) continue;

        // We're inside a model block — this must be a field declaration
        if (!currentModel) continue;

        const fieldMatch = line.match(/^(\w+)\s+/);
        if (fieldMatch && pendingFieldDirectives.length > 0) {
            const fieldName = fieldMatch[1];
            const result = results.get(currentModel)!;

            // Check for conflicting directives
            for (const [a, b] of CONFLICTING_PAIRS) {
                if (pendingFieldDirectives.includes(a) && pendingFieldDirectives.includes(b)) {
                    result.warnings.push(
                        `Line ${lineNum}: Field "${fieldName}" has conflicting directives @bcm.${a} and @bcm.${b}`
                    );
                }
            }

            result.fields.set(fieldName, [...pendingFieldDirectives]);
            result.warnings.push(...pendingWarnings);
        }

        // Reset pending for next field
        pendingFieldDirectives = [];
        pendingWarnings = [];
    }

    return results;
}

/**
 * Get directives for a specific field in a model.
 */
export function getFieldDirectives(
    directivesMap: Map<string, ModelDirectivesResult>,
    modelName: string,
    fieldName: string
): FieldDirective[] {
    const model = directivesMap.get(modelName);
    if (!model) return [];
    return model.fields.get(fieldName) || [];
}
