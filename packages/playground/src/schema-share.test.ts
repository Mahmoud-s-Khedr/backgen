import { describe, expect, it } from 'vitest';
import { decodeSchemaFromUrl, encodeSchemaForUrl } from './schema-share.js';

describe('schema-share', () => {
    it('encodes and decodes schema content', () => {
        const schema = `model User {
  id String @id @default(cuid())
  email String @unique
}`;
        const encoded = encodeSchemaForUrl(schema);
        const decoded = decodeSchemaFromUrl(encoded);
        expect(decoded).toBe(schema);
    });

    it('returns null for invalid input', () => {
        expect(decodeSchemaFromUrl('%%%%')).toBeNull();
    });
});
