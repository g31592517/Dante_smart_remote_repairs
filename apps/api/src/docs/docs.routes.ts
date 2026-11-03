import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './openapi.js';

export function docsRoutes() {
  const r = Router();
  const doc = buildOpenApiDocument();
  r.get('/openapi.json', (_req, res) => res.json(doc));
  r.use('/', swaggerUi.serve, swaggerUi.setup(doc, { customSiteTitle: 'Dante API documentation' }));
  return r;
}
