import { createHash, createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError, integrationUnavailable } from '../../core/errors.js';

/**
 * AnyDesk REST API client (server-side only — credentials never reach the browser).
 *
 * Verified against AnyDesk's official client library (github.com/anydesk/rest-api, anydesk/api.py):
 *   base URL      https://v1.api.anydesk.com:8081  (on-premises installations use their own host)
 *   auth header   Authorization: AD <license-id>:<unix-timestamp>:<token>
 *   token         base64( HMAC-SHA1( key = API password,
 *                                    msg = METHOD \n RESOURCE \n TIMESTAMP \n base64(SHA1(body)) ) )
 *                 RESOURCE is the path including the query string, e.g. "/sessions?from=1700000000"
 *   endpoints     GET /sysinfo · GET /clients · GET /clients/{cid} · GET /sessions[?cid&from&to&direction&sort&offset&limit]
 *                 GET /sessions/{sid} · PATCH /sessions/{sid} {"comment"} · POST /sessions/{sid}/action {"action":"close"}
 *   session JSON  { sid, from:{cid,alias}, to:{cid,alias}, active, "start-time", "end-time", duration, comment }
 *
 * The REST API REPORTS on sessions and clients; it cannot start a remote-desktop connection from a
 * browser. Connections are always started by the technician's AnyDesk client via the
 * `anydesk:<id>` URL handler, and the customer must accept them in their AnyDesk window.
 * API access needs a licence that includes it, with a License ID and API password issued by AnyDesk
 * (see docs/05_ANYDESK_INTEGRATION.md).
 */

export interface AnyDeskSession {
  sid: string;
  from: { cid: string; alias: string | null };
  to: { cid: string; alias: string | null };
  active: boolean;
  startTime: number | null; // unix seconds
  endTime: number | null;
  duration: number | null; // seconds
  comment: string | null;
}

export function anydeskApiConfigured(): boolean {
  return !!override || !!(env.ANYDESK_LICENSE_ID && env.ANYDESK_API_PASSWORD);
}

export function signAnyDeskRequest(opts: { method: string; resource: string; body?: string; licenseId: string; apiPassword: string; timestamp?: number }) {
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const contentHash = createHash('sha1').update(opts.body ?? '', 'utf8').digest('base64');
  const requestString = `${opts.method}\n${opts.resource}\n${timestamp}\n${contentHash}`;
  const token = createHmac('sha1', opts.apiPassword).update(requestString, 'utf8').digest('base64');
  return `AD ${opts.licenseId}:${timestamp}:${token}`;
}

export class AnyDeskClient {
  constructor(
    private readonly baseUrl: string,
    private readonly licenseId: string,
    private readonly apiPassword: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: 'GET' | 'PATCH' | 'POST', resource: string, payload?: unknown): Promise<T> {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const url = this.baseUrl.replace(/\/+$/, '') + resource;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: signAnyDeskRequest({ method, resource, body, licenseId: this.licenseId, apiPassword: this.apiPassword }),
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: payload === undefined ? undefined : body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw integrationUnavailable(`AnyDesk API unreachable: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw integrationUnavailable('AnyDesk API rejected the credentials (check the License ID / API password and that the licence includes API access)');
    if (res.status === 404) throw new AppError(404, 'NOT_FOUND', 'AnyDesk API: not found');
    if (!res.ok) throw integrationUnavailable(`AnyDesk API error ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  sysinfo() {
    return this.call<{ name: string; 'api-ver': string; license: { name: string; expires: number; 'max-sessions': number } }>('GET', '/sysinfo');
  }

  async getClient(cid: string) {
    const c = await this.call<{ cid: string; alias: string | null; online?: boolean; 'client-version'?: string }>('GET', `/clients/${encodeURIComponent(cid)}`);
    return { cid: String(c.cid), alias: c.alias ?? null, online: !!c.online, version: c['client-version'] ?? null };
  }

  async listSessions(params: { from?: number; to?: number; cid?: string; limit?: number; sort?: string } = {}): Promise<AnyDeskSession[]> {
    const qs: string[] = [];
    if (params.cid) qs.push(`cid=${encodeURIComponent(params.cid)}`);
    if (params.from !== undefined) qs.push(`from=${params.from}`);
    if (params.to !== undefined) qs.push(`to=${params.to}`);
    if (params.sort) qs.push(`sort=${encodeURIComponent(params.sort)}`);
    if (params.limit) qs.push(`limit=${params.limit}`);
    const data = await this.call<{ list: RawSession[] }>('GET', `/sessions${qs.length ? `?${qs.join('&')}` : ''}`);
    return (data.list ?? []).map(mapSession);
  }

  async getSession(sid: string) {
    return mapSession(await this.call<RawSession>('GET', `/sessions/${encodeURIComponent(sid)}`));
  }

  setSessionComment(sid: string, comment: string) {
    return this.call('PATCH', `/sessions/${encodeURIComponent(sid)}`, { comment });
  }

  closeSession(sid: string) {
    return this.call('POST', `/sessions/${encodeURIComponent(sid)}/action`, { action: 'close' });
  }
}

interface RawSession {
  sid: string | number;
  from: { cid: string | number; alias?: string | null };
  to: { cid: string | number; alias?: string | null };
  active: boolean;
  'start-time'?: number | null;
  'end-time'?: number | null;
  duration?: number | null;
  comment?: string | null;
}
function mapSession(s: RawSession): AnyDeskSession {
  return {
    sid: String(s.sid),
    from: { cid: String(s.from.cid), alias: s.from.alias ?? null },
    to: { cid: String(s.to.cid), alias: s.to.alias ?? null },
    active: !!s.active,
    startTime: s['start-time'] ?? null,
    endTime: s['end-time'] ?? null,
    duration: s.duration ?? null,
    comment: s.comment ?? null,
  };
}

let override: AnyDeskClient | null = null;
/** Tests inject a client pointed at a local mock server. */
export function setAnyDeskClientForTests(client: AnyDeskClient | null) {
  override = client;
}
export function anydeskClient(): AnyDeskClient | null {
  if (override) return override;
  if (!anydeskApiConfigured()) return null;
  return new AnyDeskClient(env.ANYDESK_API_URL, env.ANYDESK_LICENSE_ID!, env.ANYDESK_API_PASSWORD!);
}
