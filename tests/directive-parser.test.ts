import { describe, it, expect } from 'vitest';
import { parseDirectives, getFieldDirectives } from '../src/parser/directive-parser.js';

describe('parseDirectives', () => {
    it('parses field-level directives', () => {
        const schema = `
model User {
  id    String @id
  /// @bcm.hidden
  secret String
  /// @bcm.readonly
  createdAt DateTime
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user).toBeDefined();
        expect(user.fields.get('secret')).toEqual(['hidden']);
        expect(user.fields.get('createdAt')).toEqual(['readonly']);
    });

    it('parses model-level directives before model keyword', () => {
        const schema = `
/// @bcm.protected
model Post {
  id String @id
}`;
        const result = parseDirectives(schema);
        const post = result.get('Post')!;
        expect(post.modelDirectives).toEqual(['protected']);
    });

    it('parses multiple model-level directives', () => {
        const schema = `
/// @bcm.protected
/// @bcm.softDelete
model Post {
  id String @id
}`;
        const result = parseDirectives(schema);
        const post = result.get('Post')!;
        expect(post.modelDirectives).toContain('protected');
        expect(post.modelDirectives).toContain('softDelete');
    });

    it('warns when model directive is placed inside model block', () => {
        const schema = `
model Post {
  id String @id
  /// @bcm.protected
  /// @bcm.hidden
  title String
}`;
        const result = parseDirectives(schema);
        const post = result.get('Post')!;
        expect(post.warnings.some(w => w.includes('model-level directive'))).toBe(true);
    });

    it('warns when field directive is placed outside model block', () => {
        const schema = `
/// @bcm.hidden
model User {
  id String @id
}`;
        // @bcm.hidden is a field directive outside a model block — should warn
        // BUT since it's before a model block, it goes to pendingWarnings
        // and those warnings get attached to the model
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        // The warning about field directive outside model block
        expect(user.warnings.some(w => w.includes('field directive') && w.includes('outside'))).toBe(true);
    });

    it('keeps warning for trailing out-of-model field directive at EOF', () => {
        const schema = `
model User {
  id String @id
}
/// @bcm.hidden
`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('@bcm.hidden') && w.includes('outside'))).toBe(true);
    });

    it('warns about unknown directives', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.unknownDirective
  /// @bcm.hidden
  name String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('Unknown directive'))).toBe(true);
    });

    it('warns about unknown directives inside model blocks even without paired field directives', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.unknownDirective
  name String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('Unknown directive'))).toBe(true);
    });

    it('warns about misplaced model directives inside model blocks even without paired field directives', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.protected
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('model-level directive'))).toBe(true);
    });

    it('detects conflicting directives: hidden + writeOnly', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.hidden
  /// @bcm.writeOnly
  password String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('conflicting'))).toBe(true);
    });

    it('detects conflicting directives: hidden + readonly', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.hidden
  /// @bcm.readonly
  field String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('conflicting'))).toBe(true);
    });

    it('detects conflicting directives: readonly + writeOnly', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.readonly
  /// @bcm.writeOnly
  field String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('conflicting'))).toBe(true);
    });

    it('supports multiple field directives without conflict', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.writeOnly
  /// @bcm.searchable
  password String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.fields.get('password')).toEqual(['writeOnly', 'searchable']);
        expect(user.warnings.length).toBe(0);
    });

    it('warns about directives at end of model block without a field', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.hidden
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('without a following field'))).toBe(true);
    });

    it('handles multiple models', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.hidden
  secret String
}

/// @bcm.protected
model Post {
  id String @id
  /// @bcm.readonly
  viewCount Int
}`;
        const result = parseDirectives(schema);
        expect(result.size).toBe(2);
        expect(result.get('User')!.fields.get('secret')).toEqual(['hidden']);
        expect(result.get('Post')!.modelDirectives).toContain('protected');
        expect(result.get('Post')!.fields.get('viewCount')).toEqual(['readonly']);
    });

    it('returns empty map for schema with no directives', () => {
        const schema = `
model User {
  id String @id
  name String
}`;
        const result = parseDirectives(schema);
        // Model exists but no directives
        const user = result.get('User')!;
        expect(user.fields.size).toBe(0);
        expect(user.modelDirectives.length).toBe(0);
    });

    it('ignores regular comments', () => {
        const schema = `
model User {
  id String @id
  // This is a regular comment
  name String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.fields.size).toBe(0);
    });
});

describe('auth directive with roles', () => {
    it('parses @bcm.auth(roles: [ADMIN])', () => {
        const schema = `
/// @bcm.auth(roles: [ADMIN])
model Settings {
  id String @id
}`;
        const result = parseDirectives(schema);
        const settings = result.get('Settings')!;
        expect(settings.modelDirectives).toContain('auth');
        expect(settings.authRoles).toEqual(['ADMIN']);
    });

    it('parses @bcm.auth(roles: [ADMIN, MODERATOR])', () => {
        const schema = `
/// @bcm.auth(roles: [ADMIN, MODERATOR])
model Report {
  id String @id
}`;
        const result = parseDirectives(schema);
        const report = result.get('Report')!;
        expect(report.modelDirectives).toContain('auth');
        expect(report.authRoles).toEqual(['ADMIN', 'MODERATOR']);
    });

    it('parses @bcm.auth without roles argument', () => {
        const schema = `
/// @bcm.auth
model Post {
  id String @id
}`;
        const result = parseDirectives(schema);
        const post = result.get('Post')!;
        expect(post.modelDirectives).toContain('auth');
        expect(post.authRoles).toBeUndefined();
    });
});

describe('authModel directive', () => {
    it('parses @bcm.authModel as a model directive', () => {
        const schema = `
/// @bcm.authModel
model User {
  id String @id
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.modelDirectives).toContain('authModel');
    });

    it('parses @bcm.identifier as a field directive', () => {
        const schema = `
/// @bcm.authModel
model User {
  id    String @id
  /// @bcm.identifier
  email String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.fields.get('email')).toEqual(['identifier']);
    });

    it('parses @bcm.password as a field directive', () => {
        const schema = `
model User {
  id       String @id
  /// @bcm.password
  password String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.fields.get('password')).toEqual(['password']);
    });

    it('detects conflict between @bcm.password and @bcm.writeOnly', () => {
        const schema = `
model User {
  id       String @id
  /// @bcm.password
  /// @bcm.writeOnly
  password String
}`;
        const result = parseDirectives(schema);
        const user = result.get('User')!;
        expect(user.warnings.some(w => w.includes('conflicting'))).toBe(true);
    });
});

describe('nested directive', () => {
    it('parses @bcm.nested on a relation field', () => {
        const schema = `
model Post {
  id       String @id
  authorId String
  /// @bcm.nested
  author   String
}`;
        const result = parseDirectives(schema);
        const post = result.get('Post')!;
        expect(post.fields.get('author')).toEqual(['nested']);
    });
});

describe('getFieldDirectives', () => {
    it('returns directives for existing field', () => {
        const schema = `
model User {
  id String @id
  /// @bcm.hidden
  secret String
}`;
        const map = parseDirectives(schema);
        expect(getFieldDirectives(map, 'User', 'secret')).toEqual(['hidden']);
    });

    it('returns empty array for field without directives', () => {
        const schema = `
model User {
  id String @id
  name String
}`;
        const map = parseDirectives(schema);
        expect(getFieldDirectives(map, 'User', 'name')).toEqual([]);
    });

    it('returns empty array for non-existent model', () => {
        const map = new Map();
        expect(getFieldDirectives(map, 'NonExistent', 'field')).toEqual([]);
    });
});
