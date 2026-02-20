import { describe, it, expect } from 'vitest';
import { generateProject } from '../src/generator/index.js';
import { parsePrismaAst } from '../src/parser/prisma-ast-parser.js';
import type { GenerateOptions, ParsedSchema } from '../src/parser/types.js';

const BLOG_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

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
  name      String?
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
}
`;

const defaultOptions: GenerateOptions = {
    schema: 'test.prisma',
    output: '/tmp/test-output',
    dryRun: false,
    force: true,
};

function getParsedSchema(): ParsedSchema {
    return parsePrismaAst(BLOG_SCHEMA);
}

describe('generateProject', () => {
    describe('full generation (no --only)', () => {
        it('generates files for all 8 generators', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, defaultOptions, BLOG_SCHEMA);

            // Should generate module files, config, middleware, utils, app, infra, prisma, swagger
            expect(files.length).toBeGreaterThan(20);

            const paths = files.map(f => f.path);

            // Module files (5 per model × 2 models = 10)
            expect(paths.some(p => p.includes('modules/user/'))).toBe(true);
            expect(paths.some(p => p.includes('modules/post/'))).toBe(true);

            // Config files
            expect(paths).toContain('src/config/database.ts');
            expect(paths).toContain('src/config/env.ts');

            // Middleware
            expect(paths).toContain('src/middlewares/error.middleware.ts');
            expect(paths).toContain('src/middlewares/auth.middleware.ts');

            // Utils
            expect(paths).toContain('src/utils/query-builder.ts');
            expect(paths).toContain('src/utils/response.ts');

            // App
            expect(paths).toContain('src/app.ts');
            expect(paths).toContain('src/server.ts');

            // Infra
            expect(paths).toContain('Dockerfile');
            expect(paths).toContain('docker-compose.yml');
            expect(paths).toContain('package.json');

            // Prisma
            expect(paths.some(p => p.includes('prisma/'))).toBe(true);

            // Swagger
            expect(paths).toContain('openapi.json');
        });

        it('generates 5 files per model (controller, service, routes, dto, test)', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, defaultOptions, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            for (const model of ['user', 'post']) {
                expect(paths).toContain(`src/modules/${model}/${model}.controller.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.service.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.routes.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.dto.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.test.ts`);
            }
        });
    });

    describe('--only flag', () => {
        it('generates only route module files when --only routes', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            // Should have module files
            expect(paths.some(p => p.includes('modules/'))).toBe(true);

            // Should NOT have config, infra, swagger, etc.
            expect(paths.some(p => p.includes('config/'))).toBe(false);
            expect(paths).not.toContain('Dockerfile');
            expect(paths).not.toContain('openapi.json');
        });

        it('generates only swagger when --only swagger', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, BLOG_SCHEMA);

            expect(files).toHaveLength(1);
            expect(files[0].path).toBe('openapi.json');
        });

        it('generates only config files when --only config', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'config' }, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            expect(paths.every(p => p.includes('config/'))).toBe(true);
        });

        it('generates only middleware files when --only middleware', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'middleware' }, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            expect(paths.every(p => p.includes('middlewares/'))).toBe(true);
        });

        it('throws for invalid --only value', async () => {
            const schema = getParsedSchema();
            await expect(
                generateProject(schema, { ...defaultOptions, only: 'invalid' }, BLOG_SCHEMA)
            ).rejects.toThrow('Unknown --only value');
        });
    });

    describe('generated file content', () => {
        it('generates valid JSON for openapi.json', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, BLOG_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            expect(openapi.openapi).toBe('3.0.3');
            expect(openapi.paths).toBeDefined();
            expect(openapi.components?.schemas).toBeDefined();
        });

        it('openapi.json includes per-model endpoints', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, BLOG_SCHEMA);
            const openapi = JSON.parse(files[0].content);
            const paths = Object.keys(openapi.paths);

            expect(paths).toContain('/api/users');
            expect(paths).toContain('/api/users/{id}');
            expect(paths).toContain('/api/posts');
            expect(paths).toContain('/api/posts/{id}');
            expect(paths).toContain('/health');
        });

        it('openapi.json includes enum schemas', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, BLOG_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            expect(openapi.components.schemas.Role).toBeDefined();
            expect(openapi.components.schemas.Role.enum).toEqual(['USER', 'ADMIN']);
        });

        it('dto.ts includes writeOnly field in create schema but not response', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const dtoFile = files.find(f => f.path.includes('user.dto.ts'))!;

            expect(dtoFile.content).toContain('password');  // In create schema
            // The response schema should not include writeOnly fields
            // Look for the ResponseSchema section
            const responseSection = dtoFile.content.split('ResponseSchema')[1];
            expect(responseSection).not.toContain('password');
        });

        it('routes.ts imports authenticate middleware for protected models', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const userRoutes = files.find(f => f.path.includes('user.routes.ts'))!;

            expect(userRoutes.content).toContain('authenticate');
        });

        it('routes.ts does not import authenticate for non-protected models', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postRoutes = files.find(f => f.path.includes('post.routes.ts'))!;

            // Post has @bcm.softDelete but NOT @bcm.protected
            expect(postRoutes.content).not.toContain('authenticate');
        });

        it('service.ts includes soft delete logic for softDelete models', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postService = files.find(f => f.path.includes('post.service.ts'))!;

            expect(postService.content).toContain('deletedAt');
        });

        it('controller.ts includes ALLOWED_FILTER_FIELDS', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const controller = files.find(f => f.path.includes('user.controller.ts'))!;

            expect(controller.content).toContain('ALLOWED_FILTER_FIELDS');
        });

        it('controller.ts includes SEARCHABLE_FIELDS for models with searchable directives', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const controller = files.find(f => f.path.includes('post.controller.ts'))!;

            expect(controller.content).toContain('SEARCHABLE_FIELDS');
            expect(controller.content).toContain("'title'");
        });

        it('package.json includes correct dependencies', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, BLOG_SCHEMA);
            const pkgFile = files.find(f => f.path === 'package.json')!;
            const pkg = JSON.parse(pkgFile.content);

            expect(pkg.dependencies).toHaveProperty('@prisma/client');
            expect(pkg.dependencies).toHaveProperty('express');
            expect(pkg.dependencies).toHaveProperty('zod');
            expect(pkg.dependencies).toHaveProperty('pino');
            expect(pkg.dependencies).toHaveProperty('compression');
            expect(pkg.devDependencies).toHaveProperty('@faker-js/faker');
        });

        it('app.ts imports all model routes', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, BLOG_SCHEMA);
            const appFile = files.find(f => f.path === 'src/app.ts')!;

            expect(appFile.content).toContain('userRoutes');
            expect(appFile.content).toContain('postRoutes');
            expect(appFile.content).toContain('/api/users');
            expect(appFile.content).toContain('/api/posts');
        });

        it('app.ts uses named import for pinoHttp', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, BLOG_SCHEMA);
            const appFile = files.find(f => f.path === 'src/app.ts')!;

            expect(appFile.content).toContain("import { pinoHttp } from 'pino-http'");
        });

        it('logger.ts uses named import for pino', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'config' }, BLOG_SCHEMA);
            const loggerFile = files.find(f => f.path === 'src/config/logger.ts')!;

            expect(loggerFile.content).toContain("import { pino } from 'pino'");
        });

        it('error middleware extracts field info from Prisma error meta', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'middleware' }, BLOG_SCHEMA);
            const errorMw = files.find(f => f.path.includes('error.middleware.ts'))!;

            expect(errorMw.content).toContain('err.meta');
            expect(errorMw.content).toContain('field_name');
            expect(errorMw.content).toContain("Field: '${fieldName}'");
        });

        it('auth middleware includes authorize function', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'middleware' }, BLOG_SCHEMA);
            const authMw = files.find(f => f.path.includes('auth.middleware.ts'))!;

            expect(authMw.content).toContain('export function authorize');
            expect(authMw.content).toContain('allowedRoles');
            expect(authMw.content).toContain('403');
        });
    });

    describe('@bcm.auth(roles: [...]) RBAC', () => {
        const AUTH_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.auth(roles: [ADMIN])
model Settings {
  id    String @id @default(cuid())
  key   String @unique
  value String
}

/// @bcm.auth(roles: [ADMIN, MODERATOR])
model Report {
  id    String @id @default(cuid())
  title String
}

model Post {
  id    String @id @default(cuid())
  title String
}
`;

        function getAuthSchema() {
            return parsePrismaAst(AUTH_SCHEMA);
        }

        it('routes.ts imports authorize for @bcm.auth models', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, AUTH_SCHEMA);
            const settingsRoutes = files.find(f => f.path.includes('settings.routes.ts'))!;

            expect(settingsRoutes.content).toContain('authorize');
            expect(settingsRoutes.content).toContain("'ADMIN'");
        });

        it('routes.ts imports authorize with multiple roles', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, AUTH_SCHEMA);
            const reportRoutes = files.find(f => f.path.includes('report.routes.ts'))!;

            expect(reportRoutes.content).toContain('authorize');
            expect(reportRoutes.content).toContain("'ADMIN'");
            expect(reportRoutes.content).toContain("'MODERATOR'");
        });

        it('routes.ts does not import authorize for non-auth models', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, AUTH_SCHEMA);
            const postRoutes = files.find(f => f.path.includes('post.routes.ts'))!;

            expect(postRoutes.content).not.toContain('authorize');
            expect(postRoutes.content).not.toContain('authenticate');
        });

        it('openapi.json includes 401 and 403 responses for auth models', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, AUTH_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            const settingsPost = openapi.paths['/api/settings'].post;
            expect(settingsPost.responses['401']).toBeDefined();
            expect(settingsPost.responses['403']).toBeDefined();
            expect(settingsPost.security).toBeDefined();
        });

        it('openapi.json does not include 401/403 for non-auth models', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, AUTH_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            const postsPost = openapi.paths['/api/posts'].post;
            expect(postsPost.responses['401']).toBeUndefined();
            expect(postsPost.responses['403']).toBeUndefined();
        });

        it('openapi.json includes securitySchemes', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, AUTH_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            expect(openapi.components.securitySchemes).toBeDefined();
            expect(openapi.components.securitySchemes.bearerAuth.type).toBe('http');
            expect(openapi.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
        });
    });

    describe('multiple database providers', () => {
        function makeSchema(provider: string) {
            return `
datasource db {
  provider = "${provider}"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Item {
  id    String @id @default(cuid())
  name  String
}
`;
        }

        it('generates PostgreSQL docker-compose by default', async () => {
            const raw = makeSchema('postgresql');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dc = files.find(f => f.path === 'docker-compose.yml')!;

            expect(dc.content).toContain('postgres:16-alpine');
            expect(dc.content).toContain('POSTGRES_DB');
        });

        it('generates MySQL docker-compose for mysql provider', async () => {
            const raw = makeSchema('mysql');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dc = files.find(f => f.path === 'docker-compose.yml')!;

            expect(dc.content).toContain('mysql:8');
            expect(dc.content).toContain('MYSQL_DATABASE');
            expect(dc.content).not.toContain('postgres');
        });

        it('generates SQLite docker-compose without db service', async () => {
            const raw = makeSchema('sqlite');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dc = files.find(f => f.path === 'docker-compose.yml')!;

            expect(dc.content).toContain('file:./data/');
            expect(dc.content).not.toContain('postgres');
            expect(dc.content).not.toContain('mysql');
            // No db service for sqlite
            expect(dc.content).not.toContain('image:');
        });

        it('generates MongoDB docker-compose for mongodb provider', async () => {
            const raw = makeSchema('mongodb');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dc = files.find(f => f.path === 'docker-compose.yml')!;

            expect(dc.content).toContain('mongo:7');
            expect(dc.content).toContain('MONGO_INITDB_ROOT_USERNAME');
        });

        it('generates provider-aware .env.example', async () => {
            const raw = makeSchema('mysql');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const env = files.find(f => f.path === '.env.example')!;

            expect(env.content).toContain('mysql://');
            expect(env.content).toContain('MySQL');
        });

        it('generates provider-aware CI workflow', async () => {
            const raw = makeSchema('sqlite');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const ci = files.find(f => f.path === '.github/workflows/ci.yml')!;

            expect(ci.content).toContain('file:./test.db');
            expect(ci.content).not.toContain('postgres');
        });

        it('MongoDB CI uses db push instead of migrate', async () => {
            const raw = makeSchema('mongodb');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const ci = files.find(f => f.path === '.github/workflows/ci.yml')!;

            expect(ci.content).toContain('prisma db push');
            expect(ci.content).not.toContain('prisma migrate');
        });
    });

    describe('@bcm.nested relation handling', () => {
        const NESTED_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    String @id @default(cuid())
  email String @unique
  name  String?
  posts Post[]
}

model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
  /// @bcm.nested
  author   User   @relation(fields: [authorId], references: [id])
}
`;

        function getNestedSchema() {
            return parsePrismaAst(NESTED_SCHEMA);
        }

        it('dto.ts includes nested input schema for @bcm.nested relations', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SCHEMA);
            const postDto = files.find(f => f.path.includes('post.dto.ts'))!;

            expect(postDto.content).toContain('Post_AuthorInput');
            expect(postDto.content).toContain('create:');
            expect(postDto.content).toContain('connect:');
            expect(postDto.content).toContain('Either create or connect must be provided');
        });

        it('dto.ts excludes FK field when nested relation covers it', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SCHEMA);
            const postDto = files.find(f => f.path.includes('post.dto.ts'))!;

            // authorId should be excluded from CreatePostSchema since author is @bcm.nested
            const createSection = postDto.content.split('CreatePostSchema')[1].split('});')[0];
            expect(createSection).not.toContain('authorId');
            expect(createSection).toContain('author');
        });

        it('service.ts auto-includes nested relations in create', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SCHEMA);
            const postService = files.find(f => f.path.includes('post.service.ts'))!;

            expect(postService.content).toContain('include:');
            expect(postService.content).toContain('author: true');
        });

        it('user dto.ts does not include nested input (no @bcm.nested on User)', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SCHEMA);
            const userDto = files.find(f => f.path.includes('user.dto.ts'))!;

            expect(userDto.content).not.toContain('_Input');
            expect(userDto.content).not.toContain('connect');
        });

        it('openapi.json includes nested input schema', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, NESTED_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            expect(openapi.components.schemas['Post_AuthorInput']).toBeDefined();
            expect(openapi.components.schemas['Post_AuthorInput'].properties.create).toBeDefined();
            expect(openapi.components.schemas['Post_AuthorInput'].properties.connect).toBeDefined();
        });
    });
});
