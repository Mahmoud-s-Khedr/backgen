/**
 * Browser-compatible entry point for the generator.
 * Re-exports the parser and generator for use in the web playground.
 */
export { parsePrismaAst } from '../parser/prisma-ast-parser.js';
export { generateProject } from './index.js';
export { setTemplateStore } from './template-engine.js';
export type { ParsedSchema, GeneratedFile, GenerateOptions } from '../parser/types.js';
