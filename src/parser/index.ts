import { readFile } from 'fs/promises';
import type { ParsedSchema } from './types.js';
import { parsePrismaAst } from './prisma-ast-parser.js';

/**
 * Parse a Prisma schema file.
 *
 * Uses @mrleebo/prisma-ast as the sole parser. This community parser
 * provides a stable, documented AST API and preserves triple-slash comments,
 * which is required for @bcm.* directive extraction.
 *
 * @param schemaPath - Absolute or relative path to the .prisma file
 * @returns Parsed schema with models, enums, datasource, and directives
 */
export async function parseSchema(schemaPath: string): Promise<ParsedSchema> {
    const schemaContent = await readFile(schemaPath, 'utf-8');

    if (!schemaContent.trim()) {
        throw new Error(`Schema file is empty: ${schemaPath}`);
    }

    try {
        return parsePrismaAst(schemaContent);
    } catch (error) {
        throw new Error(
            `Failed to parse Prisma schema: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
