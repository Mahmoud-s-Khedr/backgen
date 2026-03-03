import type { ModelDefinition, ModelSelectorDefinition } from '../parser/types.js';

export interface ResolvedItemSelector {
    kind: 'id' | 'unique';
    fields: string[];
    isComposite: boolean;
    prismaWhereKey?: string;
}

function toPrismaWhereKey(selector: ModelSelectorDefinition): string | undefined {
    if (selector.fields.length <= 1) return undefined;
    return selector.prismaKey || selector.fields.join('_');
}

/**
 * Select one unique selector used for item CRUD generation.
 * Precedence: @id > @@id > @unique > @@unique
 */
export function resolveItemSelector(model: ModelDefinition): ResolvedItemSelector | undefined {
    const selectors = model.selectors ?? [];
    const singleId = selectors.find((s) => s.kind === 'id' && s.fields.length === 1);
    if (singleId) {
        return {
            kind: 'id',
            fields: singleId.fields,
            isComposite: false,
        };
    }

    const compositeId = selectors.find((s) => s.kind === 'id' && s.fields.length > 1);
    if (compositeId) {
        return {
            kind: 'id',
            fields: compositeId.fields,
            isComposite: true,
            prismaWhereKey: toPrismaWhereKey(compositeId),
        };
    }

    const singleUnique = selectors.find((s) => s.kind === 'unique' && s.fields.length === 1);
    if (singleUnique) {
        return {
            kind: 'unique',
            fields: singleUnique.fields,
            isComposite: false,
        };
    }

    const compositeUnique = selectors.find((s) => s.kind === 'unique' && s.fields.length > 1);
    if (compositeUnique) {
        return {
            kind: 'unique',
            fields: compositeUnique.fields,
            isComposite: true,
            prismaWhereKey: toPrismaWhereKey(compositeUnique),
        };
    }

    return undefined;
}

export function getExpressItemPath(selector: ResolvedItemSelector): string {
    return `/${selector.fields.map((f) => `:${f}`).join('/')}`;
}

export function getOpenApiItemPath(selector: ResolvedItemSelector): string {
    return `/${selector.fields.map((f) => `{${f}}`).join('/')}`;
}
