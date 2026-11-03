import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, requireAuth } from '../../core/auth.js';
import { audit, requestContext } from '../../core/audit.js';
import { badRequest, forbidden, notFound } from '../../core/errors.js';
import { created, idFrom, parse } from '../../core/http.js';
import { readPrivateFile, savePrivateFile } from '../../core/storage.js';
import { db } from '../../db/knex.js';
import { loadRequestFor } from '../support/support.access.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 5 } });

const uploadSchema = z.object({
  supportRequestId: z.coerce.number().int().positive(),
  context: z.enum(['REQUEST', 'MESSAGE', 'INTAKE_PHOTO', 'REPORT', 'INTERNAL']).default('REQUEST'),
  contextId: z.coerce.number().int().positive().optional(),
});
const CUSTOMER_CONTEXTS = ['REQUEST', 'MESSAGE'];

export function attachmentRoutes() {
  const r = Router();
  r.use(authenticate);

  r.post('/', upload.array('files', 5), async (req, res) => {
    const auth = requireAuth(req);
    const input = parse(uploadSchema, req.body);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('Attach at least one file (form field "files")');
    const access = await loadRequestFor(auth, input.supportRequestId);
    if (access.isCustomerView && !CUSTOMER_CONTEXTS.includes(input.context)) throw forbidden();
    if (input.context === 'MESSAGE') {
      const msg = input.contextId ? await db('service_messages').where({ id: input.contextId, support_request_id: input.supportRequestId, sender_user_id: auth.userId }).first('id') : null;
      if (!msg) throw badRequest('Attach message files to a message you sent');
    }
    const saved = [];
    for (const f of files) {
      const stored = await savePrivateFile(f.buffer, f.originalname, { imagesOnly: input.context === 'INTAKE_PHOTO' });
      const [id] = await db('attachments').insert({
        support_request_id: input.supportRequestId,
        context: input.context,
        context_id: input.contextId ?? null,
        visible_to_customer: input.context !== 'INTERNAL',
        uploaded_by: auth.userId,
        original_name: f.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 255),
        mime_type: stored.mimeType,
        size_bytes: stored.sizeBytes,
        storage_key: stored.storageKey,
        sha256: stored.sha256,
      });
      saved.push({ id, name: f.originalname, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, context: input.context });
    }
    await audit({ actorUserId: auth.userId, action: 'attachment.uploaded', entityType: 'support_request', entityId: input.supportRequestId, metadata: { count: saved.length, context: input.context }, ...requestContext(req) });
    created(res, saved);
  });

  /** Streams a file only after checking the caller may see the owning request (and the file itself). */
  r.get('/:id', async (req, res) => {
    const auth = requireAuth(req);
    const a = await db('attachments').where({ id: idFrom(req) }).first();
    if (!a || !a.support_request_id) throw notFound('Attachment');
    const access = await loadRequestFor(auth, a.support_request_id);
    if (access.isCustomerView && !a.visible_to_customer) throw notFound('Attachment');
    const buf = await readPrivateFile(a.storage_key);
    const inline = /^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(a.mime_type) && req.query.download !== 'true';
    res.setHeader('Content-Type', a.mime_type);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(a.original_name)}"`);
    res.end(buf);
  });

  return r;
}
