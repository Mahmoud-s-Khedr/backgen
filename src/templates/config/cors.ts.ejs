import type { CorsOptions } from 'cors';

// SECURITY: Set CORS_ORIGIN in your environment (e.g., https://your-frontend.com).
// In production, an unset CORS_ORIGIN disables cross-origin access entirely.
const origin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*');
// Browsers reject credentialed requests when Access-Control-Allow-Origin is "*".
const credentials = origin !== '*' && origin !== false;

if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn(
    'Warning: CORS_ORIGIN not set — cross-origin requests are disabled in production. ' +
    'Set CORS_ORIGIN in your environment to allow frontend access.'
  );
}

export const corsOptions: CorsOptions = {
  origin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials,
  maxAge: 86400,
};
