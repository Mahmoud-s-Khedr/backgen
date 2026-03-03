import type { RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { ALLOWED_ONLY_VALUES, type GenerateApiRequest } from './types.js';

export const SCHEMA_MAX_BYTES = 300 * 1024;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;

interface RateBucket {
    count: number;
    resetAt: number;
}

export function createRateLimitMiddleware(
    maxRequests = RATE_LIMIT_MAX_REQUESTS,
    windowMs = RATE_LIMIT_WINDOW_MS
): RequestHandler {
    const buckets = new Map<string, RateBucket>();

    return (req, res, next) => {
        const now = Date.now();

        for (const [key, existingBucket] of buckets) {
            if (existingBucket.resetAt <= now) {
                buckets.delete(key);
            }
        }

        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const bucket = buckets.get(ip);

        if (!bucket || now > bucket.resetAt) {
            buckets.set(ip, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (bucket.count >= maxRequests) {
            res.status(429).json({
                success: false,
                error: {
                    stage: 'unknown',
                    message: 'Rate limit exceeded. Please try again shortly.',
                },
            });
            return;
        }

        bucket.count += 1;
        next();
    };
}

export function validateGenerateRequestPayload(payload: unknown): {
    ok: true;
    value: GenerateApiRequest;
} | {
    ok: false;
    status: number;
    message: string;
} {
    if (!payload || typeof payload !== 'object') {
        return {
            ok: false,
            status: 400,
            message: 'Request body must be a JSON object.',
        };
    }

    const value = payload as GenerateApiRequest;
    if (typeof value.schema !== 'string' || value.schema.trim().length === 0) {
        return {
            ok: false,
            status: 400,
            message: 'schema must be a non-empty string.',
        };
    }

    const schemaBytes = Buffer.byteLength(value.schema, 'utf8');
    if (schemaBytes > SCHEMA_MAX_BYTES) {
        return {
            ok: false,
            status: 413,
            message: `schema exceeds maximum size of ${SCHEMA_MAX_BYTES} bytes.`,
        };
    }

    if (value.options?.only && !ALLOWED_ONLY_VALUES.includes(value.options.only)) {
        return {
            ok: false,
            status: 400,
            message: `options.only must be one of: ${ALLOWED_ONLY_VALUES.join(', ')}`,
        };
    }

    return { ok: true, value };
}

export function buildSchemaHash(schema: string): string {
    return createHash('sha256').update(schema, 'utf8').digest('hex').slice(0, 12);
}

export function isResponseTooLarge(payload: unknown, maxBytes = MAX_RESPONSE_BYTES): boolean {
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    return bytes > maxBytes;
}
