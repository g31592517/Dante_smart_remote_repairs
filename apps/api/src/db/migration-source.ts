import type { Knex } from 'knex';
import * as m001 from './migrations/20261103_001_identity.js';
import * as m002 from './migrations/20261103_002_support.js';
import * as m003 from './migrations/20261103_003_store.js';
import * as m004 from './migrations/20261103_004_repairs.js';
import * as m005 from './migrations/20261103_005_payments.js';

/**
 * Explicit, ordered migration list. Using static imports (instead of knex scanning a directory) means
 * migrations work the same under tsx, Vitest and the bundled production build in dist/.
 * ADD NEW MIGRATIONS TO THE END OF THIS LIST.
 */
const MIGRATIONS: Record<string, Knex.Migration> = {
  '20261103_001_identity': m001,
  '20261103_002_support': m002,
  '20261103_003_store': m003,
  '20261103_004_repairs': m004,
  '20261103_005_payments': m005,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(MIGRATIONS),
  getMigrationName: (name) => name,
  getMigration: async (name) => MIGRATIONS[name]!,
};
