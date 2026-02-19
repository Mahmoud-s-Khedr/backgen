import { readFileSync } from 'fs';
import type { ParsedSchema, ModelDefinition, EnumDefinition, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

const BCM_DIRECTIVE_REGEX = /^\s*\/\/\/\s*@bcm\.\w+.*\n?/gm;

/**
 * Produce a topologically sorted copy of models so that models without
 * FK dependencies are seeded first (parent rows before child rows).
 *
 * A model M depends on N when M has a non-list, non-enum relation object
 * field whose companion scalar `<rel.name>Id` exists in M's fields and
 * the relation points to model N. Cycle members are appended in original
 * order at the end (Kahn's algorithm graceful degradation).
 */
function topoSortModels(
    models: ModelDefinition[],
    enums: EnumDefinition[]
): ModelDefinition[] {
    const enumNames = new Set(enums.map((e) => e.name));
    const modelNames = new Set(models.map((m) => m.name));

    // adj[N] = [M, ...] means M depends on N (N must come first)
    const adj = new Map<string, string[]>(models.map((m) => [m.name, []]));
    const inDeg = new Map<string, number>(models.map((m) => [m.name, 0]));

    for (const m of models) {
        for (const f of m.fields) {
            // Only consider non-list, non-enum relation object fields
            if (!f.isRelation || f.isList || enumNames.has(f.type) || f.type === m.name) continue;
            // The relation must have a companion FK scalar field (e.g., authorId for author)
            const fkName = f.name + 'Id';
            if (!m.fields.some((sf) => sf.name === fkName && !sf.isRelation)) continue;
            if (!modelNames.has(f.type)) continue;
            // m depends on f.type → f.type comes before m
            adj.get(f.type)!.push(m.name);
            inDeg.set(m.name, (inDeg.get(m.name) ?? 0) + 1);
        }
    }

    // Kahn's BFS topological sort
    const queue = models.filter((m) => (inDeg.get(m.name) ?? 0) === 0).map((m) => m.name);
    const byName = new Map(models.map((m) => [m.name, m]));
    const result: ModelDefinition[] = [];

    while (queue.length > 0) {
        const name = queue.shift()!;
        result.push(byName.get(name)!);
        for (const dep of adj.get(name) ?? []) {
            const d = (inDeg.get(dep) ?? 1) - 1;
            inDeg.set(dep, d);
            if (d === 0) queue.push(dep);
        }
    }

    // Append any nodes not reached (cycle members) in original order
    for (const m of models) {
        if (!result.includes(m)) result.push(m);
    }

    return result;
}

/**
 * Generate Prisma files: cleaned schema (without @bcm directives) and seed file.
 */
export function generatePrismaFiles(schema: ParsedSchema, schemaContent?: string): GeneratedFile[] {
    const sortedModels = topoSortModels(schema.models, schema.enums);

    const data = {
        models: sortedModels,
        schema,
        enums: schema.enums,
    };

    const files: GeneratedFile[] = [
        {
            path: 'prisma/seed.ts',
            content: renderTemplate('prisma/seed.ts.ejs', data),
        },
    ];

    // If we have the raw schema content, include a cleaned version
    if (schemaContent) {
        const cleanedSchema = schemaContent.replace(BCM_DIRECTIVE_REGEX, '');
        files.unshift({
            path: 'prisma/schema.prisma',
            content: cleanedSchema,
        });
    }

    return files;
}
