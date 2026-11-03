import type { Db } from '../db/knex.js';

export type ReferencePrefix = 'SR' | 'QT' | 'ORD' | 'PAY' | 'PO';

/**
 * Human-readable, gap-free, year-scoped references such as SR-2026-000042.
 * Must be called inside the transaction that inserts the record, so a rollback does not burn a number.
 */
export async function nextReference(trx: Db, prefix: ReferencePrefix, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  await trx.raw(
    'INSERT INTO reference_sequences (name, year, value) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)',
    [prefix, year],
  );
  const row = await trx('reference_sequences').where({ name: prefix, year }).first('value').forUpdate();
  return `${prefix}-${year}-${String(row.value).padStart(6, '0')}`;
}
