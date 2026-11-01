import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollector } from '../src/collect.mjs';
import { validateSnapshot } from '../src/validate.mjs';
import { fakeRun, fakeSysinfo, siFixture } from './helpers.mjs';

const fixedNow = () => new Date('2026-11-01T19:05:00.000Z');
const noSleep = async () => {};

function collector(extra = {}) {
  const run = extra.run ?? fakeRun();
  const sysinfo = extra.sysinfo ?? fakeSysinfo();
  const collect = createCollector({ run, sysinfo, now: fixedNow, sleepMs: noSleep, deny: [], ...extra });
  return { collect, run, sysinfo };
}

test('builds exactly Snapshot v1 from fixtures', async () => {
  const snapshot = await collector().collect();
  assert.deepEqual(validateSnapshot(snapshot), []);
  assert.deepEqual(Object.keys(snapshot), ['v', 'at', 'machine', 'memory', 'cpu', 'disk', 'battery', 'processes']);
  assert.equal(snapshot.at, '2026-11-01T19:05:00.000Z');
  assert.deepEqual(snapshot.machine, {
    model: 'MacBook Pro (16-inch, M5 Pro, 2026)',
    chip: 'Apple M5 Pro',
    cores: [
      { name: 'Super', count: 6 },
      { name: 'Performance', count: 12 },
    ],
    memory: 51539607552,
    os: 'macOS 27.2',
    bootedAt: '2026-10-27T14:20:34.000Z',
  });
  assert.deepEqual(snapshot.memory, {
    total: 51539607552,
    used: (1403042 - 22756 + 332330 + 506743) * 16384,
    app: (1403042 - 22756) * 16384,
    wired: 332330 * 16384,
    compressed: 506743 * 16384,
    cached: 773328 * 16384,
    swapUsed: Math.round(5940.31 * 1024 * 1024),
    swapTotal: 7168 * 1024 * 1024,
    freePercent: 72,
    pressure: 'normal',
  });
});

test('cpu, disk and battery are read from the allowlisted fields', async () => {
  const { cpu, disk, battery } = await collector().collect();
  assert.deepEqual(cpu, { load: 12.3, user: 8.1, system: 4.3, perCore: [31, 20, 2.2, 0] });
  assert.deepEqual(disk, { total: 994610155520, used: 994610155520 - 150674354176, free: 150674354176 });
  assert.deepEqual(battery, { percent: 100, charging: false, onAC: true, cycles: 49, health: 96.4 });
});

test('process list is grouped, sorted and carries names only', async () => {
  const { processes } = await collector().collect();
  assert.equal(processes.count, siFixture.processes.list.length);
  assert.deepEqual(
    processes.top.map((p) => p.name),
    ['server', 'Google Chrome', 'Xcode', 'Safari (WebKit)', 'kernel_task'],
  );
  assert.deepEqual(Object.keys(processes.top[0]), ['name', 'memory', 'cpu']);
});

test('the output has no serial, uuid, path, user or address', async () => {
  const json = JSON.stringify(await collector().collect());
  for (const needle of ['FAKE-', '0000-0000', '/Users', '/Applications', 'someone', '@', 'serial', 'uuid', 'hostname']) {
    assert.equal(json.includes(needle), false, needle);
  }
});

test('machine facts are cached for ten minutes, live values are read every time', async () => {
  let t = Date.parse('2026-11-01T19:00:00.000Z');
  const run = fakeRun();
  const sysinfo = fakeSysinfo();
  const collect = createCollector({ run, sysinfo, now: () => new Date(t), sleepMs: noSleep, deny: [] });
  const count = (name, key) => run.calls.filter((c) => c[0] === name && (key === undefined || c.at(-1) === key)).length;

  await collect();
  t += 5 * 60 * 1000;
  await collect();
  assert.equal(sysinfo.calls.system, 1);
  assert.equal(count('sysctl', 'machdep.cpu.brand_string'), 1);
  assert.equal(count('sw_vers'), 1);
  assert.equal(count('vm_stat'), 2);
  assert.equal(count('sysctl', 'kern.memorystatus_level'), 2);

  t += 5 * 60 * 1000;
  await collect();
  assert.equal(sysinfo.calls.system, 2);
  assert.equal(count('sysctl', 'machdep.cpu.brand_string'), 2);
  assert.equal(count('vm_stat'), 3);
});

test('cpu is sampled twice with a pause, so it measures now rather than the last poll', async () => {
  const order = [];
  const sysinfo = fakeSysinfo();
  const original = sysinfo.currentLoad;
  sysinfo.currentLoad = async () => {
    order.push('load');
    return original();
  };
  await collector({ sysinfo, sleepMs: async () => order.push('sleep') }).collect();
  assert.deepEqual(order, ['load', 'sleep', 'load']);
});

test('battery is null on a desktop Mac', async () => {
  const sysinfo = fakeSysinfo({ battery: { hasBattery: false } });
  const snapshot = await collector({ sysinfo }).collect();
  assert.equal(snapshot.battery, null);
  assert.deepEqual(validateSnapshot(snapshot), []);
});

test('disk falls back to the root volume when the Data volume is absent', async () => {
  const fsSize = [{ mount: '/', size: 1000, used: 400, available: 600 }];
  const { disk } = await collector({ sysinfo: fakeSysinfo({ fsSize }) }).collect();
  assert.deepEqual(disk, { total: 1000, used: 400, free: 600 });
});

test('a perflevel that cannot be read falls back to one generic core group', async () => {
  const run = fakeRun({ 'hw.nperflevels': new Error('unknown oid') });
  const { machine } = await collector({ run }).collect();
  assert.equal(machine.cores.length, 1);
  assert.equal(machine.cores[0].name, 'Cores');
  assert.ok(machine.cores[0].count >= 1);
});

test('health above 100 is clamped and unknown pressure reads as normal', async () => {
  const battery = { ...siFixture.battery, maxCapacity: 120000 };
  const run = fakeRun({ 'kern.memorystatus_vm_pressure_level': '2' });
  const snapshot = await collector({ sysinfo: fakeSysinfo({ battery }), run }).collect();
  assert.equal(snapshot.battery.health, 100);
  assert.equal(snapshot.memory.pressure, 'warn');
});

test('a command that fails fails the whole collection instead of shipping partial data', async () => {
  const run = fakeRun({ 'vm.swapusage': new Error('timed out') });
  await assert.rejects(collector({ run }).collect(), /timed out/);
});

test('every command goes through execFile arguments, never a shell string', async () => {
  const run = fakeRun();
  await collector({ run }).collect();
  for (const [name, ...args] of run.calls) {
    assert.ok(['sysctl', 'vm_stat', 'sw_vers'].includes(name), name);
    for (const arg of args) assert.match(arg, /^[\w.-]+$/);
  }
});
