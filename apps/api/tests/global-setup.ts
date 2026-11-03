/** Rebuilds the test database once per run: full rollback, migrate, reference + demo seed. */
export default async function setup() {
  await import('./setup-env.js');
  const { db } = await import('../src/db/knex.js');
  const { seedReference } = await import('../src/db/seeds/reference.js');
  const { seedDemo } = await import('../src/db/seeds/demo.js');
  const { rm } = await import('node:fs/promises');
  await rm('./test-storage', { recursive: true, force: true });
  await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  await seedReference(db);
  await seedDemo(db);
  await db.destroy();
}
