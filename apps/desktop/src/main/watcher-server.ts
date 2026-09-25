import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

export type WatcherStatus = 'running' | 'analyzing' | 'verifying' | 'waiting' | 'blocked' | 'idle' | 'done' | 'error';

export interface WatcherActivityEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: string;
  readonly status: WatcherStatus;
  readonly actor: string;
  readonly summary: string;
  readonly detail?: string;
}

export interface WatcherSnapshot {
  readonly protocolVersion: 1;
  readonly serverTime: string;
  readonly runtime: { readonly version: string; readonly status: WatcherStatus };
  readonly instance: {
    readonly id: string;
    readonly name: string;
    readonly platform: 'windows' | 'macos' | 'linux' | 'unknown';
  };
  readonly goal: null | {
    readonly id: string;
    readonly key: string;
    readonly status: WatcherStatus;
    readonly currentTask: string;
    readonly blockers: readonly string[];
    readonly milestones: ReadonlyArray<{
      readonly id: string;
      readonly title: string;
      readonly status: 'pending' | 'in_progress' | 'completed' | 'blocked';
    }>;
  };
  readonly agents: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly status: WatcherStatus;
    readonly task?: string;
  }>;
  readonly activity: readonly WatcherActivityEvent[];
  readonly git: {
    readonly branch: string;
    readonly commit: string;
    readonly clean: boolean;
  };
}

export interface WatcherServerOptions {
  readonly port: number;
  readonly pairingPort: number;
  readonly accessToken: string;
  readonly buildSnapshot: (recentActivity: readonly WatcherActivityEvent[]) => Promise<WatcherSnapshot>;
  readonly subscribeActivity: (listener: (event: WatcherActivityEvent) => void) => () => void;
}

export interface WatcherServerHandle {
  readonly endpoint: URL;
  readonly pairingEndpoint: URL;
  close(): Promise<void>;
}

const MAX_ACTIVITY = 100;
const WS_AUTH_TIMEOUT_MS = 5_000;

function tokenMatches(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

function bearerToken(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || null;
}

function cors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

function json(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('Watcher server did not expose a TCP address'));
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

export async function startWatcherServer(options: WatcherServerOptions): Promise<WatcherServerHandle> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) throw new Error('Watcher port must be an integer from 0 to 65535');
  if (!Number.isInteger(options.pairingPort) || options.pairingPort < 0 || options.pairingPort > 65_535) throw new Error('Watcher pairing port must be an integer from 0 to 65535');
  if (options.accessToken.trim().length < 32) throw new Error('Watcher access token must contain at least 32 characters');

  const recentActivity: WatcherActivityEvent[] = [];
  const authorizedSockets = new Set<WebSocket>();

  const apiServer = createServer((request, response): void => {
    void (async (): Promise<void> => {
      cors(response);
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== '/api/v1/snapshot') {
        json(response, 404, { error: 'not_found' });
        return;
      }

      const token = bearerToken(request);
      if (token === null || !tokenMatches(options.accessToken, token)) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        json(response, 401, { error: 'unauthorized' });
        return;
      }

      json(response, 200, await options.buildSnapshot(recentActivity));
    })().catch(() => {
      if (!response.headersSent) json(response, 500, { error: 'internal_error' });
      else response.destroy();
    });
  });

  const webSockets = new WebSocketServer({ noServer: true });
  apiServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/api/v1/events') {
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (client) => webSockets.emit('connection', client, request));
  });

  webSockets.on('connection', (client) => {
    const authTimer = setTimeout(() => client.close(4401, 'authentication required'), WS_AUTH_TIMEOUT_MS);
    authTimer.unref();

    const authenticate = (raw: Buffer): void => {
      try {
        const parsed = JSON.parse(raw.toString('utf8')) as { readonly type?: unknown; readonly token?: unknown };
        if (parsed.type !== 'auth' || typeof parsed.token !== 'string' || !tokenMatches(options.accessToken, parsed.token)) {
          client.close(4401, 'authentication failed');
          return;
        }
        clearTimeout(authTimer);
        authorizedSockets.add(client);
        client.off('message', authenticate);
        client.send(JSON.stringify({ type: 'ready', protocolVersion: 1 }));
      } catch {
        client.close(4400, 'invalid authentication frame');
      }
    };

    client.on('message', authenticate);
    client.on('close', () => {
      clearTimeout(authTimer);
      authorizedSockets.delete(client);
    });
  });

  const apiPort = await listen(apiServer, options.port);

  const pairingServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== '/api/v1/pair') {
      json(response, 404, { error: 'not_found' });
      return;
    }
    json(response, 200, {
      protocolVersion: 1,
      endpoint: `http://127.0.0.1:${apiPort}`,
      token: options.accessToken,
    });
  });

  let pairingPort: number;
  try {
    pairingPort = await listen(pairingServer, options.pairingPort);
  } catch (error) {
    await closeServer(apiServer).catch(() => undefined);
    webSockets.close();
    throw error;
  }

  const unsubscribe = options.subscribeActivity((event) => {
    recentActivity.unshift(event);
    if (recentActivity.length > MAX_ACTIVITY) recentActivity.length = MAX_ACTIVITY;
    const message = JSON.stringify(event);
    for (const client of authorizedSockets) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of authorizedSockets) if (client.readyState === WebSocket.OPEN) client.ping();
  }, 20_000);
  heartbeat.unref();

  return {
    endpoint: new URL(`http://127.0.0.1:${apiPort}`),
    pairingEndpoint: new URL(`http://127.0.0.1:${pairingPort}/api/v1/pair`),
    async close(): Promise<void> {
      unsubscribe();
      clearInterval(heartbeat);
      for (const client of authorizedSockets) client.close(1001, 'runtime shutdown');
      authorizedSockets.clear();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      await Promise.all([closeServer(apiServer), closeServer(pairingServer)]);
    },
  };
}
