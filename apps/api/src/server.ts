import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { db } from './db/knex.js';
import { ensureStorageDirs } from './core/storage.js';
import { startDeliveryWorker } from './modules/notifications/notifications.service.js';
import { startOrderExpiryWorker } from './modules/orders/orders.service.js';

async function main() {
  await db.raw('SELECT 1'); // fail fast if MySQL is unreachable
  const [, pending] = (await db.migrate.list()) as [unknown, unknown[]];
  if (pending.length) logger.warn(`${pending.length} database migration(s) pending — run "npm run db:migrate"`);
  await ensureStorageDirs();
  startDeliveryWorker();
  startOrderExpiryWorker();
  const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (${env.NODE_ENV})`));

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => void db.destroy().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
