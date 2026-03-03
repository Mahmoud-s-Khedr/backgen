import type { GeneratedFile } from '../../../src/parser/types.js';

export type { GeneratedFile };

export interface GenerationResult {
    files: GeneratedFile[];
    warnings: string[];
    errors: string[];
    modelCount: number;
    enumCount: number;
}

interface GenerateApiSuccess {
    success: true;
    warnings: string[];
    modelCount: number;
    enumCount: number;
    files: Array<{ path: string; content: string; sizeBytes: number }>;
    generatedAt: string;
    endpointCount?: number;
}

interface GenerateApiFailure {
    success: false;
    error: {
        stage: 'parse' | 'generate' | 'write' | 'unknown';
        message: string;
    };
}

type GenerateApiResponse = GenerateApiSuccess | GenerateApiFailure;

const EMPTY_RESULT: Omit<GenerationResult, 'errors'> = {
    files: [],
    warnings: [],
    modelCount: 0,
    enumCount: 0,
};

export async function generateFromSchema(
    schemaContent: string,
    options: { only?: string } = {}
): Promise<GenerationResult> {
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                schema: schemaContent,
                options,
            }),
        });

        const payload = await response.json() as GenerateApiResponse;
        if (!response.ok || !payload.success) {
            const message = payload.success
                ? `Generation request failed with status ${response.status}`
                : payload.error.message;
            return {
                ...EMPTY_RESULT,
                errors: [message],
            };
        }

        return {
            files: payload.files.map((file) => ({ path: file.path, content: file.content })),
            warnings: payload.warnings,
            errors: [],
            modelCount: payload.modelCount,
            enumCount: payload.enumCount,
        };
    } catch (error) {
        return {
            ...EMPTY_RESULT,
            errors: [error instanceof Error ? error.message : String(error)],
        };
    }
}
