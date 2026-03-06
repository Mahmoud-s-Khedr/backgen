import { describe, expect, it } from 'vitest';
import {
    getExpressItemPath,
    getOpenApiItemPath,
    resolveItemSelector,
} from '../src/generator/model-selector.js';
import type { ModelDefinition, ModelSelectorDefinition } from '../src/parser/types.js';

function makeModel(selectors: ModelSelectorDefinition[]): ModelDefinition {
    return {
        name: 'Sample',
        fields: [],
        directives: [],
        selectors,
    };
}

describe('resolveItemSelector', () => {
    it('prefers scalar @id over all other selectors', () => {
        const model = makeModel([
            { kind: 'unique', fields: ['email'] },
            { kind: 'id', fields: ['tenantId', 'userId'], prismaKey: 'tenant_user' },
            { kind: 'id', fields: ['id'] },
        ]);

        const selector = resolveItemSelector(model);
        expect(selector).toEqual({
            kind: 'id',
            fields: ['id'],
            isComposite: false,
        });
    });

    it('uses composite @@id when scalar @id is missing', () => {
        const model = makeModel([
            { kind: 'unique', fields: ['email'] },
            { kind: 'id', fields: ['tenantId', 'userId'], prismaKey: 'tenant_user' },
        ]);

        const selector = resolveItemSelector(model);
        expect(selector).toEqual({
            kind: 'id',
            fields: ['tenantId', 'userId'],
            isComposite: true,
            prismaWhereKey: 'tenant_user',
        });
    });

    it('falls back to scalar @unique when no id selectors exist', () => {
        const model = makeModel([
            { kind: 'unique', fields: ['email'] },
            { kind: 'unique', fields: ['tenantId', 'slug'], prismaKey: 'tenant_slug' },
        ]);

        const selector = resolveItemSelector(model);
        expect(selector).toEqual({
            kind: 'unique',
            fields: ['email'],
            isComposite: false,
        });
    });

    it('uses composite @@unique and derives prismaWhereKey when name is absent', () => {
        const model = makeModel([
            { kind: 'unique', fields: ['tenantId', 'slug'] },
        ]);

        const selector = resolveItemSelector(model);
        expect(selector).toEqual({
            kind: 'unique',
            fields: ['tenantId', 'slug'],
            isComposite: true,
            prismaWhereKey: 'tenantId_slug',
        });
    });

    it('returns undefined when model has no selectors', () => {
        const selector = resolveItemSelector(makeModel([]));
        expect(selector).toBeUndefined();
    });
});

describe('item path builders', () => {
    it('builds Express and OpenAPI paths for single-field selectors', () => {
        const selector = {
            kind: 'id' as const,
            fields: ['id'],
            isComposite: false,
        };

        expect(getExpressItemPath(selector)).toBe('/:id');
        expect(getOpenApiItemPath(selector)).toBe('/{id}');
    });

    it('builds Express and OpenAPI paths for composite selectors', () => {
        const selector = {
            kind: 'unique' as const,
            fields: ['tenantId', 'slug'],
            isComposite: true,
            prismaWhereKey: 'tenant_slug',
        };

        expect(getExpressItemPath(selector)).toBe('/:tenantId/:slug');
        expect(getOpenApiItemPath(selector)).toBe('/{tenantId}/{slug}');
    });
});
