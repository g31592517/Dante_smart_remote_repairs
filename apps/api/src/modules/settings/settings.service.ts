import type { SettingsUpdate } from '@dante/shared';
import { db, type Db } from '../../db/knex.js';
import { audit } from '../../core/audit.js';
import { DEFAULT_SETTINGS, PUBLIC_SETTING_KEYS, type PlatformSettings } from './settings.defaults.js';

let cache: { value: PlatformSettings; at: number } | null = null;
const TTL_MS = 30_000;

/**
 * mysql2 decodes JSON columns itself, so the value is already the stored JS value. It is deliberately
 * NOT parsed again: a text setting such as "123456" must stay a string.
 */
function parseValue(raw: unknown) {
  return raw;
}

export async function getSettings(conn: Db = db, fresh = false): Promise<PlatformSettings> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS && conn === db) return cache.value;
  const rows = await conn('system_settings').select('key', 'value');
  const merged = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = parseValue(r.value);
  const value = merged as unknown as PlatformSettings;
  if (conn === db) cache = { value, at: Date.now() };
  return value;
}

export async function getPublicSettings() {
  const s = await getSettings();
  return Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, s[k]]));
}

export async function updateSettings(patch: SettingsUpdate, actorUserId: number) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  await db.transaction(async (trx) => {
    for (const [key, value] of entries) {
      await trx('system_settings')
        .insert({ key, value: JSON.stringify(value), updated_by: actorUserId })
        .onConflict('key')
        .merge(['value', 'updated_by']);
    }
    // a changed consent text must carry a new version so earlier consents remain attributable
    await audit({ actorUserId, action: 'settings.updated', metadata: { keys: entries.map(([k]) => k) } }, trx);
  });
  cache = null;
  return getSettings(db, true);
}

export function currencyOf(s: PlatformSettings) {
  return { code: s.currencyCode, minorDigits: s.currencyMinorDigits };
}

/** For tests. */
export function clearSettingsCache() {
  cache = null;
}
