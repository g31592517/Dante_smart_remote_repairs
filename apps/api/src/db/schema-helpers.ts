import type { Knex } from 'knex';

/** Shared column helpers. All DATETIMEs are UTC with millisecond precision. */
export function stamps(t: Knex.CreateTableBuilder, knex: Knex) {
  t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
  t.dateTime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'));
}
export const fk = (t: Knex.CreateTableBuilder, col: string, table: string, opts: { nullable?: boolean; onDelete?: string } = {}) => {
  const c = t.bigInteger(col).unsigned();
  if (opts.nullable) c.nullable();
  else c.notNullable();
  c.references('id').inTable(table).onDelete(opts.onDelete ?? 'RESTRICT');
  return c;
};

