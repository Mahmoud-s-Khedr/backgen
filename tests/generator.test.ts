import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateProject } from '../src/generator/index.js';
import { parsePrismaAst } from '../src/parser/prisma-ast-parser.js';
import type { GenerateOptions, ParsedSchema } from '../src/parser/types.js';
import { writeFiles } from '../src/generator/file-writer.js';
import { createTempWorkspace } from './helpers/test-fs.js';

const execFileAsync = promisify(execFile);

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

const COMPOSITE_KEYS_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Favorite {
  userId    String
  listingId String
  createdAt DateTime @default(now())

  @@id([userId, listingId])
}

model Membership {
  orgId  String
  userId String
  scope  String

  @@unique([orgId, scope])
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

function readFixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('generateProject', () => {
    describe('full generation (no --only)', () => {
        it('generates files for all 8 generators', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, defaultOptions, BLOG_SCHEMA);

            // Should generate module files, config, middleware, utils, app, infra, prisma, swagger
            expect(files.length).toBeGreaterThan(20);

            const paths = files.map(f => f.path);

            // Module files (7 per model × 2 models = 14)
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
            expect(paths).toContain('docker-entrypoint.sh');
            expect(paths).toContain('docker-compose.yml');
            expect(paths).toContain('.dockerignore');
            expect(paths).toContain('package.json');

            // Prisma
            expect(paths.some(p => p.includes('prisma/'))).toBe(true);

            // Swagger
            expect(paths).toContain('openapi.json');

            // API Client
            expect(paths).toContain('postman-collection.json');
        });

        it('generates 7 files per model (repository, controller, service, routes, dto, test, repository.test)', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, defaultOptions, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            for (const model of ['user', 'post']) {
                expect(paths).toContain(`src/modules/${model}/${model}.repository.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.controller.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.service.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.routes.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.dto.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.test.ts`);
                expect(paths).toContain(`src/modules/${model}/${model}.repository.test.ts`);
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

        it('generates only api-client when --only api-client', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'api-client' }, BLOG_SCHEMA);

            expect(files).toHaveLength(1);
            expect(files[0].path).toBe('postman-collection.json');

            const collection = JSON.parse(files[0].content);
            expect(collection.info.name).toBe('Generated API');
            expect(collection.info.schema).toContain('v2.1.0');
            expect(collection.variable).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: 'baseUrl' }),
                    expect.objectContaining({ key: 'authToken' }),
                ])
            );
            // Should have one folder per model (User, Post)
            expect(collection.item.length).toBeGreaterThanOrEqual(2);

            // Each model folder should have at least List + Create
            for (const folder of collection.item) {
                expect(folder.item.length).toBeGreaterThanOrEqual(2);
            }
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

    describe('--jobs flag', () => {
        it('generates job files when --jobs bullmq is set', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, jobs: 'bullmq' }, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            expect(paths).toContain('src/jobs/queue.ts');
            expect(paths).toContain('src/jobs/worker.ts');
            expect(paths).toContain('src/jobs/example.job.ts');

            // queue.ts should import from bullmq
            const queueFile = files.find(f => f.path === 'src/jobs/queue.ts')!;
            expect(queueFile.content).toContain('bullmq');

            // server.ts should start workers
            const serverFile = files.find(f => f.path === 'src/server.ts')!;
            expect(serverFile.content).toContain('startWorkers');

            // package.json should have bullmq dependency
            const pkgFile = files.find(f => f.path === 'package.json')!;
            expect(pkgFile.content).toContain('"bullmq"');

            // env config should have REDIS_URL
            const envFile = files.find(f => f.path === 'src/config/env.ts')!;
            expect(envFile.content).toContain('REDIS_URL');
        });

        it('generates job files when --jobs pg-boss is set', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, jobs: 'pg-boss' }, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            expect(paths).toContain('src/jobs/queue.ts');
            expect(paths).toContain('src/jobs/worker.ts');
            expect(paths).toContain('src/jobs/example.job.ts');

            // queue.ts should import from pg-boss
            const queueFile = files.find(f => f.path === 'src/jobs/queue.ts')!;
            expect(queueFile.content).toContain('pg-boss');

            // package.json should have pg-boss dependency
            const pkgFile = files.find(f => f.path === 'package.json')!;
            expect(pkgFile.content).toContain('"pg-boss"');
        });

        it('does not generate job files when --jobs is not set', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, defaultOptions, BLOG_SCHEMA);
            const paths = files.map(f => f.path);

            expect(paths).not.toContain('src/jobs/queue.ts');
            expect(paths).not.toContain('src/jobs/worker.ts');

            // server.ts should not reference workers
            const serverFile = files.find(f => f.path === 'src/server.ts')!;
            expect(serverFile.content).not.toContain('startWorkers');
        });

        it('generates only job files when --only jobs with --jobs bullmq', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'jobs', jobs: 'bullmq' }, BLOG_SCHEMA);

            expect(files).toHaveLength(3);
            const paths = files.map(f => f.path);
            expect(paths).toContain('src/jobs/queue.ts');
            expect(paths).toContain('src/jobs/worker.ts');
            expect(paths).toContain('src/jobs/example.job.ts');
        });
    });

    describe('--ws flag', () => {
        const WS_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.ws
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  createdAt DateTime @default(now())
}

model Tag {
  id   String @id @default(cuid())
  name String
}
`;

        function getWsSchema(): ParsedSchema {
            return parsePrismaAst(WS_SCHEMA);
        }

        it('generates ws files when --ws is set', async () => {
            const schema = getWsSchema();
            const files = await generateProject(schema, { ...defaultOptions, ws: true }, WS_SCHEMA);
            const paths = files.map(f => f.path);

            expect(paths).toContain('src/ws/ws-types.ts');
            expect(paths).toContain('src/ws/ws-server.ts');
            expect(paths).toContain('src/ws/ws-broadcast.ts');

            // server.ts should attach WebSocket server
            const serverFile = files.find(f => f.path === 'src/server.ts')!;
            expect(serverFile.content).toContain('setupWebSocketServer');

            // package.json should have ws dependency
            const pkgFile = files.find(f => f.path === 'package.json')!;
            expect(pkgFile.content).toContain('"ws"');
            expect(pkgFile.content).toContain('"@types/ws"');

            // event-bus.ts should be generated (auto-enabled by @bcm.ws)
            expect(paths).toContain('src/utils/event-bus.ts');

            // ws-broadcast.ts should reference the Post model
            const broadcastFile = files.find(f => f.path === 'src/ws/ws-broadcast.ts')!;
            expect(broadcastFile.content).toContain("'Post'");
            // Tag does NOT have @bcm.ws, so it should not appear
            expect(broadcastFile.content).not.toContain("'Tag'");
        });

        it('does not generate ws files when --ws is not set', async () => {
            const schema = getWsSchema();
            const files = await generateProject(schema, defaultOptions, WS_SCHEMA);
            const paths = files.map(f => f.path);

            expect(paths).not.toContain('src/ws/ws-types.ts');
            expect(paths).not.toContain('src/ws/ws-server.ts');
            expect(paths).not.toContain('src/ws/ws-broadcast.ts');

            // server.ts should not reference WebSocket
            const serverFile = files.find(f => f.path === 'src/server.ts')!;
            expect(serverFile.content).not.toContain('setupWebSocketServer');
        });

        it('generates only ws files when --only ws with --ws', async () => {
            const schema = getWsSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'ws', ws: true }, WS_SCHEMA);

            expect(files).toHaveLength(3);
            const paths = files.map(f => f.path);
            expect(paths).toContain('src/ws/ws-types.ts');
            expect(paths).toContain('src/ws/ws-server.ts');
            expect(paths).toContain('src/ws/ws-broadcast.ts');
        });

        it('@bcm.ws auto-enables event bus emission in service', async () => {
            const schema = getWsSchema();
            const files = await generateProject(schema, { ...defaultOptions, ws: true }, WS_SCHEMA);

            // Post has @bcm.ws — its service should emit events
            const postService = files.find(f => f.path === 'src/modules/post/post.service.ts')!;
            expect(postService.content).toContain('eventBus.emit');

            // Tag does NOT have @bcm.ws — its service should NOT emit events
            const tagService = files.find(f => f.path === 'src/modules/tag/tag.service.ts')!;
            expect(tagService.content).not.toContain('eventBus.emit');
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

            expect(paths).toContain('/api/v1/users');
            expect(paths).toContain('/api/v1/users/{id}');
            expect(paths).toContain('/api/v1/posts');
            expect(paths).toContain('/api/v1/posts/{id}');
            expect(paths).toContain('/health');
        });

        it('openapi.json uses selector-aware paths for composite keys', async () => {
            const schema = parsePrismaAst(COMPOSITE_KEYS_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, COMPOSITE_KEYS_SCHEMA);
            const openapi = JSON.parse(files[0].content);
            const paths = Object.keys(openapi.paths);

            expect(paths).toContain('/api/v1/favorites/{userId}/{listingId}');
            expect(paths).toContain('/api/v1/memberships/{orgId}/{scope}');
            expect(openapi.paths['/api/v1/favorites/{userId}/{listingId}'].get.parameters[0].name).toBe('userId');
            expect(openapi.paths['/api/v1/favorites/{userId}/{listingId}'].get.parameters[1].name).toBe('listingId');
        });

        it('openapi.json includes enum schemas', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, BLOG_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            expect(openapi.components.schemas.Role).toBeDefined();
            expect(openapi.components.schemas.Role.enum).toEqual(['USER', 'ADMIN']);
        });

        it('openapi.json wraps single-item responses in data envelope', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, BLOG_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            expect(openapi.components.schemas.UserDataResponse).toBeDefined();
            expect(openapi.components.schemas.UserDataResponse.properties.data.$ref).toBe('#/components/schemas/UserResponse');
            expect(openapi.paths['/api/v1/users/{id}'].get.responses['200'].content['application/json'].schema.$ref)
                .toBe('#/components/schemas/UserDataResponse');
            expect(openapi.paths['/api/v1/users'].post.responses['201'].content['application/json'].schema.$ref)
                .toBe('#/components/schemas/UserDataResponse');
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

        it('dto.ts includes include-aware response schema for relations', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postDto = files.find(f => f.path.includes('post.dto.ts'))!;

            expect(postDto.content).toContain('PostWithIncludesResponseSchema');
            expect(postDto.content).toContain('Post_AuthorRelationSchema');
            expect(postDto.content).toContain('author: Post_AuthorRelationSchema');
        });

        it('dto.ts keeps scalar list fields in create and response schemas', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Article {
  id    String   @id @default(cuid())
  title String
  tags  String[]
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);
            const dtoFile = files.find(f => f.path.includes('article.dto.ts'))!;

            expect(dtoFile.content).toContain('tags: z.array(z.string())');
            const responseSection = dtoFile.content.split('ResponseSchema')[1];
            expect(responseSection).toContain('tags: z.array(z.string())');
        });

        it('dto.ts emits enum schema used by include relation response fields', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postDto = files.find(f => f.path.includes('post.dto.ts'))!;

            expect(postDto.content).toContain('export const RoleSchema = z.enum');
            expect(postDto.content).toContain('role: RoleSchema');
        });

        it('dto.ts emits all enum schemas needed by multiple include relation targets', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum TeamStatus {
  ACTIVE
  INACTIVE
}

enum OfficeType {
  HQ
  BRANCH
}

model Team {
  id     String     @id @default(cuid())
  status TeamStatus
  hubs   Hub[]
}

model Office {
  id   String     @id @default(cuid())
  type OfficeType
  hubs Hub[]
}

model Hub {
  id       String @id @default(cuid())
  teamId   String
  officeId String
  team     Team   @relation(fields: [teamId], references: [id])
  office   Office @relation(fields: [officeId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);
            const hubDto = files.find(f => f.path.includes('hub.dto.ts'))!;

            expect(hubDto.content).toContain('export const TeamStatusSchema = z.enum');
            expect(hubDto.content).toContain('export const OfficeTypeSchema = z.enum');
            expect(hubDto.content).toContain('status: TeamStatusSchema');
            expect(hubDto.content).toContain('type: OfficeTypeSchema');
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

        it('repository.ts includes soft delete logic for softDelete models', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postRepo = files.find(f => f.path.includes('post.repository.ts'))!;

            expect(postRepo.content).toContain('deletedAt');
        });

        it('repository.ts uses findFirst for softDelete findOne', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postRepo = files.find(f => f.path.includes('post.repository.ts'))!;

            expect(postRepo.content).toContain('findFirst');
            expect(postRepo.content).toContain('where: { ...this.toWhereUnique(key), deletedAt: null }');
        });

        it('repository.ts guards soft-delete update/delete mutations with deletedAt null', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postRepo = files.find(f => f.path.includes('post.repository.ts'))!;

            expect(postRepo.content).toContain('updateMany({ where, data: data as any })');
            expect(postRepo.content).toContain('const where = { ...this.toWhereUnique(key), deletedAt: null };');
            expect(postRepo.content).toContain('if (updated.count === 0)');
            expect(postRepo.content).toContain('const record = await prisma.post.findFirst({ where });');
            expect(postRepo.content).toContain('const deleted = await prisma.post.updateMany({');
            expect(postRepo.content).toContain('if (deleted.count === 0)');
        });

        it('repository.ts uses findUnique for non-softDelete findOne', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const userRepo = files.find(f => f.path.includes('user.repository.ts'))!;

            expect(userRepo.content).toContain('findUnique');
            expect(userRepo.content).toContain('where: this.toWhereUnique(key)');
        });

        it('softDelete module test scaffold includes updateMany delegate and missing-record mocks', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const postTest = files.find(f => f.path.includes('post.test.ts'))!;

            expect(postTest.content).toContain('updateMany: ReturnType<typeof vi.fn>;');
            expect(postTest.content).toContain('updateMany: vi.fn(),');
            expect(postTest.content).toContain('delegate.updateMany.mockReset();');
            expect(postTest.content).toContain('modelDelegate.updateMany.mockResolvedValue({ count: 0 });');
            expect(postTest.content).not.toContain("modelDelegate.update.mockRejectedValue({ code: 'P2025' });");
        });

        it('non-softDelete module test scaffold keeps update/delete P2025 mocks', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const userTest = files.find(f => f.path.includes('user.test.ts'))!;

            expect(userTest.content).toContain("modelDelegate.update.mockRejectedValue({ code: 'P2025' });");
            expect(userTest.content).toContain("modelDelegate.delete.mockRejectedValue({ code: 'P2025' });");
            expect(userTest.content).toContain('updateMany: ReturnType<typeof vi.fn>;');
            expect(userTest.content).toContain('updateMany: vi.fn(),');
        });

        it('repository.ts normalizes include objects without @ts-ignore', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const userRepo = files.find(f => f.path.includes('user.repository.ts'))!;
            const postRepo = files.find(f => f.path.includes('post.repository.ts'))!;

            expect(userRepo.content).toContain('toInclude(include?: Record<string, boolean>)');
            expect(userRepo.content).toContain('...(include ? { include } : {}),');
            expect(userRepo.content).not.toContain('@ts-ignore');
            expect(postRepo.content).not.toContain('@ts-ignore');
        });

        it('generates composite-key routes and where selectors', async () => {
            const schema = parsePrismaAst(COMPOSITE_KEYS_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, COMPOSITE_KEYS_SCHEMA);
            const favoriteRoutes = files.find(f => f.path.includes('favorite.routes.ts'))!;
            const membershipRoutes = files.find(f => f.path.includes('membership.routes.ts'))!;

            const favoriteRepo = files.find(f => f.path.includes('favorite.repository.ts'))!;
            expect(favoriteRoutes.content).toContain("router.get('/:userId/:listingId'");
            expect(favoriteRepo.content).toContain('userId_listingId');
            expect(favoriteRepo.content).toContain('userId: key.userId');
            expect(favoriteRepo.content).toContain('listingId: key.listingId');

            // falls back to first available unique composite selector when no @id exists
            expect(membershipRoutes.content).toContain("router.get('/:orgId/:scope'");
        });

        it('skips item routes when model has no unique selector', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model EventLog {
  message String
  createdAt DateTime @default(now())
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);
            const routes = files.find(f => f.path.includes('eventLog.routes.ts'))!;
            const controller = files.find(f => f.path.includes('eventLog.controller.ts'))!;

            expect(routes.content).not.toContain("router.get('/:id'");
            expect(routes.content).not.toContain('router.put(');
            expect(controller.content).not.toContain('getOne(');
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

        it('controller.ts validates include relations and parses include-aware responses', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, BLOG_SCHEMA);
            const controller = files.find(f => f.path.includes('post.controller.ts'))!;

            expect(controller.content).toContain('ALLOWED_INCLUDE_RELATIONS');
            expect(controller.content).toContain('WithIncludesResponseSchema');
            expect(controller.content).toContain('buildQueryOptions(req.query as Record<string, any>, {');
            expect(controller.content).toContain('allowedIncludeRelations: ALLOWED_INCLUDE_RELATIONS');
            expect(controller.content).toContain('defaultSortField: DEFAULT_SORT_FIELD');
        });

        it('query-builder validates unknown include relations with 422', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'utils' }, BLOG_SCHEMA);
            const queryBuilder = files.find(f => f.path.includes('query-builder.ts'))!;

            expect(queryBuilder.content).toContain("import { ProblemDetail }");
            expect(queryBuilder.content).toContain('Unknown include relation(s)');
            expect(queryBuilder.content).toContain('status: 422');
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
            expect(pkg.dependencies).toHaveProperty('dotenv');
            expect(pkg.dependencies).toHaveProperty('bcryptjs');
            expect(pkg.devDependencies).toHaveProperty('@faker-js/faker');
            expect(pkg.pnpm.onlyBuiltDependencies).toEqual(['prisma', '@prisma/engines']);
        });

        it('package.json includes sqlite pnpm built dependencies when needed', async () => {
            const raw = `
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Todo {
  id String @id @default(uuid())
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const pkgFile = files.find(f => f.path === 'package.json')!;
            const pkg = JSON.parse(pkgFile.content);

            expect(pkg.pnpm.onlyBuiltDependencies).toEqual(['prisma', '@prisma/engines', 'better-sqlite3']);
        });

        it('env.ts auto-loads .env and throws instead of exiting on validation failure', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'config' }, BLOG_SCHEMA);
            const envFile = files.find(f => f.path === 'src/config/env.ts')!;

            expect(envFile.content).toContain("import 'dotenv/config'");
            expect(envFile.content).toContain('throw new Error(`Invalid environment variables:');
            expect(envFile.content).not.toContain('process.exit(');
        });

        it('app.ts imports all model routes', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, BLOG_SCHEMA);
            const appFile = files.find(f => f.path === 'src/app.ts')!;

            expect(appFile.content).toContain('userRoutes');
            expect(appFile.content).toContain('postRoutes');
            expect(appFile.content).toContain('/api/v1/users');
            expect(appFile.content).toContain('/api/v1/posts');
        });

        it('server.ts centralizes fatal exits in startup catch and uses dynamic imports', async () => {
            const schema = getParsedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, BLOG_SCHEMA);
            const serverFile = files.find(f => f.path === 'src/server.ts')!;

            expect(serverFile.content).toContain("const { env } = await import('./config/env.js');");
            expect(serverFile.content).toContain('await Promise.all([');
            expect(serverFile.content).toContain("main().catch(async (error) => {");
            expect(serverFile.content).toContain('process.exit(1);');
            expect(serverFile.content).not.toContain("import { env } from './config/env.js';");
            expect(serverFile.content).not.toContain("import { app } from './app.js';");
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

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
  role String @default("ADMIN")
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

            const settingsPost = openapi.paths['/api/v1/settings'].post;
            expect(settingsPost.responses['401']).toBeDefined();
            expect(settingsPost.responses['403']).toBeDefined();
            expect(settingsPost.security).toBeDefined();
        });

        it('openapi.json does not include 401/403 for non-auth models', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, AUTH_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            const postsPost = openapi.paths['/api/v1/posts'].post;
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

        it('auth route includes bcrypt password verification and role claim in JWT', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, AUTH_SCHEMA);
            const authRoutes = files.find(f => f.path === 'src/modules/auth/auth.routes.ts')!;

            expect(authRoutes.content).toContain("import bcrypt from 'bcryptjs'");
            expect(authRoutes.content).toContain('await bcrypt.compare');
            expect(authRoutes.content).toContain('role: user.role');
        });

        it('auth route normalizes ACCESS_TOKEN_TTL to jsonwebtoken expiresIn typing', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, AUTH_SCHEMA);
            const authRoutes = files.find(f => f.path === 'src/modules/auth/auth.routes.ts')!;

            expect(authRoutes.content).toContain("import type { SignOptions } from 'jsonwebtoken'");
            expect(authRoutes.content).toContain("function normalizeAccessTokenTtl(value: string): SignOptions['expiresIn'] {");
            expect(authRoutes.content).toContain("const ACCESS_TOKEN_TTL = normalizeAccessTokenTtl(env.ACCESS_TOKEN_TTL ?? '15m');");
            expect(authRoutes.content).not.toContain("{ expiresIn: env.ACCESS_TOKEN_TTL ?? '15m' }");
        });

        it('auth route uses strict identifier type and avoids duplicate id claim when identifier is id', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  /// @bcm.identifier
  id       Int    @id @default(autoincrement())
  /// @bcm.password
  password String
  role     String
}

/// @bcm.auth(roles: [ADMIN])
model Settings {
  id String @id @default(cuid())
  key String @unique
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, raw);
            const authRoutes = files.find(f => f.path === 'src/modules/auth/auth.routes.ts')!;

            expect(authRoutes.content).toContain('id: z.number().int()');
            // JWT payload uses sub (standard claim). When identifierField === 'id',
            // the identifier is not duplicated as a separate claim.
            expect(authRoutes.content).toContain('sub: String(user.id)');
            const duplicateIdClaims = authRoutes.content.match(/^\s+id:\s*user\.id\b/gm) ?? [];
            expect(duplicateIdClaims).toHaveLength(0);
        });

        it('auth model service hashes passwords on create/update', async () => {
            const schema = getAuthSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, AUTH_SCHEMA);
            const userService = files.find(f => f.path === 'src/modules/user/user.service.ts')!;

            expect(userService.content).toContain("import bcrypt from 'bcryptjs'");
            expect(userService.content).toContain('await bcrypt.hash');
            expect(userService.content).toContain('createData.password');
            expect(userService.content).toContain('updateData.password');
        });

        it('builds a generated express project for auth models', async () => {
            const workspace = await createTempWorkspace('backgen-express-auth-');
            const schema = getAuthSchema();
            const files = await generateProject(
                schema,
                {
                    schema: workspace.resolve('schema.prisma'),
                    output: workspace.root,
                    dryRun: false,
                    force: true,
                    framework: 'express',
                },
                AUTH_SCHEMA
            );

            try {
                await writeFiles(files, workspace.root, { mode: 'overwrite-targeted' });
                await fs.writeFile(workspace.resolve('.env'), [
                    'NODE_ENV=development',
                    'PORT=3000',
                    'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/backgen_test"',
                    'JWT_SECRET="change-me-to-a-long-random-string-at-least-32-chars"',
                    'ACCESS_TOKEN_TTL="15m"',
                    'REDIS_URL="redis://localhost:6379"',
                    'CORS_ORIGIN="*"',
                    'LOG_LEVEL="info"',
                    'RATE_LIMIT_MAX=100',
                ].join('\n'), 'utf8');

                await execFileAsync('npm', ['install'], {
                    cwd: workspace.root,
                    timeout: 240000,
                    maxBuffer: 1024 * 1024 * 20,
                });
                await execFileAsync('npx', ['prisma', 'generate'], {
                    cwd: workspace.root,
                    timeout: 240000,
                    maxBuffer: 1024 * 1024 * 20,
                });
                await execFileAsync('npm', ['run', 'build'], {
                    cwd: workspace.root,
                    timeout: 240000,
                    maxBuffer: 1024 * 1024 * 20,
                });
            } finally {
                await workspace.cleanup();
            }
        }, 300000);
    });

    describe('RBAC auth model validation', () => {
        it('throws when @bcm.auth is used without @bcm.authModel', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.auth(roles: [ADMIN])
model Settings {
  id String @id @default(cuid())
  key String @unique
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('RBAC requires an auth model');
        });

        it('throws when auth model is missing scalar role field', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
  posts Post[]
}

/// @bcm.auth(roles: [ADMIN])
model Settings {
  id String @id @default(cuid())
  key String @unique
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('is incomplete for RBAC');
        });

        it('throws when @bcm.identifier field is not unique', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String
  /// @bcm.password
  password String
  role String
}

/// @bcm.auth(roles: [ADMIN])
model Settings {
  id String @id @default(cuid())
  key String @unique
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('@bcm.identifier field "email" must be unique');
        });

        it('allows @bcm.identifier when it is @id', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  /// @bcm.identifier
  id String @id @default(cuid())
  /// @bcm.password
  password String
  role String
}

/// @bcm.auth(roles: [ADMIN])
model Settings {
  id String @id @default(cuid())
  key String @unique
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'app' }, raw)).resolves.toBeDefined();
        });
    });

    describe('hidden required FK validation', () => {
        it('throws when required hidden FK has no nested relation input path', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  posts Post[]
}

model Post {
  id String @id @default(cuid())
  /// @bcm.hidden
  ownerId String
  owner User @relation(fields: [ownerId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Invalid schema for API generation');
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Model "Post" relation "owner" uses hidden required FK field "ownerId"');
        });

        it('allows required hidden FK when relation uses @bcm.nested', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  posts Post[]
}

model Post {
  id String @id @default(cuid())
  /// @bcm.hidden
  ownerId String
  /// @bcm.nested
  owner User @relation(fields: [ownerId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
        });

        it('allows optional hidden FK without @bcm.nested', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  posts Post[]
}

model Post {
  id String @id @default(cuid())
  /// @bcm.hidden
  ownerId String?
  owner User? @relation(fields: [ownerId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
        });

        it('throws when composite required hidden FK has no nested relation input path', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Locale {
  code   String
  region String
  books  Book[]

  @@id([code, region], name: "localeKey")
}

model Book {
  id           String @id @default(cuid())
  /// @bcm.hidden
  localeCode   String
  /// @bcm.hidden
  localeRegion String
  locale       Locale @relation(fields: [localeCode, localeRegion], references: [code, region])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Invalid schema for API generation');
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Model "Book" relation "locale" uses hidden required FK field "localeCode"');
        });

        it('allows composite required hidden FK when relation uses @bcm.nested', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Locale {
  code   String
  region String
  books  Book[]

  @@id([code, region], name: "localeKey")
}

model Book {
  id           String @id @default(cuid())
  /// @bcm.hidden
  localeCode   String
  /// @bcm.hidden
  localeRegion String
  /// @bcm.nested
  locale       Locale @relation(fields: [localeCode, localeRegion], references: [code, region])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
        });
    });

    describe('schema validation safety guards', () => {
        it('throws when @bcm.softDelete model is missing deletedAt DateTime?', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.softDelete
model Post {
  id String @id @default(cuid())
  title String
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('uses @bcm.softDelete but is missing field "deletedAt"');
        });

        it('throws when @bcm.softDelete deletedAt field has the wrong shape', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.softDelete
model Post {
  id String @id @default(cuid())
  deletedAt DateTime
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('field "deletedAt" is invalid for @bcm.softDelete');
        });

        it('allows valid @bcm.softDelete deletedAt DateTime? field', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.softDelete
model Post {
  id String @id @default(cuid())
  deletedAt DateTime?
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
        });

        it('throws when a required scalar field is marked @bcm.readonly without optional/default', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  notifications Notification[]
}

model Notification {
  id String @id @default(cuid())
  userId String
  /// @bcm.nested
  user User @relation(fields: [userId], references: [id])
  /// @bcm.readonly
  type String
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Invalid schema for API generation');
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Model "Notification" field "type" is required and marked @bcm.readonly');
        });

        it('allows required @bcm.readonly scalar fields when a default value exists', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  notifications Notification[]
}

model Notification {
  id String @id @default(cuid())
  userId String
  /// @bcm.nested
  user User @relation(fields: [userId], references: [id])
  /// @bcm.readonly
  type String @default("system")
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
        });

        it('throws when required relations mix @bcm.nested and scalar-FK input modes', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  participants ConversationParticipant[]
}

model Conversation {
  id String @id @default(cuid())
  participants ConversationParticipant[]
}

model ConversationParticipant {
  id String @id @default(cuid())
  conversationId String
  userId String
  /// @bcm.nested
  conversation Conversation @relation(fields: [conversationId], references: [id])
  user User @relation(fields: [userId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Invalid schema for API generation');
            await expect(generateProject(schema, defaultOptions, raw)).rejects.toThrow('Model "ConversationParticipant" mixes required @bcm.nested relations');
        });

        it('allows models where all required relations use @bcm.nested', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  participants ConversationParticipant[]
}

model Conversation {
  id String @id @default(cuid())
  participants ConversationParticipant[]
}

model ConversationParticipant {
  id String @id @default(cuid())
  conversationId String
  userId String
  /// @bcm.nested
  conversation Conversation @relation(fields: [conversationId], references: [id])
  /// @bcm.nested
  user User @relation(fields: [userId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
        });

        it('accepts ex12-style ConversationParticipant shape once both required relations are nested', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  conversationParticipants ConversationParticipant[]
}

model Conversation {
  id String @id @default(cuid())
  participants ConversationParticipant[]
}

/// @bcm.protected
model ConversationParticipant {
  id             String @id @default(cuid())
  conversationId String
  userId         String

  /// @bcm.nested
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  /// @bcm.nested
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// @bcm.readonly
  createdAt DateTime @default(now())

  @@unique([conversationId, userId])
  @@index([userId])
}
`;
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
        });

        it('accepts examples/ex12-4swapp.prisma under strict validation guards', async () => {
            const raw = readFileSync('examples/ex12-4swapp.prisma', 'utf8');
            const schema = parsePrismaAst(raw);
            await expect(generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)).resolves.toBeDefined();
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

        it('generates Redis in docker-compose for auth-only schemas', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
  role String @default("ADMIN")
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dc = files.find(f => f.path === 'docker-compose.yml')!;

            expect(dc.content).toContain('REDIS_URL=redis://redis:6379');
            expect(dc.content).toContain('redis:\n    image: redis:7-alpine');
            expect(dc.content).toContain('redis:\n        condition: service_started');
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

        it('generates .dockerignore to keep host artifacts out of Docker builds', async () => {
            const raw = makeSchema('sqlite');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dockerignore = files.find(f => f.path === '.dockerignore')!;

            expect(dockerignore.content).toContain('node_modules/');
            expect(dockerignore.content).toContain('dist/');
            expect(dockerignore.content).toContain('.env');
            expect(dockerignore.content).toContain('*.db');
            expect(dockerignore.content).toContain('coverage/');
        });

        it('documents that Docker relies on .dockerignore before copying source files', async () => {
            const raw = makeSchema('sqlite');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dockerfile = files.find(f => f.path === 'Dockerfile')!;

            expect(dockerfile.content).toContain('# syntax=docker/dockerfile:1.7');
            expect(dockerfile.content).toContain('.dockerignore keeps host artifacts like node_modules and dist out of this copy.');
            expect(dockerfile.content).toContain('COPY . .');
            expect(dockerfile.content).toContain("if [ -f pnpm-lock.yaml ]");
            expect(dockerfile.content).toContain('pnpm install --frozen-lockfile');
            expect(dockerfile.content).toContain('pnpm install --no-frozen-lockfile');
            expect(dockerfile.content).toContain('RUN corepack enable && corepack prepare pnpm@10.27.0 --activate');
            expect(dockerfile.content).toContain('RUN npm install -g pnpm@10.27.0');
        });

        it('generates a Docker entrypoint and uses it as the container start command', async () => {
            const raw = makeSchema('sqlite');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dockerfile = files.find(f => f.path === 'Dockerfile')!;
            const entrypoint = files.find(f => f.path === 'docker-entrypoint.sh')!;

            expect(entrypoint.content).toContain('#!/bin/sh');
            expect(dockerfile.content).toContain('FROM node:22-alpine AS runner');
            expect(dockerfile.content).toContain('COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh');
            expect(dockerfile.content).toContain('RUN chmod +x /app/docker-entrypoint.sh');
            expect(dockerfile.content).toContain('CMD ["./docker-entrypoint.sh"]');
        });

        it('bootstraps SQL providers with migrate deploy when migrations exist and db push otherwise', async () => {
            const raw = makeSchema('postgresql');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const entrypoint = files.find(f => f.path === 'docker-entrypoint.sh')!;

            expect(entrypoint.content).toContain('has_prisma_migrations()');
            expect(entrypoint.content).toContain('Bootstrapping database schema with prisma migrate deploy...');
            expect(entrypoint.content).toContain('npx prisma migrate deploy');
            expect(entrypoint.content).toContain('No Prisma migrations detected; bootstrapping schema with prisma db push...');
            expect(entrypoint.content).toContain('npx prisma db push');
            expect(entrypoint.content).toContain('exec node dist/server.js');
        });

        it('generates MongoDB docker-compose for mongodb provider', async () => {
            const raw = makeSchema('mongodb');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const dc = files.find(f => f.path === 'docker-compose.yml')!;

            expect(dc.content).toContain('mongo:7');
            expect(dc.content).toContain('MONGO_INITDB_ROOT_USERNAME');
        });

        it('bootstraps MongoDB containers with prisma db push', async () => {
            const raw = makeSchema('mongodb');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const entrypoint = files.find(f => f.path === 'docker-entrypoint.sh')!;

            expect(entrypoint.content).toContain('Bootstrapping database schema with prisma db push...');
            expect(entrypoint.content).toContain('npx prisma db push');
            expect(entrypoint.content).not.toContain('npx prisma migrate deploy');
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

            expect(ci.content).toContain('pnpm/action-setup@v4');
            expect(ci.content).toContain('cache: pnpm');
            expect(ci.content).toContain('pnpm install --frozen-lockfile');
            expect(ci.content).toContain('pnpm build');
            expect(ci.content).toContain('pnpm test');
            expect(ci.content).toContain('file:./test.db');
            expect(ci.content).not.toContain('postgres');
        });

        it('MongoDB CI uses db push instead of migrate', async () => {
            const raw = makeSchema('mongodb');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const ci = files.find(f => f.path === '.github/workflows/ci.yml')!;

            expect(ci.content).toContain('pnpm exec prisma db push');
            expect(ci.content).not.toContain('prisma migrate');
        });

        it('documents Docker schema bootstrap behavior in the generated README', async () => {
            const raw = makeSchema('sqlite');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'infra' }, raw);
            const readme = files.find(f => f.path === 'README.md')!;

            expect(readme.content).toContain('pnpm install');
            expect(readme.content).toContain('pnpm dev');
            expect(readme.content).toContain('pnpm test');
            expect(readme.content).toContain('Docker startup bootstraps the schema automatically before the server starts.');
            expect(readme.content).toContain('If Prisma migration directories already exist, the container runs');
            expect(readme.content).toContain('prisma migrate deploy');
            expect(readme.content).toContain('If no real migration directories exist yet, it falls back to');
            expect(readme.content).toContain('prisma db push');
            expect(readme.content).toContain('Keep Docker BuildKit enabled');
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

        const NESTED_ENUM_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Gender {
  MALE
  FEMALE
}

model User {
  id     String @id @default(cuid())
  email  String @unique
  gender Gender
  posts  Post[]
}

model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
  /// @bcm.nested
  author   User   @relation(fields: [authorId], references: [id])
}
`;

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

        it('dto.ts requires nested relation when underlying FK is required', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SCHEMA);
            const postDto = files.find(f => f.path.includes('post.dto.ts'))!;

            expect(postDto.content).toContain('author: Post_AuthorInput,');
            expect(postDto.content).not.toContain('author: Post_AuthorInput.optional()');
        });

        it('repository.ts auto-includes nested relations in create', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SCHEMA);
            const postRepo = files.find(f => f.path.includes('post.repository.ts'))!;

            expect(postRepo.content).toContain('include:');
            expect(postRepo.content).toContain('author: true');
        });

        it('test.ts payload uses nested connect for required @bcm.nested relations', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SCHEMA);
            const postTest = files.find(f => f.path.includes('post.test.ts'))!;

            expect(postTest.content).toContain("vi.mock('../../config/database.js'");
            expect(postTest.content).toContain('const prismaMock');
            expect(postTest.content).toContain('returns a paginated list from mocked Prisma delegates');
            expect(postTest.content).toContain('returns 404 when mocked Prisma reports a missing record');
            expect(postTest.content).not.toContain('TODO: Set up test database');
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

        it('openapi update/patch schemas include nested relation input and exclude nested FK', async () => {
            const schema = getNestedSchema();
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, NESTED_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            const createProps = openapi.components.schemas.PostCreate.properties;
            const updateProps = openapi.components.schemas.PostUpdate.properties;
            const patchProps = openapi.components.schemas.PostPatch.properties;
            expect(createProps.author).toBeDefined();
            expect(updateProps.author).toBeDefined();
            expect(patchProps.author).toBeDefined();
            expect(createProps.authorId).toBeUndefined();
            expect(updateProps.authorId).toBeUndefined();
            expect(patchProps.authorId).toBeUndefined();
        });

        it('dto.ts emits enum schema used only by nested relation create fields', async () => {
            const schema = parsePrismaAst(NESTED_ENUM_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_ENUM_SCHEMA);
            const postDto = files.find(f => f.path.includes('post.dto.ts'))!;

            expect(postDto.content).toContain('export const GenderSchema = z.enum');
            expect(postDto.content).toContain('gender: GenderSchema');
        });
    });

    describe('test scaffolding for models with no required create fields', () => {
        const OPTIONAL_ONLY_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.protected
model Conversation {
  id        String   @id @default(uuid())
  title     String?
  createdAt DateTime @default(now())
}
`;

        it('does not assert 422 for empty POST/PUT bodies when no required fields exist', async () => {
            const schema = parsePrismaAst(OPTIONAL_ONLY_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, OPTIONAL_ONLY_SCHEMA);
            const convoTest = files.find(f => f.path.includes('conversation.test.ts'))!;

            expect(convoTest.content).toContain('accepts an empty body when the schema has no required create fields');
            expect(convoTest.content).not.toContain('returns 422 for an invalid body before hitting Prisma');
        });

        it('asserts 422 for empty POST/PUT bodies when required nested relation input exists', async () => {
            const nestedRequiredOnlySchema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id @default(cuid())
  notes Note[]
}

model Note {
  id String @id @default(cuid())
  ownerId String
  /// @bcm.nested
  owner User @relation(fields: [ownerId], references: [id])
  content String?
}
`;
            const schema = parsePrismaAst(nestedRequiredOnlySchema);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, nestedRequiredOnlySchema);
            const noteTest = files.find(f => f.path.includes('note.test.ts'))!;

            expect(noteTest.content).toContain('returns 422 for an invalid body before hitting Prisma');
            expect(noteTest.content).not.toContain('accepts an empty body when the schema has no required create fields');
        });
    });

    describe('typed selectors and query safety', () => {
        it('generates typed selector keys and selector param coercion for non-string selectors', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Invoice {
  id   Int    @id @default(autoincrement())
  code String @unique
}

model Shipment {
  day      DateTime
  sequence Int

  @@id([day, sequence])
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);

            const invoiceRepo = files.find(f => f.path.includes('invoice.repository.ts'))!;
            const invoiceController = files.find(f => f.path.includes('invoice.controller.ts'))!;
            const shipmentRepo = files.find(f => f.path.includes('shipment.repository.ts'))!;
            const shipmentController = files.find(f => f.path.includes('shipment.controller.ts'))!;

            expect(invoiceRepo.content).toContain('id: number;');
            expect(invoiceController.content).toContain("fieldType === 'number'");
            expect(shipmentRepo.content).toContain('day: Date;');
            expect(shipmentRepo.content).toContain('sequence: number;');
            expect(shipmentController.content).toContain("fieldType === 'datetime'");
        });

        it('uses model-derived default sort instead of hardcoded id fallback', async () => {
            const schema = parsePrismaAst(COMPOSITE_KEYS_SCHEMA);
            const routeFiles = await generateProject(schema, { ...defaultOptions, only: 'routes' }, COMPOSITE_KEYS_SCHEMA);
            const utilFiles = await generateProject(schema, { ...defaultOptions, only: 'utils' }, COMPOSITE_KEYS_SCHEMA);

            const favoriteController = routeFiles.find(f => f.path.includes('favorite.controller.ts'))!;
            const queryBuilder = utilFiles.find(f => f.path.includes('query-builder.ts'))!;

            expect(favoriteController.content).toContain("const DEFAULT_SORT_FIELD: string | undefined = 'userId'");
            expect(queryBuilder.content).not.toContain("query.sort || 'id'");
            expect(queryBuilder.content).toContain("let sortField: string | undefined;");
        });

        it('emits filter type metadata and strict filter coercion logic', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Status {
  OPEN
  CLOSED
}

model AuditLog {
  id        String   @id @default(cuid())
  status    Status
  amount    BigInt
  createdAt DateTime
  title     String
}
`;
            const schema = parsePrismaAst(raw);
            const routeFiles = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);
            const utilFiles = await generateProject(schema, { ...defaultOptions, only: 'utils' }, raw);

            const controller = routeFiles.find(f => f.path.includes('auditLog.controller.ts'))!;
            const queryBuilder = utilFiles.find(f => f.path.includes('query-builder.ts'))!;

            expect(controller.content).toContain("status: 'enum'");
            expect(controller.content).toContain("amount: 'bigint'");
            expect(controller.content).toContain("createdAt: 'datetime'");
            expect(queryBuilder.content).toContain("if (fieldType === 'enum')");
            expect(queryBuilder.content).toContain("if (fieldType === 'bigint')");
            expect(queryBuilder.content).toContain("if (fieldType === 'datetime')");
            expect(queryBuilder.content).toContain('Invalid filter value for');
        });

        it('rejects include params when model has no includable relations', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model EventLog {
  id      String @id @default(cuid())
  message String
}
`;
            const schema = parsePrismaAst(raw);
            const routeFiles = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);
            const utilFiles = await generateProject(schema, { ...defaultOptions, only: 'utils' }, raw);

            const controller = routeFiles.find(f => f.path.includes('eventLog.controller.ts'))!;
            const queryBuilder = utilFiles.find(f => f.path.includes('query-builder.ts'))!;

            expect(controller.content).toContain('const ALLOWED_INCLUDE_RELATIONS: string[] = [];');
            expect(queryBuilder.content).toContain('relations.filter(');
            expect(queryBuilder.content).toContain('!allowedIncludeRelations.includes(relation)');
            expect(queryBuilder.content).not.toContain('allowedIncludeRelations.length > 0');
        });
    });

    describe('nested connect selector support', () => {
        const NESTED_SELECTOR_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Category {
  id    Int    @id @default(autoincrement())
  name  String
  posts Post[]
}

model Locale {
  code   String
  region String
  books  Book[]

  @@id([code, region], name: "localeKey")
}

model Post {
  id         String   @id @default(cuid())
  title      String
  categoryId Int
  /// @bcm.nested
  category   Category @relation(fields: [categoryId], references: [id])
}

model Book {
  id           String @id @default(cuid())
  title        String
  localeCode   String
  localeRegion String
  /// @bcm.nested
  locale       Locale @relation(fields: [localeCode, localeRegion], references: [code, region])
}
`;

        it('generates dto connect schema using selector field types for single and composite selectors', async () => {
            const schema = parsePrismaAst(NESTED_SELECTOR_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SELECTOR_SCHEMA);
            const postDto = files.find(f => f.path.includes('post.dto.ts'))!;
            const bookDto = files.find(f => f.path.includes('book.dto.ts'))!;

            expect(postDto.content).toContain('connect: z.object({');
            expect(postDto.content).toContain('id: z.number().int()');
            expect(bookDto.content).toContain('localeKey: z.object({');
            expect(bookDto.content).toContain('code: z.string()');
            expect(bookDto.content).toContain('region: z.string()');
        });

        it('generates matching OpenAPI connect schema for selector-aware nested inputs', async () => {
            const schema = parsePrismaAst(NESTED_SELECTOR_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, NESTED_SELECTOR_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            const postConnect = openapi.components.schemas['Post_CategoryInput'].properties.connect;
            const bookConnect = openapi.components.schemas['Book_LocaleInput'].properties.connect;
            expect(postConnect.properties.id.type).toBe('integer');
            expect(bookConnect.properties.localeKey).toBeDefined();
            expect(bookConnect.properties.localeKey.properties.code.type).toBe('string');
            expect(bookConnect.properties.localeKey.properties.region.type).toBe('string');
        });

        it('generates selector-aware composite nested connect payload in scaffold tests', async () => {
            const schema = parsePrismaAst(NESTED_SELECTOR_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, NESTED_SELECTOR_SCHEMA);
            const bookTest = files.find(f => f.path.includes('book.test.ts'))!;

            expect(bookTest.content).toContain('const prismaMock');
            expect(bookTest.content).toContain('mockRecord(existingKey)');
            expect(bookTest.content).toContain('buildItemPath');
        });
    });

    describe('list @bcm.nested relation handling', () => {
        const LIST_NESTED_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id          String @id @default(cuid())
  displayName String
  /// @bcm.nested
  posts       Post[]
}

model Post {
  id      String @id @default(cuid())
  title   String
  ownerId String?
  owner   User?  @relation(fields: [ownerId], references: [id])
}
`;

        it('dto.ts emits array create and connect schemas for list nested relations', async () => {
            const schema = parsePrismaAst(LIST_NESTED_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, LIST_NESTED_SCHEMA);
            const userDto = files.find(f => f.path.includes('user.dto.ts'))!;

            expect(userDto.content).toContain('User_PostsInput');
            expect(userDto.content).toContain('create: z.array(z.object({');
            expect(userDto.content).toContain('connect: z.array(z.object({');
            expect(userDto.content).toContain(')).min(1).optional()');
            expect(userDto.content).toContain('displayName: z.string(),');
        });

        it('openapi.json matches array create/connect contract for list nested relations', async () => {
            const schema = parsePrismaAst(LIST_NESTED_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, LIST_NESTED_SCHEMA);
            const openapi = JSON.parse(files[0].content);
            const nestedInput = openapi.components.schemas['User_PostsInput'];

            expect(nestedInput.properties.create.type).toBe('array');
            expect(nestedInput.properties.create.items.type).toBe('object');
            expect(nestedInput.properties.connect.type).toBe('array');
            expect(nestedInput.properties.connect.items.type).toBe('object');
            expect(nestedInput.anyOf).toEqual([{ required: ['create'] }, { required: ['connect'] }]);
        });

        it('keeps unrelated scalar fields in create schema for list nested relations', async () => {
            const schema = parsePrismaAst(LIST_NESTED_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, LIST_NESTED_SCHEMA);
            const openapi = JSON.parse(files[0].content);

            expect(openapi.components.schemas.UserCreate.properties.displayName).toBeDefined();
            expect(openapi.components.schemas.UserCreate.properties.posts).toBeDefined();
        });
    });

    describe('seed typing and infra config', () => {
        it('seed template supports non-string parent IDs', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    Int    @id @default(autoincrement())
  name  String
  posts Post[]
}

model Post {
  id      Int    @id @default(autoincrement())
  userId  Int
  title   String
  user    User   @relation(fields: [userId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, raw);
            const seed = files.find(f => f.path === 'prisma/seed.ts')!;

            expect(seed.content).toContain('type ParentId = string | number | bigint | Date;');
            expect(seed.content).toContain('type ParentFieldValue = ParentId | boolean | Buffer | null;');
            expect(seed.content).toContain("import 'dotenv/config';");
            expect(seed.content).toContain("const SOURCE_DATABASE_MODULE = '../src/config/database.ts';");
            expect(seed.content).toContain("const DIST_DATABASE_MODULE = '../dist/config/database.js';");
            expect(seed.content).toContain('async function loadPrisma(): Promise<SeedPrismaClient> {');
            expect(seed.content).not.toContain('new PrismaClient()');
            expect(seed.content).not.toContain('Record<string, string[]>');
        });

        it('maps custom FK names from relation metadata instead of guessing relationNameId', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Child {
  id       String @id @default(cuid())
  parentFk String
  parent   Parent @relation(fields: [parentFk], references: [id])
}

model Parent {
  id String @id @default(cuid())
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, raw);
            const seed = files.find(f => f.path === 'prisma/seed.ts')!;

            expect(seed.content).toContain('"relationName": "parent"');
            expect(seed.content).toContain('"targetModel": "Parent"');
            expect(seed.content).toContain('"cacheKey": "Parent|id"');
            expect(seed.content).toMatch(/"localFields": \[\s*"parentFk"\s*\]/);
            expect(seed.content).toMatch(/"referenceFields": \[\s*"id"\s*\]/);
            expect(seed.content).toContain('relation.localFields.forEach((localField, index) => {');
        });

        it('maps composite custom FK relations using referenced parent fields', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Locale {
  code   String
  region String
  books  Book[]

  @@id([code, region], name: "localeKey")
}

model Book {
  id           String @id @default(cuid())
  localeCode   String
  localeRegion String
  locale       Locale @relation(fields: [localeCode, localeRegion], references: [code, region])
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, raw);
            const seed = files.find(f => f.path === 'prisma/seed.ts')!;

            expect(seed.content).toContain('"cacheKey": "Locale|code,region"');
            expect(seed.content).toMatch(/"localFields": \[\s*"localeCode",\s*"localeRegion"\s*\]/);
            expect(seed.content).toMatch(/"referenceFields": \[\s*"code",\s*"region"\s*\]/);
            expect(seed.content).toContain("const select = Object.fromEntries(relation.referenceFields.map((field) => [field, true]));");
        });

        it('emits wildcard-safe CORS credentials behavior and sqlite data path aligned with schema-relative resolution', async () => {
            const sqliteSchema = `
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Item {
  id   String @id @default(cuid())
  name String
}
`;
            const schema = parsePrismaAst(sqliteSchema);
            const configFiles = await generateProject(schema, { ...defaultOptions, only: 'config' }, sqliteSchema);
            const infraFiles = await generateProject(schema, { ...defaultOptions, only: 'infra' }, sqliteSchema);
            const corsFile = configFiles.find(f => f.path === 'src/config/cors.ts')!;
            const envExample = infraFiles.find(f => f.path === '.env.example')!;
            const dc = infraFiles.find(f => f.path === 'docker-compose.yml')!;

            expect(corsFile.content).toContain("const credentials = origin !== '*' && origin !== false;");
            expect(corsFile.content).toContain('credentials,');
            expect(envExample.content).toContain('Use an explicit origin when sending credentials from browsers');
            expect(dc.content).toContain('DATABASE_URL=file:./data/');
        });

        it('emits usable auth-model seed credentials and password hashing', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
  role String @default("ADMIN")
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, raw);
            const seed = files.find(f => f.path === 'prisma/seed.ts')!;

            expect(seed.content).toContain("import bcrypt from 'bcryptjs';");
            expect(seed.content).toContain("const AUTH_SEED_PASSWORD = 'SeedPassword123!';");
            expect(seed.content).toContain('return bcrypt.hash(AUTH_SEED_PASSWORD, 12);');
            expect(seed.content).toContain('"sampleIdentifier": "seed-user-1@example.com"');
            expect(seed.content).toContain('Sample ${model.name} credentials -> ${model.auth.identifierField}: ${model.auth.sampleIdentifier}, password: ${AUTH_SEED_PASSWORD}');
            expect(seed.content).toContain('"isAuthIdentifier": true');
            expect(seed.content).toContain('"isAuthPassword": true');
        });

        it('retries generated unique selectors before failing with a selector-specific error', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Product {
  id   String @id @default(cuid())
  sku  String @unique
  slug String @unique
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, raw);
            const seed = files.find(f => f.path === 'prisma/seed.ts')!;

            expect(seed.content).toContain('const MAX_UNIQUE_RETRIES = 25;');
            expect(seed.content).toContain('function reserveUniqueCandidate(');
            expect(seed.content).toContain('Unable to generate unique seed data for ${model.name} after ${MAX_UNIQUE_RETRIES} attempts.');
            expect(seed.content).toMatch(/"uniqueSelectors": \[\s*\{\s*"fields": \[\s*"sku"\s*\]\s*\},\s*\{\s*"fields": \[\s*"slug"\s*\]\s*\}\s*\]/);
        });

        it('omits optional self relations from seed data while preserving relation metadata', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Category {
  id       String    @id @default(cuid())
  name     String
  parentId String?
  parent   Category? @relation(fields: [parentId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, raw);
            const seed = files.find(f => f.path === 'prisma/seed.ts')!;

            expect(seed.content).toContain('"relationName": "parent"');
            expect(seed.content).toContain('"omit": true');
            expect(seed.content).not.toContain('"name": "parentId"');
        });

        it('fails before cleanup for required cyclic or self relations', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Category {
  id       String   @id @default(cuid())
  parentId String
  parent   Category @relation(fields: [parentId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, raw);
            const seed = files.find(f => f.path === 'prisma/seed.ts')!;

            expect(seed.content).toContain('Seeder cannot safely generate required cyclic/self relations');
            expect(seed.content).toContain('relation \\"parent\\" cannot be auto-seeded');
            expect(seed.content.indexOf('assertSupportedRelations();')).toBeLessThan(
                seed.content.indexOf('await getDelegate(model.clientKey).deleteMany();')
            );
        });
    });

    describe('test scaffold auth dependency tokens', () => {
        it('uses the shared mocked Prisma scaffold even for mixed RBAC dependency graphs', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
  role String @default("ADMIN")
}

/// @bcm.auth(roles: [ADMIN])
model Org {
  id   String @id @default(cuid())
  name String
  projects Project[]
}

/// @bcm.auth(roles: [MODERATOR])
model Project {
  id    String @id @default(cuid())
  orgId String
  title String
  org   Org    @relation(fields: [orgId], references: [id])
  tasks Task[]
}

model Task {
  id        String  @id @default(cuid())
  projectId String
  title     String
  project   Project @relation(fields: [projectId], references: [id])
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);
            const taskTest = files.find(f => f.path.includes('task.test.ts'))!;

            expect(taskTest.content).toContain('const prismaMock');
            expect(taskTest.content).toContain("vi.mock('../../config/database.js'");
            expect(taskTest.content).not.toContain('SetupToken');
            expect(taskTest.content).not.toContain("role: 'ADMIN'");
            expect(taskTest.content).not.toContain("role: 'MODERATOR'");
        });
    });

    describe('auth model enum-role and selector map coverage', () => {
        it('supports @bcm.authModel with enum role field named role', async () => {
            const raw = readFixture('auth.prisma');
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions }, raw);

            const authRoutes = files.find((f) => f.path === 'src/modules/auth/auth.routes.ts');
            const teamRoutes = files.find((f) => f.path === 'src/modules/team/team.routes.ts');
            const openapi = files.find((f) => f.path === 'openapi.json');

            expect(authRoutes).toBeDefined();
            expect(authRoutes!.content).toContain('role: user.role');
            expect(teamRoutes).toBeDefined();
            expect(teamRoutes!.content).toContain('authorize');
            expect(openapi).toBeDefined();
            expect(JSON.parse(openapi!.content).paths['/api/v1/auth/login']).toBeDefined();
        });

        it('uses explicit @@id name/map selector key in service and selector-aware OpenAPI path', async () => {
            const raw = readFixture('composite.prisma');
            const schema = parsePrismaAst(raw);
            const routeFiles = await generateProject(schema, { ...defaultOptions, only: 'routes' }, raw);
            const swaggerFiles = await generateProject(schema, { ...defaultOptions, only: 'swagger' }, raw);

            const repo = routeFiles.find((f) => f.path === 'src/modules/enrollment/enrollment.repository.ts');
            expect(repo).toBeDefined();
            expect(repo!.content).toContain('enrollmentKey');
            expect(repo!.content).toContain('schoolId: key.schoolId');
            expect(repo!.content).toContain('studentId: key.studentId');

            const openapi = JSON.parse(swaggerFiles[0].content);
            expect(openapi.paths['/api/v1/enrollments/{schoolId}/{studentId}']).toBeDefined();
        });
    });

    describe('warning propagation', () => {
        it('keeps generation successful when parser emits non-fatal warnings', async () => {
            const raw = readFixture('warning-hidden-required.prisma');
            const parsed = parsePrismaAst(raw);
            expect(parsed.warnings.some((warning) => warning.includes('required but marked @bcm.hidden'))).toBe(true);

            const files = await generateProject(parsed, { ...defaultOptions, only: 'routes' }, raw);
            expect(files.length).toBeGreaterThan(0);
            expect(files.some((file) => file.path.endsWith('auditEntry.controller.ts'))).toBe(true);
        });
    });

    describe('fastify framework hardening', () => {
        const FASTIFY_AUTH_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
  role String
}

/// @bcm.auth(roles: [ADMIN])
model Secret {
  id String @id @default(cuid())
  key String
}
`;

        const FASTIFY_AUTH_NO_ROLE_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id String @id @default(cuid())
  /// @bcm.identifier
  email String @unique
  /// @bcm.password
  password String
  posts Post[]
}

/// @bcm.protected
model Post {
  id String @id @default(cuid())
  title String
  authorId String
  author User @relation(fields: [authorId], references: [id])
}
`;

        const FASTIFY_UPLOAD_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Asset {
  id String @id @default(cuid())
  /// @bcm.upload(dest: "assets")
  imageUrl String?
}
`;

        it('registers JWT and multipart plugins for fastify output when needed', async () => {
            const authSchema = parsePrismaAst(FASTIFY_AUTH_SCHEMA);
            const authFiles = await generateProject(authSchema, { ...defaultOptions, framework: 'fastify' }, FASTIFY_AUTH_SCHEMA);
            const authApp = authFiles.find((f) => f.path === 'src/app.ts')!;
            const authPkg = authFiles.find((f) => f.path === 'package.json')!;
            const authRoutes = authFiles.find((f) => f.path === 'src/modules/auth/auth.routes.ts')!;
            const authMiddleware = authFiles.find((f) => f.path === 'src/middlewares/auth.middleware.ts')!;
            const secretController = authFiles.find((f) => f.path.endsWith('secret.controller.ts'))!;

            expect(authApp.content).toContain("import jwt from '@fastify/jwt'");
            expect(authApp.content).toContain('await app.register(jwt, { secret: env.JWT_SECRET })');
            expect(authPkg.content).toContain('"@fastify/jwt"');
            expect(authRoutes.content).toContain('fastify.jwt.sign');
            expect(authMiddleware.content).toContain('payload: { sub: string; role?: string; [key: string]: unknown }');
            expect(authMiddleware.content).toContain('user: { sub: string; role?: string; [key: string]: unknown }');
            expect(secretController.content).toContain("from 'fastify'");
            expect(secretController.content).not.toContain("from 'express'");

            const uploadSchema = parsePrismaAst(FASTIFY_UPLOAD_SCHEMA);
            const uploadFiles = await generateProject(uploadSchema, { ...defaultOptions, framework: 'fastify' }, FASTIFY_UPLOAD_SCHEMA);
            const uploadApp = uploadFiles.find((f) => f.path === 'src/app.ts')!;
            const uploadRoutes = uploadFiles.find((f) => f.path.endsWith('asset.routes.ts'))!;
            const uploadConfig = uploadFiles.find((f) => f.path === 'src/config/upload.ts')!;

            expect(uploadApp.content).toContain("import multipart from '@fastify/multipart'");
            expect(uploadApp.content).toContain('await app.register(multipart');
            expect(uploadRoutes.content).toContain('uploadField(');
            expect(uploadConfig.content).toContain("from '@fastify/multipart'");
        });

        it('supports fastify auth models without role fields', async () => {
            const schema = parsePrismaAst(FASTIFY_AUTH_NO_ROLE_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, framework: 'fastify' }, FASTIFY_AUTH_NO_ROLE_SCHEMA);
            const authRoutes = files.find((f) => f.path === 'src/modules/auth/auth.routes.ts')!;
            const authMiddleware = files.find((f) => f.path === 'src/middlewares/auth.middleware.ts')!;

            expect(authMiddleware.content).toContain('payload: { sub: string; role?: string; [key: string]: unknown }');
            expect(authMiddleware.content).toContain('user: { sub: string; role?: string; [key: string]: unknown }');
            expect(authRoutes.content).toContain('sub: String(user.id)');
            expect(authRoutes.content).not.toContain('role: user.role');
        });

        it('uses fastify-native response helpers without express imports', async () => {
            const schema = parsePrismaAst(FASTIFY_AUTH_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'utils', framework: 'fastify' }, FASTIFY_AUTH_SCHEMA);
            const responseFile = files.find((f) => f.path === 'src/utils/response.ts')!;

            expect(responseFile.content).toContain("import type { FastifyReply } from 'fastify'");
            expect(responseFile.content).toContain('reply.code(200).send');
            expect(responseFile.content).not.toContain("from 'express'");
        });

        it('builds a generated fastify project when auth model has no role field', async () => {
            const workspace = await createTempWorkspace('backgen-fastify-auth-no-role-');
            const schema = parsePrismaAst(FASTIFY_AUTH_NO_ROLE_SCHEMA);
            const files = await generateProject(
                schema,
                {
                    schema: workspace.resolve('schema.prisma'),
                    output: workspace.root,
                    dryRun: false,
                    force: true,
                    framework: 'fastify',
                },
                FASTIFY_AUTH_NO_ROLE_SCHEMA
            );

            try {
                await writeFiles(files, workspace.root, { mode: 'overwrite-targeted' });
                await fs.writeFile(workspace.resolve('.env'), [
                    'NODE_ENV=development',
                    'PORT=3000',
                    'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/backgen_test"',
                    'JWT_SECRET="change-me-to-a-long-random-string-at-least-32-chars"',
                    'CORS_ORIGIN="*"',
                    'LOG_LEVEL="info"',
                    'RATE_LIMIT_MAX=100',
                ].join('\n'), 'utf8');

                await execFileAsync('npm', ['install'], {
                    cwd: workspace.root,
                    timeout: 240000,
                    maxBuffer: 1024 * 1024 * 20,
                });
                await execFileAsync('npx', ['prisma', 'generate'], {
                    cwd: workspace.root,
                    timeout: 240000,
                    maxBuffer: 1024 * 1024 * 20,
                });
                await execFileAsync('npm', ['run', 'build'], {
                    cwd: workspace.root,
                    timeout: 240000,
                    maxBuffer: 1024 * 1024 * 20,
                });
            } finally {
                await workspace.cleanup();
            }
        }, 300000);
    });

    describe('cache invalidation strategy', () => {
        const CACHE_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.cache(ttl: 120)
model Product {
  id String @id @default(cuid())
  name String
}
`;

        it('uses versioned cache keys and bumps version on mutations', async () => {
            const schema = parsePrismaAst(CACHE_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, CACHE_SCHEMA);
            const service = files.find((f) => f.path.endsWith('product.service.ts'))!;
            const testFile = files.find((f) => f.path.endsWith('product.test.ts'))!;

            expect(service.content).toContain('CACHE_VERSION_KEY');
            expect(service.content).toContain('getCacheVersion()');
            expect(service.content).toContain('bumpCacheVersion()');
            expect(service.content).toContain('await redis.incr(CACHE_VERSION_KEY)');
            expect(service.content).not.toContain('redis.del(`${CACHE_PREFIX}:list:*`)');
            expect(testFile.content).toContain('incr: vi.fn().mockResolvedValue');
        });
    });

    describe('datasource adapter safety', () => {
        it('does not inject adapter for providers without adapter templates', async () => {
            const raw = `
datasource db {
  provider = "sqlserver"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Item {
  id String @id @default(cuid())
}
`;
            const schema = parsePrismaAst(raw);
            const files = await generateProject(schema, { ...defaultOptions, only: 'config' }, raw);
            const db = files.find((f) => f.path === 'src/config/database.ts')!;

            expect(db.content).toContain('new PrismaClient');
            expect(db.content).not.toContain('adapter,');
            expect(db.content).not.toContain('const adapter =');
        });
    });

    describe('examples smoke matrix', () => {
        const exampleFiles = [
            'ex1-todo.prisma',
            'ex2-blog.prisma',
            'ex3-task-manager.prisma',
            'ex4-user-profile.prisma',
            'ex5-school.prisma',
            'ex6-org-chart.prisma',
            'ex7-multi-tenant.prisma',
            'ex8-ecommerce.prisma',
            'ex9-social.prisma',
            'ex10-hospital.prisma',
            'ex11-newtest.prisma',
            'ex12-4swapp.prisma',
        ];

        it('generates full output for all documented examples without crashes', async () => {
            for (const exampleFile of exampleFiles) {
                const raw = readFileSync(new URL(`../examples/${exampleFile}`, import.meta.url), 'utf8');
                const parsed = parsePrismaAst(raw);
                const files = await generateProject(parsed, defaultOptions, raw);
                const paths = files.map((file) => file.path);

                if (!paths.includes('openapi.json')) {
                    throw new Error(`Missing openapi.json for ${exampleFile}`);
                }
                if (!paths.includes('src/app.ts')) {
                    throw new Error(`Missing src/app.ts for ${exampleFile}`);
                }
                if (!paths.includes('src/server.ts')) {
                    throw new Error(`Missing src/server.ts for ${exampleFile}`);
                }

                for (const model of parsed.models) {
                    const modelLower = model.name.charAt(0).toLowerCase() + model.name.slice(1);
                    const modulePrefix = `src/modules/${modelLower}/${modelLower}`;
                    const expectedFiles = [
                        `${modulePrefix}.controller.ts`,
                        `${modulePrefix}.service.ts`,
                        `${modulePrefix}.routes.ts`,
                        `${modulePrefix}.dto.ts`,
                        `${modulePrefix}.test.ts`,
                    ];
                    for (const expectedPath of expectedFiles) {
                        if (!paths.includes(expectedPath)) {
                            throw new Error(`Missing ${expectedPath} for ${exampleFile}`);
                        }
                    }
                }
            }
        });
    });

    describe('@bcm.transform directive', () => {
        const TRANSFORM_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    String @id @default(cuid())
  /// @bcm.transform(trim: true, lowercase: true)
  email String @unique
  /// @bcm.transform(trim: true)
  name  String
}
`;

        it('generates Zod .transform() chains in DTO for trimmed and lowercased fields', async () => {
            const schema = parsePrismaAst(TRANSFORM_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, TRANSFORM_SCHEMA);
            const dto = files.find((f) => f.path.endsWith('user.dto.ts'))!;

            // email should have both trim and lowercase transforms
            expect(dto.content).toContain("email: z.string().transform((v) => typeof v === 'string' ? v.trim() : v).transform((v) => typeof v === 'string' ? v.toLowerCase() : v)");
            // name should only have trim
            expect(dto.content).toContain("name: z.string().transform((v) => typeof v === 'string' ? v.trim() : v)");
            // name should NOT have lowercase
            expect(dto.content).not.toContain("name: z.string().transform((v) => typeof v === 'string' ? v.trim() : v).transform((v) => typeof v === 'string' ? v.toLowerCase() : v)");
        });
    });

    describe('@bcm.rateLimit directive', () => {
        const RATE_LIMIT_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.rateLimit(max: 5, window: "30s")
model Submission {
  id    String @id @default(cuid())
  data  String
}
`;

        it('generates routes with per-route rate limiting middleware', async () => {
            const schema = parsePrismaAst(RATE_LIMIT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, RATE_LIMIT_SCHEMA);
            const routes = files.find((f) => f.path.endsWith('submission.routes.ts'))!;

            expect(routes.content).toContain('createRouteRateLimit');
            expect(routes.content).toContain('createRouteRateLimit(5, 30000)');
        });

        it('generates rate limit factory in middleware', async () => {
            const schema = parsePrismaAst(RATE_LIMIT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'middleware' }, RATE_LIMIT_SCHEMA);
            const middleware = files.find((f) => f.path.endsWith('rate-limit.middleware.ts'))!;

            expect(middleware.content).toContain('export function createRouteRateLimit');
            expect(middleware.content).toContain('windowMs');
        });
    });

    describe('@bcm.cursor directive', () => {
        const CURSOR_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.cursor(field: "createdAt")
model Event {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @unique @default(now())
}
`;

        it('generates cursor pagination endpoint in routes', async () => {
            const schema = parsePrismaAst(CURSOR_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, CURSOR_SCHEMA);
            const routes = files.find((f) => f.path.endsWith('event.routes.ts'))!;

            expect(routes.content).toContain("router.get('/cursor'");
            expect(routes.content).toContain('controller.listCursor');
        });

        it('generates findManyCursor in repository', async () => {
            const schema = parsePrismaAst(CURSOR_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, CURSOR_SCHEMA);
            const repo = files.find((f) => f.path.endsWith('event.repository.ts'))!;

            expect(repo.content).toContain('findManyCursor');
            expect(repo.content).toContain('createdAt');
            expect(repo.content).toContain('hasMore');
            expect(repo.content).toContain('nextCursor');
        });

        it('generates findManyCursor in service', async () => {
            const schema = parsePrismaAst(CURSOR_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, CURSOR_SCHEMA);
            const service = files.find((f) => f.path.endsWith('event.service.ts'))!;

            expect(service.content).toContain('findManyCursor');
        });

        it('generates listCursor in controller', async () => {
            const schema = parsePrismaAst(CURSOR_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, CURSOR_SCHEMA);
            const controller = files.find((f) => f.path.endsWith('event.controller.ts'))!;

            expect(controller.content).toContain('listCursor');
            expect(controller.content).toContain('cursor');
            expect(controller.content).toContain('pageSize');
            expect(controller.content).toContain('direction');
        });

        it('rejects cursor fields that are not single-field selectors', async () => {
            const raw = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.cursor(field: "createdAt")
model Event {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @default(now())
}
`;
            const schema = parsePrismaAst(raw);
            await expect(
                generateProject(schema, { ...defaultOptions, only: 'routes' }, raw)
            ).rejects.toThrow('@bcm.cursor(field: "createdAt")');
        });
    });
});

describe('Phase 3 — service-layer directives', () => {
    describe('@bcm.event directive', () => {
        const EVENT_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.event
model Order {
  id     String @id @default(cuid())
  amount Float
}
`;

        it('generates event-bus utility when any model has @bcm.event', async () => {
            const schema = parsePrismaAst(EVENT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'utils' }, EVENT_SCHEMA);
            const eventBus = files.find((f) => f.path.includes('event-bus'));
            expect(eventBus).toBeDefined();
            expect(eventBus!.content).toContain('TypedEventBus');
            expect(eventBus!.content).toContain('emit');
        });

        it('service emits events after mutations', async () => {
            const schema = parsePrismaAst(EVENT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, EVENT_SCHEMA);
            const service = files.find((f) => f.path.endsWith('order.service.ts'))!;
            expect(service.content).toContain("import { eventBus } from '../../utils/event-bus.js'");
            expect(service.content).toContain("eventBus.emit('Order', 'created'");
            expect(service.content).toContain("eventBus.emit('Order', 'updated'");
            expect(service.content).toContain("eventBus.emit('Order', 'deleted'");
        });

        it('does not generate event-bus when no model has @bcm.event', async () => {
            const schema = parsePrismaAst(BLOG_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'utils' }, BLOG_SCHEMA);
            const eventBus = files.find((f) => f.path.includes('event-bus'));
            expect(eventBus).toBeUndefined();
        });
    });

    describe('@bcm.audit directive', () => {
        const AUDIT_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.audit
model Invoice {
  id     String @id @default(cuid())
  total  Float
}
`;

        it('generates audit utility when any model has @bcm.audit', async () => {
            const schema = parsePrismaAst(AUDIT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'utils' }, AUDIT_SCHEMA);
            const audit = files.find((f) => f.path.includes('audit'));
            expect(audit).toBeDefined();
            expect(audit!.content).toContain('writeAuditLog');
        });

        it('service calls writeAuditLog after mutations', async () => {
            const schema = parsePrismaAst(AUDIT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, AUDIT_SCHEMA);
            const service = files.find((f) => f.path.endsWith('invoice.service.ts'))!;
            expect(service.content).toContain("import { writeAuditLog } from '../../utils/audit.js'");
            expect(service.content).toContain("action: 'CREATE'");
            expect(service.content).toContain("action: 'UPDATE'");
            expect(service.content).toContain("action: 'DELETE'");
            expect(service.content).toContain('changedBy');
        });

        it('controller threads changedBy to service', async () => {
            const schema = parsePrismaAst(AUDIT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, AUDIT_SCHEMA);
            const controller = files.find((f) => f.path.endsWith('invoice.controller.ts'))!;
            expect(controller.content).toContain('getChangedBy');
            expect(controller.content).toContain('this.getChangedBy(req)');
            expect(controller.content).toContain('user?.sub');
        });

        it('appends AuditLog model to cleaned prisma schema', async () => {
            const schema = parsePrismaAst(AUDIT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'prisma' }, AUDIT_SCHEMA);
            const prismaSchema = files.find((f) => f.path === 'prisma/schema.prisma')!;
            expect(prismaSchema.content).toContain('model AuditLog');
            expect(prismaSchema.content).toContain('recordId');
            expect(prismaSchema.content).toContain('changedBy');
        });

        it('service fetches before state on update for audit', async () => {
            const schema = parsePrismaAst(AUDIT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, AUDIT_SCHEMA);
            const service = files.find((f) => f.path.endsWith('invoice.service.ts'))!;
            expect(service.content).toContain('const before = await this.repo.findOne(key)');
        });
    });

    describe('@bcm.multitenancy directive', () => {
        const MULTI_TENANT_AUTH_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.authModel
model User {
  id       String @id @default(cuid())
  /// @bcm.identifier
  email    String @unique
  /// @bcm.password
  password String
  orgId    String
}

/// @bcm.multitenancy(field: "orgId")
/// @bcm.protected
/// @bcm.cursor(field: "id")
model Project {
  id    String @id @default(cuid())
  orgId String
  name  String
}
`;

        const MULTI_TENANT_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

/// @bcm.multitenancy(field: "orgId")
/// @bcm.protected
model Project {
  id    String @id @default(cuid())
  orgId String
  name  String
}
`;

        it('service accepts tenantId in findMany', async () => {
            const schema = parsePrismaAst(MULTI_TENANT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, MULTI_TENANT_SCHEMA);
            const service = files.find((f) => f.path.endsWith('project.service.ts'))!;
            expect(service.content).toContain('tenantId: string');
            expect(service.content).toContain('orgId: tenantId');
        });

        it('controller extracts tenantId from request', async () => {
            const schema = parsePrismaAst(MULTI_TENANT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, MULTI_TENANT_SCHEMA);
            const controller = files.find((f) => f.path.endsWith('project.controller.ts'))!;
            expect(controller.content).toContain('getTenantId');
            expect(controller.content).toContain('user.orgId');
        });

        it('excludes tenant field from create DTO', async () => {
            const schema = parsePrismaAst(MULTI_TENANT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, MULTI_TENANT_SCHEMA);
            const dto = files.find((f) => f.path.endsWith('project.dto.ts'))!;
            // orgId should not appear in CreateProjectSchema
            expect(dto.content).toContain('CreateProjectSchema');
            // The create schema should have 'name' but not 'orgId'
            const createBlock = dto.content.split('CreateProjectSchema')[1]?.split('export')[0] ?? '';
            expect(createBlock).not.toContain('orgId');
        });

        it('controller injects tenantId into create body', async () => {
            const schema = parsePrismaAst(MULTI_TENANT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, MULTI_TENANT_SCHEMA);
            const controller = files.find((f) => f.path.endsWith('project.controller.ts'))!;
            expect(controller.content).toContain('orgId: this.getTenantId(req)');
        });

        it('auth routes include tenant claims in generated JWT payloads', async () => {
            const schema = parsePrismaAst(MULTI_TENANT_AUTH_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'app' }, MULTI_TENANT_AUTH_SCHEMA);
            const authRoutes = files.find((f) => f.path === 'src/modules/auth/auth.routes.ts')!;

            expect(authRoutes.content).toContain('orgId: user.orgId');
        });

        it('controller and service scope cursor pagination by tenantId', async () => {
            const schema = parsePrismaAst(MULTI_TENANT_AUTH_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, MULTI_TENANT_AUTH_SCHEMA);
            const controller = files.find((f) => f.path.endsWith('project.controller.ts'))!;
            const service = files.find((f) => f.path.endsWith('project.service.ts'))!;

            expect(controller.content).toContain('service.findManyCursor(cursor, pageSize, direction, this.getTenantId(req))');
            expect(service.content).toContain('tenantId: string');
            expect(service.content).toContain('orgId: tenantId');
        });

        it('repository has findOneScoped method', async () => {
            const schema = parsePrismaAst(MULTI_TENANT_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, MULTI_TENANT_SCHEMA);
            const repo = files.find((f) => f.path.endsWith('project.repository.ts'))!;
            expect(repo.content).toContain('findOneScoped');
            expect(repo.content).toContain('tenantId: string');
        });
    });

    describe('upload file cleanup on delete', () => {
        const UPLOAD_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Attachment {
  id       String @id @default(cuid())
  /// @bcm.upload(dest: "attachments")
  filePath String
}
`;

        it('service fetches record and unlinks file on delete', async () => {
            const schema = parsePrismaAst(UPLOAD_SCHEMA);
            const files = await generateProject(schema, { ...defaultOptions, only: 'routes' }, UPLOAD_SCHEMA);
            const service = files.find((f) => f.path.endsWith('attachment.service.ts'))!;
            expect(service.content).toContain("import('fs/promises')");
            expect(service.content).toContain('unlink');
            expect(service.content).toContain('filePath');
        });
    });
});
