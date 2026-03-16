import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    type: 'rate-limit-exceeded',
    title: 'Too Many Requests',
    status: 429,
    detail: 'You have exceeded the rate limit. Please try again later.',
  },
});

/**
 * Create a per-route rate limiter with custom limits.
 * Use for sensitive or expensive endpoints via @bcm.rateLimit directive.
 */
export function createRouteRateLimit(max: number, windowMs: number) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      type: 'rate-limit-exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'You have exceeded the rate limit. Please try again later.',
    },
  });
}
