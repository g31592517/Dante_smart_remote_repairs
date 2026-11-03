import { afterAll } from 'vitest';

// Close the MySQL pool after each test file so the worker can exit.
afterAll(async () => {
  const { db } = await import('../src/db/knex.js');
  await db.destroy();
});
