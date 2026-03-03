import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { runCliGenerate, type CliRunnerConfig } from './cli-runner.js';
import {
    MAX_RESPONSE_BYTES,
    SCHEMA_MAX_BYTES,
    buildSchemaHash,
    createRateLimitMiddleware,
    isResponseTooLarge,
    validateGenerateRequestPayload,
} from './security.js';
import type { CliGenerateResult } from './types.js';

interface AppOptions {
    cliRunnerConfig: CliRunnerConfig;
    runGenerate?: typeof runCliGenerate;
    isProduction?: boolean;
    clientDistDir?: string;
    maxResponseBytes?: number;
    schemaMaxBytes?: number;
    rateLimitMaxRequests?: number;
    rateLimitWindowMs?: number;
}

function mapErrorStatus(result: CliGenerateResult): number {
    if (result.success) return 200;
    if (result.error.message.toLowerCase().includes('timed out')) return 504;
    if (result.error.stage === 'parse' || result.error.stage === 'generate') return 422;
    return 500;
}

function sendError(res: Response, status: number, message: string): void {
    res.status(status).json({
        success: false,
        error: {
            stage: 'unknown',
            message,
        },
    });
}

export function createApp(options: AppOptions) {
    const app = express();
    const runGenerate = options.runGenerate ?? runCliGenerate;
    const clientDistDir = options.clientDistDir ?? join(process.cwd(), 'dist/client');
    const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    const schemaMaxBytes = options.schemaMaxBytes ?? SCHEMA_MAX_BYTES;
    const jsonLimit = `${Math.max(Math.floor(schemaMaxBytes / 1024), 1)}kb`;

    app.disable('x-powered-by');
    app.use(express.json({ limit: jsonLimit }));
    app.use((error: unknown, _req: Request, res: Response, next: (value?: unknown) => void) => {
        if (error && typeof error === 'object' && 'type' in error && (error as { type?: string }).type === 'entity.too.large') {
            sendError(res, 413, `schema exceeds maximum size of ${schemaMaxBytes} bytes.`);
            return;
        }

        if (error instanceof SyntaxError) {
            sendError(res, 400, 'Invalid JSON body.');
            return;
        }

        next(error);
    });
    app.use(createRateLimitMiddleware(options.rateLimitMaxRequests, options.rateLimitWindowMs));

    app.get('/health', (_req, res) => {
        res.status(200).json({ ok: true });
    });

    app.post('/api/generate', async (req: Request, res: Response) => {
        const requestId = randomUUID();
        const validation = validateGenerateRequestPayload(req.body);
        if (!validation.ok) {
            sendError(res, validation.status, validation.message);
            return;
        }

        const { schema, options: generateOptions } = validation.value;
        const schemaHash = buildSchemaHash(schema);
        const startedAt = Date.now();

        try {
            const result = await runGenerate(
                {
                    schema,
                    only: generateOptions?.only,
                },
                options.cliRunnerConfig
            );

            if (result.success && isResponseTooLarge(result, maxResponseBytes)) {
                sendError(res, 413, `Generated response exceeds ${maxResponseBytes} bytes.`);
                return;
            }

            const status = mapErrorStatus(result);
            res.status(status).json(result);

            const durationMs = Date.now() - startedAt;
            const fileCount = result.success ? result.files.length : 0;
            console.info(JSON.stringify({
                event: 'generate',
                requestId,
                ip: req.ip,
                schemaHash,
                schemaBytes: Buffer.byteLength(schema, 'utf8'),
                status,
                durationMs,
                fileCount,
                success: result.success,
            }));
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            console.error(JSON.stringify({
                event: 'generate-error',
                requestId,
                ip: req.ip,
                schemaHash,
                durationMs,
                message: error instanceof Error ? error.message : String(error),
            }));
            sendError(res, 500, 'Failed to execute generator CLI.');
        }
    });

    if (options.isProduction) {
        app.use(express.static(clientDistDir));
        app.get('*', (_req, res) => {
            res.sendFile(join(clientDistDir, 'index.html'));
        });
    }

    return app;
}
