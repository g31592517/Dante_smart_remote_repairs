import { Router } from 'express';
import {
  assignSchema, cancelRequestSchema, changeStatusSchema, createSupportRequestSchema, internalNoteSchema, listRequestsQuery, messageSchema,
  progressUpdateSchema, reviewRequestSchema,
} from '@dante/shared';
import { authenticate, requireAuth } from '../../core/auth.js';
import { requestContext } from '../../core/audit.js';
import { created, idFrom, ok, pageMeta, parse } from '../../core/http.js';
import { requestDetail } from './support.detail.js';
import * as svc from './support.service.js';

export function supportRoutes() {
  const r = Router();
  r.use(authenticate);

  r.post('/', async (req, res) => {
    const input = parse(createSupportRequestSchema, req.body);
    const { id } = await svc.createRequest(requireAuth(req), input, requestContext(req));
    created(res, await requestDetail(requireAuth(req), id));
  });

  r.get('/', async (req, res) => {
    const q = parse(listRequestsQuery, req.query);
    const { items, total } = await svc.listRequests(requireAuth(req), q);
    ok(res, items, pageMeta(q.page, q.pageSize, total));
  });

  r.get('/:id', async (req, res) => ok(res, await requestDetail(requireAuth(req), idFrom(req))));

  r.post('/:id/review', async (req, res) => {
    const input = parse(reviewRequestSchema, req.body);
    await svc.reviewRequest(requireAuth(req), idFrom(req), input, requestContext(req));
    ok(res, await requestDetail(requireAuth(req), idFrom(req)));
  });

  r.post('/:id/assign', async (req, res) => {
    const { technicianUserId, note } = parse(assignSchema, req.body);
    await svc.assignTechnician(requireAuth(req), idFrom(req), technicianUserId, note, requestContext(req));
    ok(res, await requestDetail(requireAuth(req), idFrom(req)));
  });

  r.post('/:id/status', async (req, res) => {
    const input = parse(changeStatusSchema, req.body);
    await svc.changeStatus(requireAuth(req), idFrom(req), input, requestContext(req));
    ok(res, await requestDetail(requireAuth(req), idFrom(req)));
  });

  r.post('/:id/cancel', async (req, res) => {
    const { reason } = parse(cancelRequestSchema, req.body);
    await svc.cancelByCustomer(requireAuth(req), idFrom(req), reason, requestContext(req));
    ok(res, await requestDetail(requireAuth(req), idFrom(req)));
  });

  r.post('/:id/updates', async (req, res) => {
    const { message, visibleToCustomer } = parse(progressUpdateSchema, req.body);
    await svc.addProgressUpdate(requireAuth(req), idFrom(req), message, visibleToCustomer);
    ok(res, await requestDetail(requireAuth(req), idFrom(req)));
  });

  r.get('/:id/messages', async (req, res) => ok(res, await svc.listMessages(requireAuth(req), idFrom(req))));
  r.post('/:id/messages', async (req, res) => {
    const { body } = parse(messageSchema, req.body);
    created(res, await svc.postMessage(requireAuth(req), idFrom(req), body));
  });

  r.get('/:id/notes', async (req, res) => ok(res, await svc.listInternalNotes(requireAuth(req), idFrom(req))));
  r.post('/:id/notes', async (req, res) => {
    const { body } = parse(internalNoteSchema, req.body);
    created(res, await svc.addInternalNote(requireAuth(req), idFrom(req), body));
  });

  return r;
}
