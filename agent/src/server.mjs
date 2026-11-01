// Loopback HTTP front for the collector. Colima containers reach the Mac's 127.0.0.1 as host.lima.internal,
// so this never needs to listen on anything else.
import { createServer } from 'node:http';
import { createCollector } from './collect.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4319;
const MAX_QUEUED = 8;

export function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError(`SPECS_AGENT_PORT must be 1-65535, got "${value}"`);
  return port;
}

// One collection at a time: each call waits for the previous one. A burst of callers beyond MAX_QUEUED is refused.
export function createQueue(limit = MAX_QUEUED) {
  let tail = Promise.resolve();
  let waiting = 0;
  return function enqueue(task) {
    if (waiting >= limit) return Promise.reject(Object.assign(new Error('busy'), { code: 'BUSY' }));
    waiting += 1;
    const result = tail.then(() => task());
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      waiting -= 1;
    });
  };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

export function createAgent({ collect = createCollector(), log = console.error } = {}) {
  const enqueue = createQueue();

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || (pathname !== '/v1/snapshot' && pathname !== '/healthz')) {
      return send(res, 404, { error: 'not found' });
    }
    if (pathname === '/healthz') return send(res, 200, { ok: true });
    try {
      send(res, 200, await enqueue(collect));
    } catch (err) {
      if (err?.code === 'BUSY') return send(res, 503, { error: 'busy' });
      // The message can name a command or a field, never a value from the snapshot.
      log(`snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      send(res, 500, { error: 'collection failed' });
    }
  });
}

if (import.meta.main) {
  const port = parsePort(process.env.SPECS_AGENT_PORT);
  const server = createAgent();
  server.listen(port, HOST, () => console.error(`specs-agent listening on http://${HOST}:${port}`));
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
