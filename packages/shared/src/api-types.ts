/**
 * Response envelope used by every /api/v1 endpoint, so web and mobile clients parse one shape.
 *   success: { data: T, meta?: { page, pageSize, total } }
 *   failure: { error: { code, message, details? } } with a matching HTTP status
 */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}
export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta;
}
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'INSUFFICIENT_STOCK'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTEGRATION_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface AuthUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  accountType: 'INDIVIDUAL' | 'CORPORATE' | 'STAFF';
  roles: string[];
  permissions: string[];
  organization: { id: number; name: string; orgRole: 'ORG_ADMIN' | 'ORG_MEMBER' } | null;
  mustChangePassword: boolean;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  /** Returned in the body only for non-browser clients (X-Client: mobile); browsers get an httpOnly cookie. */
  refreshToken?: string;
}
