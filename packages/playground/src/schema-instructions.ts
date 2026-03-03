export interface InstructionSection {
    id: 'start' | 'models' | 'directives' | 'examples';
    label: string;
    intro: string;
    bullets: string[];
    code?: string;
}

export interface SchemaExample {
    id: 'starter' | 'todo' | 'blog' | 'auth';
    label: string;
    description: string;
    schema: string;
}

export const SCHEMA_EXAMPLES: SchemaExample[] = [
    {
        id: 'starter',
        label: 'Starter',
        description: 'Minimal valid Prisma skeleton.',
        schema: `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
`,
    },
    {
        id: 'todo',
        label: 'Todo',
        description: 'Simple model with searchable title.',
        schema: `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Todo {
  id        String   @id @default(cuid())
  /// @bcm.searchable
  title     String
  done      Boolean  @default(false)
  /// @bcm.readonly
  createdAt DateTime @default(now())
}
`,
    },
    {
        id: 'blog',
        label: 'Blog',
        description: 'User and Post with nested relation create.',
        schema: `datasource db {
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
  content  String?
  authorId String
  /// @bcm.nested
  author   User   @relation(fields: [authorId], references: [id])
}
`,
    },
    {
        id: 'auth',
        label: 'Auth + RBAC',
        description: 'Login model and protected role-based resource.',
        schema: `datasource db {
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

/// @bcm.authModel
model User {
  id       String @id @default(uuid())
  /// @bcm.identifier
  email    String @unique
  /// @bcm.password
  password String
  role     Role   @default(USER)
}

/// @bcm.auth(roles: [ADMIN])
model AdminLog {
  id        String   @id @default(cuid())
  action    String
  createdAt DateTime @default(now())
}
`,
    },
];

export const INSTRUCTION_SECTIONS: InstructionSection[] = [
    {
        id: 'start',
        label: 'Start',
        intro: 'Use a valid Prisma base first, then add models.',
        bullets: [
            'Always include both datasource and generator blocks.',
            'Use triple-slash comments for directives: /// @bcm.*',
            'Run generation often to catch schema issues early.',
        ],
        code: SCHEMA_EXAMPLES[0].schema,
    },
    {
        id: 'models',
        label: 'Models',
        intro: 'Build createable models with explicit defaults and relations.',
        bullets: [
            'Required scalar fields without defaults become required in create input.',
            'Use @default(now()) / @updatedAt / @default(cuid()) for server-managed values.',
            'For required FK fields you hide, provide a nested relation input path with @bcm.nested.',
        ],
    },
    {
        id: 'directives',
        label: 'Directives',
        intro: 'Place directives exactly where the parser expects them.',
        bullets: [
            '@bcm.hidden: remove from write and response.',
            '@bcm.readonly: remove from write, keep in response.',
            '@bcm.writeOnly and @bcm.password: allow input, hide from output.',
            '@bcm.protected / @bcm.auth / @bcm.authModel are model-level and must be above model declarations.',
        ],
        code: `/// @bcm.authModel
model User {
  id       String @id @default(uuid())
  /// @bcm.identifier
  email    String @unique
  /// @bcm.password
  password String
  role     Role   @default(USER)
}`,
    },
    {
        id: 'examples',
        label: 'Examples',
        intro: 'Insert a full example from quick actions to start faster.',
        bullets: [
            'Starter: baseline schema only.',
            'Todo: basic CRUD with searchable and readonly fields.',
            'Blog: relation and nested create/connect.',
            'Auth + RBAC: login model and role-protected model.',
        ],
    },
];

export const COMMON_MISTAKES = [
    'Model-level directives must be directly above model declarations.',
    'Field directives must be directly above the field they control.',
    'RBAC requires one @bcm.authModel with @bcm.identifier, @bcm.password, and scalar role field.',
    'A hidden required FK without a nested path causes generation failure.',
];
