/**
 * Database CLI:  migrate | rollback | seed [--demo] | reset
 *   seed       reference data (roles, permissions, service categories, default settings) — idempotent, safe in production
 *   seed --demo  also loads demo staff, customers, products and stock (refused when NODE_ENV=production)
 *   reset      drop everything and rebuild with demo data (refused when NODE_ENV=production)
 */
import { db } from './knex.js';
import { env } from '../config/env.js';
import { seedReference } from './seeds/reference.js';
import { seedDemo } from './seeds/demo.js';

async function main() {
  const [cmd, ...flags] = process.argv.slice(2);
  switch (cmd) {
    case 'migrate': {
      const [batch, files] = await db.migrate.latest();
      console.log(files.length ? `Batch ${batch}: ${files.join(', ')}` : 'Already up to date');
      break;
    }
    case 'rollback': {
      const [batch, files] = await db.migrate.rollback();
      console.log(files.length ? `Rolled back batch ${batch}: ${files.join(', ')}` : 'Nothing to roll back');
      break;
    }
    case 'seed': {
      await seedReference(db);
      console.log('Reference data seeded');
      if (flags.includes('--demo') || (env.NODE_ENV === 'development' && !flags.includes('--no-demo'))) {
        if (env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production');
        await seedDemo(db);
        console.log('Demo data seeded (see docs/04_SETUP.md for the demo accounts)');
      }
      break;
    }
    case 'reset': {
      if (env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
      await db.migrate.rollback(undefined, true);
      await db.migrate.latest();
      await seedReference(db);
      await seedDemo(db);
      console.log('Database rebuilt with reference and demo data');
      break;
    }
    default:
      console.log('Usage: cli.ts migrate | rollback | seed [--demo|--no-demo] | reset');
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
