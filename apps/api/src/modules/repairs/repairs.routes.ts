import { Router } from 'express';
import { z } from 'zod';
import {
  createQuotationSchema, diagnosticSchema, feedbackSchema, intakeSchema, quotationDecisionSchema, serviceReportSchema, workLogSchema,
} from '@dante/shared';
import { authenticate, requireAuth } from '../../core/auth.js';
import { requestContext } from '../../core/audit.js';
import { created, idFrom, ok, parse } from '../../core/http.js';
import { requestDetail } from '../support/support.detail.js';
import * as quotes from './quotations.service.js';
import * as repairs from './repairs.service.js';

/**
 * Repair & job-execution endpoints. `:requestId` is the support request the job belongs to; every
 * handler re-checks access to that request.
 */
export function repairRoutes() {
  const r = Router();
  r.use(authenticate);
  const detail = async (req: Parameters<typeof requireAuth>[0], requestId: number) => requestDetail(requireAuth(req), requestId);

  r.put('/:requestId/intake', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await repairs.recordIntake(requireAuth(req), id, parse(intakeSchema, req.body), requestContext(req));
    ok(res, await detail(req, id));
  });
  r.post('/:requestId/intake/acknowledge', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await repairs.acknowledgeIntake(requireAuth(req), id, requestContext(req));
    ok(res, await detail(req, id));
  });
  r.post('/:requestId/diagnostics', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await repairs.addDiagnostic(requireAuth(req), id, parse(diagnosticSchema, req.body));
    created(res, await detail(req, id));
  });
  r.post('/:requestId/work-logs', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await repairs.addWorkLog(requireAuth(req), id, parse(workLogSchema, req.body));
    created(res, await detail(req, id));
  });

  r.post('/:requestId/quotations', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await quotes.createQuotation(requireAuth(req), id, parse(createQuotationSchema, req.body), requestContext(req));
    created(res, await detail(req, id));
  });
  r.post('/quotations/:id/send', async (req, res) => {
    await quotes.sendQuotation(requireAuth(req), idFrom(req), requestContext(req));
    ok(res, { sent: true });
  });
  r.post('/quotations/:id/decision', async (req, res) => {
    const { decision, comment } = parse(quotationDecisionSchema, req.body);
    ok(res, await quotes.decideQuotation(requireAuth(req), idFrom(req), decision, comment, requestContext(req)));
  });

  r.post('/:requestId/parts', async (req, res) => {
    const id = idFrom(req, 'requestId');
    const body = parse(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(100), note: z.string().trim().min(3).max(500) }), req.body);
    created(res, await repairs.requestPart(requireAuth(req), id, body.productId, body.quantity, body.note, requestContext(req)));
  });
  r.post('/:requestId/parts/allocate', async (req, res) => {
    ok(res, await repairs.allocateWaitingParts(requireAuth(req), idFrom(req, 'requestId')));
  });
  r.post('/:requestId/parts/:partId/install', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await repairs.installPart(requireAuth(req), id, idFrom(req, 'partId'), requestContext(req));
    ok(res, await detail(req, id));
  });

  r.put('/:requestId/report', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await repairs.submitReport(requireAuth(req), id, parse(serviceReportSchema, req.body), requestContext(req));
    ok(res, await detail(req, id));
  });
  r.post('/:requestId/return', async (req, res) => {
    const id = idFrom(req, 'requestId');
    const { returnedTo } = parse(z.object({ returnedTo: z.string().trim().min(2).max(160) }), req.body);
    await repairs.recordReturn(requireAuth(req), id, returnedTo, requestContext(req));
    ok(res, await detail(req, id));
  });
  r.post('/:requestId/feedback', async (req, res) => {
    const id = idFrom(req, 'requestId');
    await repairs.submitFeedback(requireAuth(req), id, parse(feedbackSchema, req.body));
    created(res, await detail(req, id));
  });

  return r;
}
