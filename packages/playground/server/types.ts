export const ALLOWED_ONLY_VALUES = [
    'routes',
    'config',
    'middleware',
    'utils',
    'app',
    'infra',
    'prisma',
    'swagger',
] as const;

export type GenerateOnlyValue = (typeof ALLOWED_ONLY_VALUES)[number];

export interface GenerateApiRequest {
    schema: string;
    options?: {
        only?: GenerateOnlyValue;
    };
}

export interface CliGeneratedFile {
    path: string;
    content: string;
    sizeBytes: number;
}

export interface CliGenerateSuccess {
    success: true;
    warnings: string[];
    modelCount: number;
    enumCount: number;
    files: CliGeneratedFile[];
    generatedAt: string;
    endpointCount?: number;
}

export interface CliGenerateFailure {
    success: false;
    error: {
        stage: 'parse' | 'generate' | 'write' | 'unknown';
        message: string;
    };
}

export type CliGenerateResult = CliGenerateSuccess | CliGenerateFailure;

export interface CliRunnerRequest {
    schema: string;
    only?: GenerateOnlyValue;
}
