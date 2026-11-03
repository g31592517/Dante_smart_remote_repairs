import type { ApiErrorCode } from '@dante/shared';

/** Domain/HTTP error. Thrown anywhere; rendered by the error middleware as the standard envelope. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const invalidState = (message: string, details?: unknown) => new AppError(409, 'INVALID_STATE', message, details);
export const insufficientStock = (message: string, details?: unknown) => new AppError(409, 'INSUFFICIENT_STOCK', message, details);
export const integrationUnavailable = (message: string) => new AppError(503, 'INTEGRATION_UNAVAILABLE', message);
