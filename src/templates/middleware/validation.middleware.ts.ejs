import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Validation middleware factory.
 * Validates request body or query params against a Zod schema.
 */
export function validate(schema: ZodSchema, source: 'body' | 'query' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = source === 'body' ? req.body : req.query;
    const result = schema.safeParse(data);

    if (!result.success) {
      next(result.error);
      return;
    }

    if (source === 'body') {
      req.body = result.data;
    }
    next();
  };
}
