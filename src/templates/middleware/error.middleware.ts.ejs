import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger.js';

/**
 * RFC 7807 Problem Detail for HTTP APIs.
 */
export class ProblemDetail extends Error {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;

  constructor(opts: { type: string; title: string; status: number; detail: string; instance?: string }) {
    super(opts.detail);
    this.type = opts.type;
    this.title = opts.title;
    this.status = opts.status;
    this.detail = opts.detail;
    this.instance = opts.instance;
    this.name = 'ProblemDetail';
  }
}

/** Prisma error code to HTTP response mapping */
const PRISMA_ERROR_MAP: Record<string, { status: number; type: string; title: string; detail: string }> = {
  P2000: { status: 422, type: 'value-too-long', title: 'Value Too Long', detail: 'The provided value is too long for the column.' },
  P2002: { status: 409, type: 'unique-constraint', title: 'Unique Constraint Violation', detail: 'A record with this value already exists.' },
  P2003: { status: 422, type: 'foreign-key-constraint', title: 'Foreign Key Constraint Violation', detail: 'A related record was not found.' },
  P2005: { status: 422, type: 'invalid-field-value', title: 'Invalid Field Value', detail: 'The stored value is invalid for the field type.' },
  P2006: { status: 422, type: 'invalid-value', title: 'Invalid Value', detail: 'The provided value is invalid for the field type.' },
  P2011: { status: 422, type: 'null-constraint', title: 'Null Constraint Violation', detail: 'A required field received a null value.' },
  P2014: { status: 422, type: 'relation-violation', title: 'Required Relation Violation', detail: 'A required relation is missing or invalid.' },
  P2021: { status: 500, type: 'table-not-found', title: 'Table Not Found', detail: 'The underlying table does not exist. Run migrations.' },
  P2025: { status: 404, type: 'not-found', title: 'Not Found', detail: 'The requested record was not found.' },
};

/**
 * Global error handling middleware.
 * Converts errors to RFC 7807 Problem Detail responses.
 */
export function errorMiddleware(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Already a ProblemDetail
  if (err instanceof ProblemDetail) {
    res.status(err.status).json({
      type: err.type,
      title: err.title,
      status: err.status,
      detail: err.detail,
      instance: err.instance || req.originalUrl,
    });
    return;
  }

  // Zod validation error
  if (err instanceof ZodError) {
    res.status(422).json({
      type: 'validation-error',
      title: 'Validation Error',
      status: 422,
      detail: 'Request validation failed.',
      instance: req.originalUrl,
      errors: err.issues.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    });
    return;
  }

  // Prisma known request error
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_ERROR_MAP[err.code];
    if (mapped) {
      // Extract field info from Prisma error metadata
      const meta = err.meta as Record<string, unknown> | undefined;
      const target = (meta?.target as string[]) ?? [];
      const fieldName = (meta?.field_name as string) ?? target[0];
      const detail = fieldName
        ? `${mapped.detail} Field: '${fieldName}'.`
        : mapped.detail;

      res.status(mapped.status).json({
        type: mapped.type,
        title: mapped.title,
        status: mapped.status,
        detail,
        instance: req.originalUrl,
        ...(target.length > 0 && { fields: target }),
      });
      return;
    }
  }

  // Unknown error
  logger.error({ err, url: req.originalUrl, method: req.method }, 'Unhandled error');
  res.status(500).json({
    type: 'internal-server-error',
    title: 'Internal Server Error',
    status: 500,
    detail: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred.',
    instance: req.originalUrl,
  });
}
