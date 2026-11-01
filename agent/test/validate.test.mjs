import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollector } from '../src/collect.mjs';
import { validateSnapshot } from '../src/validate.mjs';
import { fakeRun, fakeSysinfo } from './helpers.mjs';

const good = () => createCollector({ run: fakeRun(), sysinfo: fakeSysinfo(), sleepMs: async () => {}, deny: [] })();

async function broken(mutate) {
  const snapshot = structuredClone(await good());
  mutate(snapshot);
  return validateSnapshot(snapshot);
}

test('a good snapshot has no issues', async () => {
  assert.deepEqual(validateSnapshot(await good()), []);
});

test('extra and missing keys are reported by path, at every level', async () => {
  assert.deepEqual(await broken((s) => { s.extra = 1; }), ['.extra']);
  assert.deepEqual(await broken((s) => { s.machine.hostname = 'x'; }), ['machine.hostname']);
  assert.deepEqual(await broken((s) => { delete s.cpu.user; }), ['cpu.user']);
  assert.deepEqual(await broken((s) => { s.processes.top[0].pid = 1; }), ['processes.top.0.pid']);
  assert.deepEqual(await broken((s) => { s.battery.serial = 'x'; }), ['battery.serial']);
});

test('ranges, decimals and ordering are enforced', async () => {
  assert.deepEqual(await broken((s) => { s.cpu.load = 100.1; }), ['cpu.load']);
  assert.deepEqual(await broken((s) => { s.cpu.load = 12.34; }), ['cpu.load']);
  assert.deepEqual(await broken((s) => { s.memory.used = -1; }), ['memory.used']);
  assert.deepEqual(await broken((s) => { s.memory.app = 1.5; }), ['memory.app']);
  assert.deepEqual(await broken((s) => { s.memory.pressure = 'bad'; }), ['memory.pressure']);
  assert.deepEqual(await broken((s) => { s.at = '2026-11-01T19:05:00Z'; }), ['at']);
  assert.deepEqual(await broken((s) => { s.cpu.perCore = []; }), ['cpu.perCore']);
  assert.deepEqual(await broken((s) => { s.machine.cores = []; }), ['machine.cores']);
  assert.deepEqual(await broken((s) => { s.processes.top[0].name = 'a/b'; }), ['processes.top.0.name']);
  assert.ok((await broken((s) => { s.processes.top.reverse(); })).every((p) => p.endsWith('.memory')));
});

test('battery may be null but not partial', async () => {
  assert.deepEqual(await broken((s) => { s.battery = null; }), []);
  assert.deepEqual(await broken((s) => { delete s.battery.health; }), ['battery.health']);
  assert.deepEqual(validateSnapshot(null), ['(root)']);
});

test('labels and core names refuse URLs, emails, symbols and control characters', async () => {
  const model = (value) => broken((s) => { s.machine.model = value; });
  assert.deepEqual(await model('see https://evil.example/login me@x.com'), ['machine.model']);
  assert.deepEqual(await model('MacBook\nPro'), ['machine.model']);
  assert.deepEqual(await model('<b>Mac</b>'), ['machine.model']);
  assert.deepEqual(await model('MacBook Pro (16-inch, M5 Pro, 2026)'), []);
  assert.deepEqual(await broken((s) => { s.machine.chip = 'Apple;M5'; }), ['machine.chip']);
  assert.deepEqual(await broken((s) => { s.machine.os = 'macOS 27.2 $'; }), ['machine.os']);
  assert.deepEqual(await broken((s) => { s.machine.cores[0].name = 'a/b'; }), ['machine.cores.0.name']);
  assert.deepEqual(await broken((s) => { s.machine.cores[0].name = 'x'.repeat(25); }), ['machine.cores.0.name']);
  assert.deepEqual(await broken((s) => { s.processes.top[0].name = 'npm run deploy-acme'; }), ['processes.top.0.name']);
});
