import { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

/**
 * Setup Swagger UI to serve API documentation at /api/docs.
 */
export function setupSwagger(app: Express): void {
  const specPath = join(process.cwd(), 'openapi.json');

  if (!existsSync(specPath)) {
    logger.warn('openapi.json not found, Swagger UI disabled');
    return;
  }

  try {
    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, {
      customSiteTitle: 'API Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
    }));
    logger.info('Swagger UI available at /api/docs');
  } catch (error) {
    logger.error({ error }, 'Failed to load OpenAPI spec');
  }
}
