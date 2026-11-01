import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAgent, createQueue, parsePort } from '../src/server.mjs';

let server;
let base;
let active = 0;
let maxActive = 0;
let mode = 'ok';
const logs = [];

async function collect() {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, 20));
  active -= 1;
  if (mode === 'fail') throw new Error('vm_stat: page size not found');
  return { v: 1, at: '2026-11-01T19:05:00.000Z' };
}

before(async () => {
  server = createAgent({ collect, log: (line) => logs.push(line) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('listens on loopback only', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('GET /v1/snapshot returns JSON that is never cached', async () => {
  const res = await fetch(`${base}/v1/snapshot`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { v: 1, at: '2026-11-01T19:05:00.000Z' });
});

test('query strings are ignored and /healthz answers without collecting', async () => {
  assert.equal((await fetch(`${base}/v1/snapshot?x=1`)).status, 200);
  const before = maxActive;
  const res = await fetch(`${base}/healthz`);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(maxActive, before);
});

test('everything else is 404', async () => {
  for (const [method, path] of [['GET', '/'], ['GET', '/v1/snapshot/'], ['GET', '/v1'], ['POST', '/v1/snapshot'], ['DELETE', '/healthz'], ['GET', '/etc/passwd']]) {
    const res = await fetch(`${base}${path}`, { method });
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: 'not found' });
  }
});

test('concurrent requests are collected one at a time', async () => {
  maxActive = 0;
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}/v1/snapshot`)));
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200, 200, 200, 200],
  );
  assert.equal(maxActive, 1);
});

test('a failed collection answers 500 with no detail and logs the reason', async () => {
  mode = 'fail';
  const res = await fetch(`${base}/v1/snapshot`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'collection failed' });
  assert.match(logs.at(-1), /page size not found/);
  mode = 'ok';
  assert.equal((await fetch(`${base}/v1/snapshot`)).status, 200);
});

test('the queue refuses a burst beyond its limit and recovers after a failure', async () => {
  const enqueue = createQueue(2);
  const slow = () => new Promise((resolve) => setTimeout(() => resolve('done'), 20));
  const results = await Promise.allSettled([enqueue(slow), enqueue(slow), enqueue(slow)]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'fulfilled', 'rejected'],
  );
  assert.equal(results[2].reason.code, 'BUSY');
  await assert.rejects(enqueue(() => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(await enqueue(slow), 'done');
});

test('parsePort defaults to 4319 and rejects nonsense', () => {
  assert.equal(parsePort(undefined), 4319);
  assert.equal(parsePort(''), 4319);
  assert.equal(parsePort('14319'), 14319);
  for (const bad of ['0', '70000', 'abc', '12.5', '-1']) assert.throws(() => parsePort(bad), RangeError, bad);
});
