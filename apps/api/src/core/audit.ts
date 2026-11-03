import type { Request } from 'express';
import type { Db } from '../db/knex.js';
import { db } from '../db/knex.js';

export interface AuditEntry {
  actorUserId?: number | null;
  action: string; // e.g. auth.login, quotation.approved, inventory.adjusted
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/** Append-only audit trail for sensitive operations. Pass the transaction when inside one. */
export async function audit(entry: AuditEntry, conn: Db = db): Promise<void> {
  await conn('audit_logs').insert({
    actor_user_id: entry.actorUserId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    ip: entry.ip ?? null,
    user_agent: entry.userAgent?.slice(0, 255) ?? null,
  });
}

export function requestContext(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}
