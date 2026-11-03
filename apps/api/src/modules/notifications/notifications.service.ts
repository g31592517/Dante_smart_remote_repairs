import type { Knex } from 'knex';
import { db, type Db } from '../../db/knex.js';
import { env, isTest } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { emailChannel, smsChannel, whatsappChannel, type Channel } from './channels.js';

export interface NotifyInput {
  userIds: number[];
  type: string; // REQUEST_SUBMITTED, TECHNICIAN_ASSIGNED, QUOTATION_SENT, ...
  title: string;
  body: string;
  /** path inside the web app, e.g. /account/requests/12 */
  link?: string;
  email?: boolean; // default true
}

const MAX_ATTEMPTS = 5;

/**
 * Creates in-app notifications (always) and queues external deliveries. External delivery happens
 * after the surrounding transaction commits and never blocks or fails the business operation.
 */
export async function notify(input: NotifyInput, conn: Db = db): Promise<void> {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (!userIds.length) return;
  const users = await conn('users').whereIn('id', userIds).where('is_active', true).select('id', 'email');
  for (const u of users) {
    const [notificationId] = await conn('notifications').insert({
      user_id: u.id,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 2000),
      link: input.link ?? null,
    });
    if (input.email !== false) {
      await conn('notification_deliveries').insert({
        notification_id: notificationId,
        channel: 'EMAIL',
        recipient: u.email,
        status: emailChannel.configured ? 'PENDING' : 'SKIPPED',
        last_error: emailChannel.configured ? null : 'E-mail transport not configured',
      });
    }
  }
  afterCommit(conn, () => void dispatchPendingDeliveries().catch((err) => logger.error({ err }, 'notification dispatch failed')));
}

/** Run `fn` once the transaction commits (immediately when not in a transaction). */
export function afterCommit(conn: Db, fn: () => void) {
  const trx = conn as Knex.Transaction;
  if (typeof trx.isTransaction === 'boolean' && trx.isTransaction && trx.executionPromise) {
    trx.executionPromise.then(fn, () => undefined);
  } else {
    setImmediate(fn);
  }
}

const channels: Record<string, Channel> = { EMAIL: emailChannel, SMS: smsChannel, WHATSAPP: whatsappChannel };
let running: Promise<number> | null = null;

/** Sends due deliveries. Safe to call concurrently (calls are coalesced). Returns how many were attempted. */
export function dispatchPendingDeliveries(): Promise<number> {
  running ??= (async () => {
    try {
      const due = await db('notification_deliveries as d')
        .join('notifications as n', 'n.id', 'd.notification_id')
        .whereIn('d.status', ['PENDING', 'FAILED'])
        .where('d.attempts', '<', MAX_ATTEMPTS)
        .orderBy('d.id')
        .limit(50)
        .select('d.id', 'd.channel', 'd.recipient', 'd.attempts', 'd.status', 'd.updated_at', 'n.title', 'n.body', 'n.link');
      let attempted = 0;
      for (const d of due) {
        // exponential back-off for failures: 1, 2, 4, 8 minutes
        if (d.status === 'FAILED' && Date.now() - new Date(d.updated_at).getTime() < 60_000 * 2 ** (d.attempts - 1)) continue;
        const channel = channels[d.channel];
        if (!channel) continue;
        attempted++;
        const url = d.link ? `${env.APP_URL}${d.link}` : env.APP_URL;
        try {
          const result = await channel.send({
            to: d.recipient,
            subject: d.title,
            text: `${d.body}\n\nView details: ${url}\n\n— ${'This is an automated message.'}`,
            html: renderEmail(d.title, d.body, url),
          });
          await db('notification_deliveries').where({ id: d.id }).update({
            status: 'SENT', provider: result.provider, provider_message_id: result.providerMessageId ?? null,
            attempts: d.attempts + 1, sent_at: db.fn.now(3), last_error: null,
          });
        } catch (err) {
          await db('notification_deliveries').where({ id: d.id }).update({
            status: 'FAILED', attempts: d.attempts + 1, last_error: String((err as Error).message).slice(0, 1000),
          });
        }
      }
      return attempted;
    } finally {
      running = null;
    }
  })();
  return running;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function renderEmail(title: string, body: string, url: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6fb;padding:24px">
<table role="presentation" width="100%" style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px">
<tr><td><h2 style="color:#0b1f3a;margin:0 0 12px">${escapeHtml(title)}</h2>
<p style="color:#333;line-height:1.5;white-space:pre-line">${escapeHtml(body)}</p>
<p><a href="${escapeHtml(url)}" style="background:#0e9f8e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">View details</a></p>
</td></tr></table></body></html>`;
}

let timer: NodeJS.Timeout | undefined;
/** Background retry loop for failed deliveries (not started in tests). */
export function startDeliveryWorker(intervalMs = 60_000) {
  if (isTest || timer) return;
  timer = setInterval(() => void dispatchPendingDeliveries().catch(() => undefined), intervalMs);
  timer.unref();
}

/* ---------------- in-app notification queries ---------------- */

export async function listNotifications(userId: number, unreadOnly: boolean, limit = 50) {
  const q = db('notifications').where({ user_id: userId }).orderBy('id', 'desc').limit(limit);
  if (unreadOnly) q.whereNull('read_at');
  const rows = await q.select('id', 'type', 'title', 'body', 'link', 'read_at', 'created_at');
  const unread = await db('notifications').where({ user_id: userId }).whereNull('read_at').count({ n: '*' }).first();
  return {
    items: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, readAt: r.read_at, createdAt: r.created_at })),
    unreadCount: Number(unread?.n ?? 0),
  };
}

export async function markRead(userId: number, ids: number[] | 'all') {
  const q = db('notifications').where({ user_id: userId }).whereNull('read_at');
  if (ids !== 'all') q.whereIn('id', ids);
  await q.update({ read_at: db.fn.now(3) });
}
