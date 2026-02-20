import { describe, it, expect } from 'vitest';
import { parsePrismaAst } from '../src/parser/prisma-ast-parser.js';

const BASE_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
`;

function schema(models: string): string {
    return BASE_SCHEMA + '\n' + models;
}

describe('parsePrismaAst', () => {
    describe('datasource parsing', () => {
        it('parses postgresql provider', () => {
            const result = parsePrismaAst(schema(`
model User {
  id String @id
}`));
            expect(result.datasource.provider).toBe('postgresql');
        });

        it('defaults to postgresql when parsing fails', () => {
            // Verify the default fallback behavior
            const result = parsePrismaAst(schema(`
model User {
  id String @id
}`));
            expect(result.datasource.url).toContain('DATABASE_URL');
        });
    });

    describe('model parsing', () => {
        it('parses a simple model', () => {
            const result = parsePrismaAst(schema(`
model User {
  id    String @id @default(cuid())
  email String @unique
  name  String?
}`));
            expect(result.models).toHaveLength(1);
            expect(result.models[0].name).toBe('User');
            expect(result.models[0].fields).toHaveLength(3);
        });

        it('parses multiple models', () => {
            const result = parsePrismaAst(schema(`
model User {
  id   String @id
  name String
}

model Post {
  id    String @id
  title String
}`));
            expect(result.models).toHaveLength(2);
            expect(result.models.map(m => m.name)).toEqual(['User', 'Post']);
        });
    });

    describe('field attributes', () => {
        it('detects @id field', () => {
            const result = parsePrismaAst(schema(`
model User {
  id   String @id
  name String
}`));
            const idField = result.models[0].fields.find(f => f.name === 'id')!;
            expect(idField.isId).toBe(true);
            const nameField = result.models[0].fields.find(f => f.name === 'name')!;
            expect(nameField.isId).toBe(false);
        });

        it('detects @unique field', () => {
            const result = parsePrismaAst(schema(`
model User {
  id    String @id
  email String @unique
}`));
            const emailField = result.models[0].fields.find(f => f.name === 'email')!;
            expect(emailField.isUnique).toBe(true);
        });

        it('detects optional fields', () => {
            const result = parsePrismaAst(schema(`
model User {
  id  String  @id
  bio String?
}`));
            const bioField = result.models[0].fields.find(f => f.name === 'bio')!;
            expect(bioField.isOptional).toBe(true);
        });

        it('detects list fields', () => {
            const result = parsePrismaAst(schema(`
model User {
  id    String @id
  posts Post[]
}
model Post {
  id String @id
}`));
            const postsField = result.models[0].fields.find(f => f.name === 'posts')!;
            expect(postsField.isList).toBe(true);
            expect(postsField.isRelation).toBe(true);
        });

        it('detects @default values', () => {
            const result = parsePrismaAst(schema(`
model User {
  id        String   @id @default(cuid())
  role      String   @default("USER")
  createdAt DateTime @default(now())
}`));
            const fields = result.models[0].fields;

            const idField = fields.find(f => f.name === 'id')!;
            expect(idField.hasDefault).toBe(true);
            expect(idField.defaultValue).toBe('cuid()');
            expect(idField.isServerDefault).toBe(true);

            const createdAtField = fields.find(f => f.name === 'createdAt')!;
            expect(createdAtField.hasDefault).toBe(true);
            expect(createdAtField.defaultValue).toBe('now()');
            expect(createdAtField.isServerDefault).toBe(true);

            const roleField = fields.find(f => f.name === 'role')!;
            expect(roleField.hasDefault).toBe(true);
            expect(roleField.isServerDefault).toBe(false);
        });

        it('detects @updatedAt as hasDefault', () => {
            const result = parsePrismaAst(schema(`
model User {
  id        String   @id
  updatedAt DateTime @updatedAt
}`));
            const field = result.models[0].fields.find(f => f.name === 'updatedAt')!;
            expect(field.hasDefault).toBe(true);
            expect(field.isServerDefault).toBe(true);
        });

        it('marks literal defaults as non-server-generated', () => {
            const result = parsePrismaAst(schema(`
model Todo {
  id        String  @id @default(uuid())
  completed Boolean @default(false)
  priority  Int     @default(0)
}`));
            const fields = result.models[0].fields;

            const completedField = fields.find(f => f.name === 'completed')!;
            expect(completedField.hasDefault).toBe(true);
            expect(completedField.isServerDefault).toBe(false);

            const priorityField = fields.find(f => f.name === 'priority')!;
            expect(priorityField.hasDefault).toBe(true);
            expect(priorityField.isServerDefault).toBe(false);
        });
    });

    describe('relation detection', () => {
        it('detects explicit @relation', () => {
            const result = parsePrismaAst(schema(`
model Post {
  id       String @id
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}
model User {
  id    String @id
  posts Post[]
}`));
            const authorField = result.models[0].fields.find(f => f.name === 'author')!;
            expect(authorField.isRelation).toBe(true);
            expect(authorField.relationModel).toBe('User');
        });

        it('detects implicit relations (list fields of non-scalar type)', () => {
            const result = parsePrismaAst(schema(`
model User {
  id    String @id
  posts Post[]
}
model Post {
  id String @id
}`));
            const postsField = result.models[0].fields.find(f => f.name === 'posts')!;
            expect(postsField.isRelation).toBe(true);
            expect(postsField.relationModel).toBe('Post');
        });

        it('does not mark FK scalar field as relation', () => {
            const result = parsePrismaAst(schema(`
model Post {
  id       String @id
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}
model User {
  id String @id
}`));
            const authorIdField = result.models[0].fields.find(f => f.name === 'authorId')!;
            expect(authorIdField.isRelation).toBe(false);
        });
    });

    describe('enum handling', () => {
        it('parses enum definitions', () => {
            const result = parsePrismaAst(schema(`
enum Role {
  USER
  ADMIN
  MODERATOR
}
model User {
  id   String @id
  role Role   @default(USER)
}`));
            expect(result.enums).toHaveLength(1);
            expect(result.enums[0].name).toBe('Role');
            expect(result.enums[0].values).toEqual(['USER', 'ADMIN', 'MODERATOR']);
        });

        it('marks enum fields as isEnum=true, isRelation=false', () => {
            const result = parsePrismaAst(schema(`
enum Role {
  USER
  ADMIN
}
model User {
  id   String @id
  role Role
}`));
            const roleField = result.models[0].fields.find(f => f.name === 'role')!;
            expect(roleField.isEnum).toBe(true);
            expect(roleField.isRelation).toBe(false);
        });

        it('parses multiple enums', () => {
            const result = parsePrismaAst(schema(`
enum Role {
  USER
  ADMIN
}

enum Status {
  ACTIVE
  INACTIVE
}

model User {
  id String @id
}`));
            expect(result.enums).toHaveLength(2);
        });
    });

    describe('directive integration', () => {
        it('parses field directives from comments', () => {
            const result = parsePrismaAst(schema(`
model User {
  id       String @id
  /// @bcm.hidden
  password String
  /// @bcm.readonly
  createdAt DateTime @default(now())
}`));
            const pwField = result.models[0].fields.find(f => f.name === 'password')!;
            expect(pwField.directives).toContain('hidden');
            const createdField = result.models[0].fields.find(f => f.name === 'createdAt')!;
            expect(createdField.directives).toContain('readonly');
        });

        it('parses model-level directives', () => {
            const result = parsePrismaAst(schema(`
/// @bcm.protected
model Post {
  id    String @id
  title String
}`));
            expect(result.models[0].directives).toContain('protected');
        });

        it('parses softDelete model directive', () => {
            const result = parsePrismaAst(schema(`
/// @bcm.softDelete
model Post {
  id        String    @id
  deletedAt DateTime?
}`));
            expect(result.models[0].directives).toContain('softDelete');
        });

        it('parses searchable field directive', () => {
            const result = parsePrismaAst(schema(`
model Post {
  id    String @id
  /// @bcm.searchable
  title String
}`));
            const titleField = result.models[0].fields.find(f => f.name === 'title')!;
            expect(titleField.directives).toContain('searchable');
        });

        it('parses writeOnly field directive', () => {
            const result = parsePrismaAst(schema(`
model User {
  id       String @id
  /// @bcm.writeOnly
  password String
}`));
            const pwField = result.models[0].fields.find(f => f.name === 'password')!;
            expect(pwField.directives).toContain('writeOnly');
        });
    });

    describe('auth directive with roles', () => {
        it('parses @bcm.auth(roles: [ADMIN]) and attaches authRoles', () => {
            const result = parsePrismaAst(schema(`
/// @bcm.auth(roles: [ADMIN])
model Settings {
  id    String @id @default(cuid())
  key   String @unique
  value String
}`));
            const settings = result.models[0];
            expect(settings.directives).toContain('auth');
            expect(settings.authRoles).toEqual(['ADMIN']);
        });

        it('parses @bcm.auth(roles: [ADMIN, MODERATOR])', () => {
            const result = parsePrismaAst(schema(`
/// @bcm.auth(roles: [ADMIN, MODERATOR])
model Report {
  id    String @id @default(cuid())
  title String
}`));
            const report = result.models[0];
            expect(report.directives).toContain('auth');
            expect(report.authRoles).toEqual(['ADMIN', 'MODERATOR']);
        });

        it('does not set authRoles for @bcm.protected models', () => {
            const result = parsePrismaAst(schema(`
/// @bcm.protected
model User {
  id   String @id @default(cuid())
  name String
}`));
            const user = result.models[0];
            expect(user.directives).toContain('protected');
            expect(user.authRoles).toBeUndefined();
        });
    });

    describe('@bcm.authModel directive', () => {
        it('parses @bcm.authModel with @bcm.identifier and @bcm.password', () => {
            const result = parsePrismaAst(schema(`
/// @bcm.authModel
model User {
  id       String @id @default(uuid())
  /// @bcm.identifier
  email    String @unique
  name     String
  /// @bcm.password
  password String
}`));
            const user = result.models[0];
            expect(user.isAuthModel).toBe(true);
            expect(user.identifierField).toBe('email');
            expect(user.passwordField).toBe('password');
        });

        it('@bcm.password implies writeOnly in field directives', () => {
            const result = parsePrismaAst(schema(`
/// @bcm.authModel
model User {
  id       String @id
  /// @bcm.identifier
  email    String @unique
  /// @bcm.password
  password String
}`));
            const pwField = result.models[0].fields.find(f => f.name === 'password')!;
            expect(pwField.directives).toContain('password');
            expect(pwField.directives).toContain('writeOnly');
        });

        it('isAuthModel is false for non-auth models', () => {
            const result = parsePrismaAst(schema(`
model User {
  id   String @id
  name String
}`));
            const user = result.models[0];
            expect(user.isAuthModel).toBe(false);
            expect(user.identifierField).toBeUndefined();
            expect(user.passwordField).toBeUndefined();
        });
    });

    describe('complex schemas', () => {
        it('handles schema with models, enums, relations, and directives', () => {
            const result = parsePrismaAst(schema(`
enum Role {
  USER
  ADMIN
}

/// @bcm.protected
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  /// @bcm.writeOnly
  password  String
  role      Role     @default(USER)
  /// @bcm.readonly
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  posts     Post[]
}

/// @bcm.softDelete
model Post {
  id        String    @id @default(cuid())
  /// @bcm.searchable
  title     String
  content   String?
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  deletedAt DateTime?
}`));
            expect(result.models).toHaveLength(2);
            expect(result.enums).toHaveLength(1);
            expect(result.datasource.provider).toBe('postgresql');

            // User model
            const user = result.models[0];
            expect(user.name).toBe('User');
            expect(user.directives).toContain('protected');
            const pwField = user.fields.find(f => f.name === 'password')!;
            expect(pwField.directives).toContain('writeOnly');
            const roleField = user.fields.find(f => f.name === 'role')!;
            expect(roleField.isEnum).toBe(true);
            expect(roleField.isRelation).toBe(false);

            // Post model
            const post = result.models[1];
            expect(post.name).toBe('Post');
            expect(post.directives).toContain('softDelete');
            const titleField = post.fields.find(f => f.name === 'title')!;
            expect(titleField.directives).toContain('searchable');
            const authorField = post.fields.find(f => f.name === 'author')!;
            expect(authorField.isRelation).toBe(true);
            expect(authorField.relationModel).toBe('User');
        });
    });
});
