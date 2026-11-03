# 05 — AnyDesk integration

There are two separate AnyDesk mechanisms, with different requirements:

| Mechanism | What it does | Needs |
|---|---|---|
| **URL handler** `anydesk:<id-or-alias>` | Opens the technician's AnyDesk client and starts a connection to the customer's device | AnyDesk installed on the technician's computer. Works with any AnyDesk licence |
| **REST API** | *Reports* on clients and sessions (history, duration, comments) and can close a session | A licence that includes API access, plus a **License ID and API password** issued by AnyDesk |

> The REST API **cannot start a remote-desktop connection from a browser**. The platform does not pretend it can:
> connections always start from the technician's AnyDesk client, and the customer must accept them in their
> AnyDesk window.

## 1. Workflow implemented

1. Technician (or manager) on an accepted, assigned request → **Request remote session** (optional instructions).
   The request moves to *Awaiting customer* and the customer is notified.
2. Customer, on their request page, sees three steps: download AnyDesk from the configurable official URL (default
   `https://anydesk.com/en/downloads`), enter the **AnyDesk ID** shown in their AnyDesk window, and read and
   **explicitly authorise** the session (checkbox + button).
   * The ID must be 9–10 digits (spaces allowed) or an alias such as `name@ad`. Anything else is rejected, and the
     page warns never to enter a password. The platform never asks for unattended-access passwords.
   * The consent is stored with the exact text, version, time, IP and browser (`customer_consents`).
3. Technician → **Connect using AnyDesk**. The server re-checks that consent exists and has not been withdrawn,
   records *who* initiated it and *when*, then returns `anydesk:<id>`, which the browser opens. A plain link to the
   same URL is shown as a fallback in case the browser blocks the automatic launch.
4. The customer accepts the incoming connection in AnyDesk. The technician marks the session **active** (or the
   REST API reports it active on sync).
5. Technician → **Complete session**: outcome and work performed. Session evidence is taken from the REST API when
   configured; otherwise the technician may enter the AnyDesk session ID and start/end times from their AnyDesk
   session list.
6. The customer can **withdraw authorisation** at any time before completion. The session becomes *revoked*, the
   technician is told to disconnect, and if the REST API is configured the session is closed through the API. Closing
   the AnyDesk window ends a connection immediately in every case.

Session states: `REQUESTED → AUTHORIZED → INITIATED → ACTIVE → COMPLETED`, plus `REVOKED` (customer) and `CANCELLED`
(staff). Every transition is audited (`remote.requested`, `remote.authorized`, `remote.initiated`, `remote.active`,
`remote.completed`, `remote.revoked`, `remote.cancelled`).

## 2. REST API — findings

Sources: AnyDesk's documentation page "my.anydesk – REST API" (support.anydesk.com/docs/rest-api) and AnyDesk's
official client library `github.com/anydesk/rest-api` (`anydesk/api.py`, `session.py`, `client.py`). The full
endpoint reference is distributed in the my.anydesk customer portal, which was not accessible during development,
so details below are verified against the official client library rather than that reference.

| Topic | Finding |
|---|---|
| Base URL | `https://v1.api.anydesk.com:8081` (on-premises deployments use their own host and port 8081) |
| Credentials | **License ID** + **API password**, issued by AnyDesk support on request (quote your customer number) |
| Licence | AnyDesk's documentation lists API access for **Standard, Advanced, Ultimate-Cloud and On-Premises** licences. It is not available on the free plan. Confirm your entitlement with AnyDesk before relying on it |
| Authentication | Header `Authorization: AD <license-id>:<unix-timestamp>:<token>`, where `token = base64(HMAC-SHA1(api-password, METHOD + "\n" + RESOURCE + "\n" + TIMESTAMP + "\n" + base64(SHA1(body))))`. RESOURCE is the path **including** the query string |
| System info | `GET /sysinfo` → licence name, expiry, limits, API version |
| Clients | `GET /clients`, `GET /clients/{cid}` (alias, online state, version, last sessions), `PATCH /clients/{cid}` (alias, comment) |
| Sessions | `GET /sessions?from=&to=&cid=&direction=&sort=&offset=&limit=` → `{ sid, from{cid,alias}, to{cid,alias}, active, start-time, end-time, duration, comment }`; `GET /sessions/{sid}` |
| Session operations | `PATCH /sessions/{sid}` `{ comment }`; `POST /sessions/{sid}/action` `{ action: "close" }` |
| Live sync | No push/webhook. Active sessions can be polled (`active: true`), which is what **Sync from AnyDesk API** does |

### What the platform does with it (`apps/api/src/modules/remote/anydesk.client.ts`)

* Signs requests exactly as above. A unit test checks the signer against values computed independently with
  Python's `hmac`/`hashlib` using the official algorithm.
* **Sync** (button, and automatically on completion): finds the AnyDesk session to the customer's ID/alias that
  started after the technician clicked Connect, and stores the AnyDesk session ID, start/end and duration
  (`session_data_source = ANYDESK_API`). It also marks our session ACTIVE when AnyDesk reports it active.
* On completion, writes a comment on the AnyDesk session: `Support request SR-…`.
* On customer revocation, asks AnyDesk to close the session.
* **Admin → Settings → Test connection** calls `/sysinfo`.
* Integration tests run the client against a local mock that verifies signatures the way AnyDesk does.

## 3. Configuration

```bash
# apps/api/.env  (server only — never in the web app)
ANYDESK_API_URL=https://v1.api.anydesk.com:8081
ANYDESK_LICENSE_ID=123456789
ANYDESK_API_PASSWORD=…
```

Leave the license/password blank to run the **manual workflow**. Everything except automatic evidence, comment and
remote close works without the API.

## 4. What to verify once credentials are available

1. Settings → Test connection shows your licence name.
2. Run a real session and press **Sync from AnyDesk API**. Check that the matched session ID and timestamps match
   AnyDesk's own session list. If your licence reports sessions from the customer's perspective
   (`direction=in`), the matching rule in `findApiSession` may need its direction flag adjusting.
3. Revoke a live test session and confirm AnyDesk closes it.
