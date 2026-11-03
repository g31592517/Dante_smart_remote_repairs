import type { NextFunction, Request, Response } from 'express';
import { z, ZodError, type ZodType } from 'zod';
import type { PageMeta } from '@dante/shared';
import { AppError, badRequest } from './errors.js';
import { logger } from './logger.js';

export function ok<T>(res: Response, data: T, meta?: PageMeta, status = 200) {
  return res.status(status).json(meta ? { data, meta } : { data });
}
export function created<T>(res: Response, data: T) {
  return ok(res, data, undefined, 201);
}

function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Parse with a zod schema, turning failures into a 400 with field-level details. */
export function parse<S extends ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest('The submitted data is invalid', zodDetails(r.error));
  return r.data;
}

export function idFrom(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

/** The single place errors become HTTP responses. Internal details are never leaked to clients. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The submitted data is invalid', details: zodDetails(err) } });
  }
  const e = err as { type?: string; code?: string; status?: number; message?: string };
  if (e?.type === 'entity.too.large' || e?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The upload or request body is too large' } });
  }
  if (e?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' } });
  }
  if (e?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total };
}
