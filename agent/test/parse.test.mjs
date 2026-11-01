import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryFromVmStat, parseBootTime, parseSwapUsage, parseVmStat, pressureWord } from '../src/parse.mjs';
import { vmStatFixture } from './helpers.mjs';

test('parseVmStat reads the page size and the five counters used', () => {
  assert.deepEqual(parseVmStat(vmStatFixture), {
    pageSize: 16384,
    wired: 332330,
    anonymous: 1403042,
    purgeable: 22756,
    fileBacked: 773328,
    compressor: 506743,
  });
});

test('parseVmStat fails loudly on output it does not understand', () => {
  assert.throws(() => parseVmStat('nothing useful'), /page size/);
  assert.throws(() => parseVmStat('Mach Virtual Memory Statistics: (page size of 16384 bytes)\n'), /not found/);
});

test('memoryFromVmStat follows Activity Monitor: used = app + wired + compressed', () => {
  const m = memoryFromVmStat(parseVmStat(vmStatFixture));
  assert.equal(m.app, (1403042 - 22756) * 16384);
  assert.equal(m.wired, 332330 * 16384);
  assert.equal(m.compressed, 506743 * 16384);
  assert.equal(m.used, m.app + m.wired + m.compressed);
  assert.equal(m.cached, 773328 * 16384);
});

test('parseSwapUsage converts megabytes to bytes', () => {
  assert.deepEqual(parseSwapUsage('total = 7168.00M  used = 5940.31M  free = 1227.69M  (encrypted)'), {
    swapTotal: 7168 * 1024 * 1024,
    swapUsed: Math.round(5940.31 * 1024 * 1024),
  });
  assert.deepEqual(parseSwapUsage('total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)'), { swapTotal: 0, swapUsed: 0 });
  assert.equal(parseSwapUsage('total = 2.00G  used = 1.00G  free = 1.00G').swapTotal, 2 * 1024 ** 3);
  assert.throws(() => parseSwapUsage('garbage'), /not found/);
});

test('parseBootTime returns UTC ISO from epoch seconds', () => {
  assert.equal(parseBootTime('{ sec = 1793110834, usec = 793548 } Tue Oct 27 10:20:34 2026'), '2026-10-27T14:20:34.000Z');
  assert.throws(() => parseBootTime('nope'), /sec/);
});

test('pressureWord maps the sysctl level', () => {
  assert.equal(pressureWord('1'), 'normal');
  assert.equal(pressureWord('2'), 'warn');
  assert.equal(pressureWord('4'), 'critical');
  assert.equal(pressureWord('7'), 'normal');
});
