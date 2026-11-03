import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './core/logger.js';
import { errorHandler, notFoundHandler, ok } from './core/http.js';
import { publicStorageDir } from './core/storage.js';
import { db } from './db/knex.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { accountRoutes } from './modules/users/account.routes.js';
import { organizationRoutes } from './modules/organizations/organizations.routes.js';
import { staffRoutes } from './modules/users/staff.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { supportRoutes } from './modules/support/support.routes.js';
import { remoteRoutes } from './modules/remote/remote.routes.js';
import { attachmentRoutes } from './modules/attachments/attachments.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { repairRoutes } from './modules/repairs/repairs.routes.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { cartRoutes } from './modules/orders/cart.routes.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { paymentRoutes, paymentWebhookRoutes } from './modules/payments/payments.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { docsRoutes } from './docs/docs.routes.js';

export interface AppOptions {
  /** requests per 15 minutes per IP on sign-in/registration/reset endpoints */
  authRateLimit?: number;
  /** requests per minute per IP across the API */
  apiRateLimit?: number;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.set('trust proxy', 1); // behind one reverse proxy (nginx/Caddy) in production
  app.disable('x-powered-by');

  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/v1/health' } }));
  app.use(
    helmet({
      // the API serves JSON; the docs page needs Swagger UI's inline assets
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // product images are embedded by the web app
    }),
  );
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: true, maxAge: 600 }));

  // Payment-gateway webhooks need the raw body for signature verification — mount before express.json.
  app.use('/api/v1/payments/webhooks', paymentWebhookRoutes());

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const apiLimiter = rateLimit({ windowMs: 60_000, limit: opts.apiRateLimit ?? (isTest ? 10_000 : 300), standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } }) });
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: opts.authRateLimit ?? (isTest ? 10_000 : 20), standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } }) });

  // Public catalogue images (never customer uploads — those are private and served via /attachments).
  app.use('/media', express.static(path.resolve(publicStorageDir()), { fallthrough: false, immutable: true, maxAge: '30d', index: false }));

  const v1 = Router();
  v1.use(apiLimiter);
  v1.get('/health', async (_req, res) => {
    await db.raw('SELECT 1');
    ok(res, { status: 'ok', time: new Date().toISOString() });
  });
  v1.use('/auth', authRoutes(authLimiter));
  v1.use('/account', accountRoutes());
  v1.use('/organizations', organizationRoutes());
  v1.use('/staff', staffRoutes());
  v1.use('/settings', settingsRoutes());
  v1.use('/requests', supportRoutes());
  v1.use('/remote-sessions', remoteRoutes());
  v1.use('/attachments', attachmentRoutes());
  v1.use('/notifications', notificationRoutes());
  v1.use('/repairs', repairRoutes());
  v1.use('/catalog', catalogRoutes());
  v1.use('/inventory', inventoryRoutes());
  v1.use('/cart', cartRoutes());
  v1.use('/orders', orderRoutes());
  v1.use('/payments', paymentRoutes());
  v1.use('/reports', reportRoutes());
  app.use('/api/v1', v1);
  app.use('/api/docs', docsRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
