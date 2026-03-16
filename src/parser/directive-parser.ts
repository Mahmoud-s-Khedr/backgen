import type { FieldDirective, ModelDirective, CacheConfig, UploadConfig, TransformConfig, RateLimitConfig, CursorConfig, MultitenancyConfig } from './types.js';

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
    cacheConfig?: CacheConfig;
    rateLimitConfig?: RateLimitConfig;
    cursorConfig?: CursorConfig;
    multitenancyConfig?: MultitenancyConfig;
    fields: Map<string, FieldDirective[]>;
    uploadConfigs: Map<string, UploadConfig>;
    transformConfigs: Map<string, TransformConfig>;
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
    'upload',
    'transform',
]);

const VALID_MODEL_DIRECTIVES: Set<string> = new Set([
    'protected',
    'softDelete',
    'auth',
    'authModel',
    'cache',
    'rateLimit',
    'cursor',
    'event',
    'audit',
    'multitenancy',
    'ws',
]);

/**
 * Parse role names from @bcm.auth(roles: [ADMIN, MODERATOR]) arguments.
 */
function parseAuthRoles(rawArgs: string): string[] {
    const match = rawArgs.match(/roles:\s*\[([^\]]*)\]/);
    if (!match) return [];
    return match[1].split(',').map(r => r.trim()).filter(Boolean);
}

/**
 * Parse @bcm.cache(ttl: 300) arguments.
 */
function parseCacheArgs(rawArgs: string): CacheConfig {
    const ttlMatch = rawArgs.match(/ttl:\s*(\d+)/);
    return { ttl: ttlMatch ? parseInt(ttlMatch[1], 10) : 300 };
}

/**
 * Parse @bcm.upload(dest:"avatars", maxSize:5242880, mimeTypes:["image/jpeg"]) arguments.
 */
function parseUploadArgs(rawArgs: string): UploadConfig {
    const destMatch = rawArgs.match(/dest:\s*["']([^"']+)["']/);
    const maxSizeMatch = rawArgs.match(/maxSize:\s*(\d+)/);
    const mimeTypesMatch = rawArgs.match(/mimeTypes:\s*\[([^\]]*)\]/);

    const dest = destMatch ? destMatch[1] : 'uploads';
    const maxSize = maxSizeMatch ? parseInt(maxSizeMatch[1], 10) : undefined;
    const mimeTypes = mimeTypesMatch
        ? mimeTypesMatch[1].split(',').map(m => m.trim().replace(/["']/g, '')).filter(Boolean)
        : undefined;

    return { dest, ...(maxSize !== undefined ? { maxSize } : {}), ...(mimeTypes ? { mimeTypes } : {}) };
}

/**
 * Parse @bcm.transform(trim: true, lowercase: true) arguments.
 */
function parseTransformArgs(rawArgs: string): TransformConfig {
    const config: TransformConfig = {};
    if (/trim:\s*true/.test(rawArgs)) config.trim = true;
    if (/lowercase:\s*true/.test(rawArgs)) config.lowercase = true;
    if (/uppercase:\s*true/.test(rawArgs)) config.uppercase = true;
    return config;
}

/**
 * Parse @bcm.rateLimit(max: 10, window: "1m") arguments.
 */
function parseRateLimitArgs(rawArgs: string): RateLimitConfig {
    const maxMatch = rawArgs.match(/max:\s*(\d+)/);
    const windowMatch = rawArgs.match(/window:\s*["']([^"']+)["']/);
    const max = maxMatch ? parseInt(maxMatch[1], 10) : 100;
    const windowMs = windowMatch ? parseDuration(windowMatch[1]) : 60_000;
    return { max, windowMs };
}

/**
 * Parse a duration string like "1m", "30s", "1h" into milliseconds.
 */
function parseDuration(str: string): number {
    const match = str.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) return 60_000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 'ms') return value;
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60_000;
    if (unit === 'h') return value * 3_600_000;
    return 60_000;
}

/**
 * Parse @bcm.cursor(field: "createdAt") arguments.
 */
function parseCursorArgs(rawArgs: string): CursorConfig {
    const fieldMatch = rawArgs.match(/field:\s*["']([^"']+)["']/);
    return { field: fieldMatch ? fieldMatch[1] : 'id' };
}

/**
 * Parse @bcm.multitenancy(field: "orgId") arguments.
 */
function parseMultitenancyArgs(rawArgs: string): MultitenancyConfig {
    const fieldMatch = rawArgs.match(/field:\s*["']([^"']+)["']/);
    return { field: fieldMatch ? fieldMatch[1] : 'tenantId' };
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
    let pendingCacheConfig: CacheConfig | undefined;
    let pendingRateLimitConfig: RateLimitConfig | undefined;
    let pendingCursorConfig: CursorConfig | undefined;
    let pendingMultitenancyConfig: MultitenancyConfig | undefined;
    let pendingUploadConfig: UploadConfig | undefined;
    let pendingTransformConfig: TransformConfig | undefined;
    let pendingWarnings: string[] = []; // Warnings collected outside model blocks.

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineNum = i + 1;

        // Detect model block start — attach any pending model-level directives
        const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
        if (modelMatch) {
            currentModel = modelMatch[1];
            const result: ModelDirectivesResult = results.get(currentModel) ?? {
                modelName: currentModel,
                modelDirectives: [],
                fields: new Map(),
                uploadConfigs: new Map(),
                transformConfigs: new Map(),
                warnings: [],
            };
            result.modelDirectives.push(...pendingModelDirectives);
            if (pendingAuthRoles.length > 0) {
                result.authRoles = [...pendingAuthRoles];
            }
            if (pendingCacheConfig) {
                result.cacheConfig = pendingCacheConfig;
            }
            if (pendingRateLimitConfig) {
                result.rateLimitConfig = pendingRateLimitConfig;
            }
            if (pendingCursorConfig) {
                result.cursorConfig = pendingCursorConfig;
            }
            if (pendingMultitenancyConfig) {
                result.multitenancyConfig = pendingMultitenancyConfig;
            }
            result.warnings.push(...pendingWarnings);
            results.set(currentModel, result);
            pendingFieldDirectives = [];
            pendingModelDirectives = [];
            pendingAuthRoles = [];
            pendingCacheConfig = undefined;
            pendingRateLimitConfig = undefined;
            pendingCursorConfig = undefined;
            pendingMultitenancyConfig = undefined;
            pendingWarnings = [];
            continue;
        }

        // Detect model block end
        if (line === '}' && currentModel) {
            // Flush any straggling field directives that weren't attached to a field
            if (pendingFieldDirectives.length > 0) {
                const result = results.get(currentModel)!;
                result.warnings.push(
                    `Line ${lineNum}: Found @bcm directives without a following field declaration`
                );
            }
            currentModel = null;
            pendingFieldDirectives = [];
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
                    const result = results.get(currentModel)!;
                    result.warnings.push(
                        `Line ${lineNum}: @bcm.${directiveName} is a model-level directive; place it before the model declaration`
                    );
                } else {
                    pendingModelDirectives.push(directiveName as ModelDirective);
                    if (directiveName === 'auth' && directiveArgs) {
                        pendingAuthRoles = parseAuthRoles(directiveArgs);
                    }
                    if (directiveName === 'cache') {
                        pendingCacheConfig = parseCacheArgs(directiveArgs ?? '');
                    }
                    if (directiveName === 'rateLimit' && directiveArgs) {
                        pendingRateLimitConfig = parseRateLimitArgs(directiveArgs);
                    }
                    if (directiveName === 'cursor' && directiveArgs) {
                        pendingCursorConfig = parseCursorArgs(directiveArgs);
                    }
                    if (directiveName === 'multitenancy' && directiveArgs) {
                        pendingMultitenancyConfig = parseMultitenancyArgs(directiveArgs);
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
                if (directiveName === 'upload' && directiveArgs) {
                    pendingUploadConfig = parseUploadArgs(directiveArgs);
                }
                if (directiveName === 'transform' && directiveArgs) {
                    pendingTransformConfig = parseTransformArgs(directiveArgs);
                }
                continue;
            }

            // Unknown directive
            if (currentModel) {
                const result = results.get(currentModel)!;
                result.warnings.push(`Line ${lineNum}: Unknown directive @bcm.${directiveName}`);
            } else {
                pendingWarnings.push(`Line ${lineNum}: Unknown directive @bcm.${directiveName}`);
            }
            continue;
        }

        // Skip empty lines and regular comments
        if (line === '' || line.startsWith('//')) continue;

        // We're inside a model block — this must be a field declaration
        if (!currentModel) continue;

        const fieldMatch = line.match(/^(\w+)\s+/);
        if (fieldMatch) {
            if (pendingFieldDirectives.length > 0) {
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
                if (pendingUploadConfig) {
                    result.uploadConfigs.set(fieldName, pendingUploadConfig);
                }
                if (pendingTransformConfig) {
                    result.transformConfigs.set(fieldName, pendingTransformConfig);
                }
            }
            pendingFieldDirectives = [];
            pendingUploadConfig = undefined;
            pendingTransformConfig = undefined;
        }
    }

    if (currentModel && pendingFieldDirectives.length > 0) {
        const result = results.get(currentModel);
        result?.warnings.push(
            `Line ${lines.length}: Found @bcm directives without a following field declaration`
        );
    }

    if (!currentModel && pendingWarnings.length > 0 && results.size > 0) {
        const lastModel = Array.from(results.values()).at(-1);
        lastModel?.warnings.push(...pendingWarnings);
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

/**
 * Get upload config for a specific field in a model, if any.
 */
export function getFieldUploadConfig(
    directivesMap: Map<string, ModelDirectivesResult>,
    modelName: string,
    fieldName: string
): UploadConfig | undefined {
    return directivesMap.get(modelName)?.uploadConfigs.get(fieldName);
}

/**
 * Get transform config for a specific field in a model, if any.
 */
export function getFieldTransformConfig(
    directivesMap: Map<string, ModelDirectivesResult>,
    modelName: string,
    fieldName: string
): TransformConfig | undefined {
    return directivesMap.get(modelName)?.transformConfigs.get(fieldName);
}
