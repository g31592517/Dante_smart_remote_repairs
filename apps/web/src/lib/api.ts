import type { ApiErrorCode, AuthTokens, AuthUser, PageMeta } from '@dante/shared';

/**
 * Thin fetch wrapper for /api/v1. The access token lives only in memory (never localStorage); the
 * refresh token is an httpOnly cookie the browser sends to /api/v1/auth/* automatically. On a 401 the
 * client refreshes once and retries. Mobile clients will use the same endpoints with X-Client: mobile.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api/v1';
export const MEDIA_BASE = BASE.replace(/\/api\/v1$/, '');

export class ApiError extends Error {
  constructor(public status: number, public code: ApiErrorCode | 'NETWORK_ERROR', message: string, public details?: unknown) {
    super(message);
  }
  /** Field errors from VALIDATION_ERROR responses, keyed by path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
  }
}

let accessToken: string | null = null;
let onSessionChange: ((user: AuthUser | null) => void) | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function onAuthChange(cb: (user: AuthUser | null) => void) {
  onSessionChange = cb;
}

let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) {
        accessToken = null;
        onSessionChange?.(null);
        return false;
      }
      const body = (await res.json()) as { data: { user: AuthUser; tokens: AuthTokens } };
      accessToken = body.data.tokens.accessToken;
      onSessionChange?.(body.data.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  form?: FormData;
  signal?: AbortSignal;
}

async function raw(path: string, opts: RequestOptions, retry = true): Promise<Response> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: path.startsWith('/auth/') ? 'include' : 'same-origin',
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return raw(path, opts, false);
  }
  return res;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const b = (await res.json()) as { error?: { code: ApiErrorCode; message: string; details?: unknown } };
    if (b.error) return new ApiError(res.status, b.error.code, b.error.message, b.error.details);
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, 'INTERNAL_ERROR', `Request failed (${res.status})`);
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await raw(path, opts);
  if (!res.ok) throw await parseError(res);
  return ((await res.json()) as { data: T }).data;
}

export async function apiPage<T>(path: string, opts: RequestOptions = {}): Promise<{ items: T[]; meta: PageMeta }> {
  const res = await raw(path, opts);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { data: T[]; meta: PageMeta };
  return { items: body.data, meta: body.meta };
}

/** Downloads a protected file (attachments, CSV exports) using the bearer token, then saves it. */
export async function downloadFile(path: string, query?: RequestOptions['query'], fallbackName = 'download') {
  const res = await raw(path, { query });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(/filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName);
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Object URL for viewing a protected image/PDF inline. Caller must revoke it. */
export async function protectedObjectUrl(path: string): Promise<string> {
  const res = await raw(path, {});
  if (!res.ok) throw await parseError(res);
  return URL.createObjectURL(await res.blob());
}

export const mediaUrl = (path: string) => `${MEDIA_BASE}${path}`;
