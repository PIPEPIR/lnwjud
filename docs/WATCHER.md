# LNWJUD Watcher API

LNWJUD v5.6.0 introduced the local read-only runtime surface used by the separate **LNWJUD Watcher** Web/PWA, Android, and iOS client. LNWJUD v5.6.1 extends Protocol v1 additively so one snapshot can represent multiple Active Projects and multiple active Durable Goals at the same time.

## What starts with Desktop

When LNWJUD Desktop starts, it also starts two loopback listeners:

| Purpose | Default | Exposure |
| --- | --- | --- |
| Watcher API | `http://127.0.0.1:17890` | May be placed behind an HTTPS tunnel/reverse proxy |
| Local pairing | `http://127.0.0.1:17891/api/v1/pair` | **Loopback only — never publish this port** |

Override the ports only when needed:

```text
LNWJUD_WATCHER_PORT
LNWJUD_WATCHER_PAIR_PORT
```

The Watcher listeners are independent from the MCP command surface.

## Pair a Watcher client

On the machine running LNWJUD Desktop, open:

```text
http://127.0.0.1:17891/api/v1/pair
```

The local-only response contains:

- `protocolVersion`
- local Watcher `endpoint`
- the dedicated Watcher access `token`

Keep the token private. In production Desktop it is persisted through LNWJUD's protected secret provider and is separate from MCP, tunnel, and OAuth credentials.

For same-machine use, enter the returned endpoint and token directly in Watcher. Watcher Web/PWA v0.3.0+ remembers that token in browser-local storage for up to 60 days; packaged Desktop and mobile builds keep it in app-local device storage across restarts until the user clears the token or app data.

For phone/remote use, expose **only port 17890** through zrok, Cloudflare Tunnel, Tailscale Serve/Funnel, ngrok, or your own HTTPS reverse proxy. Then enter the resulting HTTPS URL together with the same Watcher token in the Watcher app.

## Protocol v1

### Snapshot

```http
GET /api/v1/snapshot
Authorization: Bearer <watcher-token>
```

The response is intentionally bounded and sanitized:

- runtime version/health and total observable in-flight operation count
- stable instance id, hostname, platform
- `workspaces[]`: every Active Project, each with its active Durable Goals (up to 50 per project), active-operation count, and sanitized Git state
- workspace-tagged observable agents/workers and activity where the runtime knows the workspace
- recent observable activity across all Active Projects
- compatibility `goal` and `git` fields for the selected/primary project so older Protocol v1 clients continue to work
- server timestamp

Watcher does not return raw environment variables, provider credentials, MCP secrets, file contents, or hidden model reasoning.

### Realtime events

Connect to:

```text
ws://127.0.0.1:17890/api/v1/events
```

or the corresponding `wss://` URL through an HTTPS tunnel.

Immediately after the socket opens, send:

```json
{"type":"auth","token":"<watcher-token>"}
```

Unauthenticated sockets are closed after a short bounded timeout. After valid authentication the runtime sends `{ "type": "ready", "protocolVersion": 1 }`; the client treats realtime as connected only after this acknowledgement, so an invalid token cannot briefly appear as a healthy live connection. Authorized clients then receive structured observable activity events and heartbeat pings keep the connection detectable.

The companion Watcher client re-synchronizes the full snapshot after reconnect and after live activity so Goal/Agent/Git state stays authoritative, while still rendering the event immediately. It uses a 5-second snapshot fallback while realtime is unavailable.

## Security boundary

Watcher v1 is **read-only**.

It does not expose:

- shell/process execution
- file writes/deletes
- MCP mutation calls
- approval actions
- pause/resume
- OAuth or tunnel credentials
- hidden chain-of-thought

Authentication uses a dedicated random Watcher bearer token. Production Desktop protects the persisted token with the same purpose-bound secret protection system used for other sensitive local state. Token comparisons use constant-time comparison where lengths match.

The pairing listener is deliberately separate and bound only to loopback. Do not reverse-proxy or tunnel port 17891.

## Remote access

The Watcher repository contains user-facing setup guides and helper scripts for:

- Local/LAN
- zrok
- Cloudflare Tunnel
- Tailscale Serve
- Tailscale Funnel
- ngrok
- Custom HTTPS

Remote providers forward to the local Watcher API only. They never need to expose the LNWJUD MCP gateway.

## Troubleshooting

**Watcher shows 401 / Unauthorized**

Re-pair locally and make sure the Watcher client is using the current dedicated token.

**WebSocket reconnects but snapshots work**

Confirm your tunnel/reverse proxy forwards WebSocket upgrades for `/api/v1/events`.

**Port 17890 is already in use**

Set `LNWJUD_WATCHER_PORT` before launching Desktop and use the new local origin in your tunnel configuration.

**Do I expose 17891 too?**

No. Pairing remains loopback-only by design.
