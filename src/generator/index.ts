import type { ParsedSchema, GeneratedFile, GenerateOptions } from '../parser/types.js';
import { generateModuleFiles } from './generators/module-generator.js';
import { generateConfigFiles } from './generators/config-generator.js';
import { generateMiddlewareFiles } from './generators/middleware-generator.js';
import { generateUtilsFiles } from './generators/utils-generator.js';
import { generateAppFiles } from './generators/app-generator.js';
import { generateInfraFiles } from './generators/infra-generator.js';
import { generatePrismaFiles } from './generators/prisma-generator.js';
import { generateSwaggerFiles } from './generators/swagger-generator.js';
import { generateApiClientFiles } from './generators/api-client-generator.js';
import { generateJobFiles } from './generators/job-generator.js';
import { generateWsFiles } from './generators/ws-generator.js';
import { validateSchemaOrThrow } from './validate.js';

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
    validateSchemaOrThrow(schema);

    const files: GeneratedFile[] = [];

    const framework = options.framework ?? 'express';

    // Define which generators to run based on --only flag
    const generators: Record<string, () => GeneratedFile[]> = {
        routes: () => generateModuleFiles(schema, framework),
        config: () => generateConfigFiles(schema, framework, options.jobs),
        middleware: () => generateMiddlewareFiles(schema, framework),
        utils: () => generateUtilsFiles(schema, framework),
        app: () => generateAppFiles(schema, framework, options.jobs, options.ws),
        infra: () => generateInfraFiles(schema, options),
        prisma: () => generatePrismaFiles(schema, schemaContent),
        swagger: () => generateSwaggerFiles(schema),
        'api-client': () => generateApiClientFiles(schema),
        ...(options.jobs ? { jobs: () => generateJobFiles(options.jobs!) } : {}),
        ...(options.ws ? { ws: () => generateWsFiles(schema) } : {}),
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
