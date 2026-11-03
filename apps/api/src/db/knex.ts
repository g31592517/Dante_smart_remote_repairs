import knexFactory, { type Knex } from 'knex';
import { env } from '../config/env.js';
import { migrationSource } from './migration-source.js';

export function knexConfig(overrides: Partial<Knex.ConnectionConfig> = {}): Knex.Config {
  return {
    client: 'mysql2',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      charset: 'utf8mb4',
      timezone: 'Z', // store and read DATETIME as UTC
      // DATE columns as 'YYYY-MM-DD' strings (calendar dates, no timezone shift); DATETIME as UTC Date objects
      dateStrings: ['DATE'],
      // BIGINT ids/amounts come back as JS numbers (all values are well below 2^53)
      supportBigNumbers: true,
      bigNumberStrings: false,
      decimalNumbers: true,
      ...overrides,
    } as unknown as Knex.MySql2ConnectionConfig, // knex's typing lags mysql2, which accepts dateStrings: string[]
    pool: {
      min: 0,
      max: env.DB_POOL_MAX,
      afterCreate(conn: { query: (sql: string, cb: (err: Error | null) => void) => void }, done: (err: Error | null, conn: unknown) => void) {
        conn.query("SET time_zone = '+00:00', SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION'", (err) =>
          done(err, conn),
        );
      },
    },
    migrations: { migrationSource, tableName: 'knex_migrations' },
  };
}

export const db: Knex = knexFactory(knexConfig());
export type Db = Knex | Knex.Transaction;
