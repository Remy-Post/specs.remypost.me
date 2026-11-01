// Hand-written check of Snapshot v1 (docs/SPEC.md). The server validates the same shape with zod;
// checking here means a bad reading fails on the Mac, where it is easy to see, not as a 400 on ingest.
import { isPublishableName } from './sanitize.mjs';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Same patterns as src/lib/schema.ts. Labels are plain words and numbers: no URLs, emails or symbols.
const LABEL = /^[\p{L}\p{N} .,()+&-]+$/u;
const CORE_NAME = /^[\p{L}\p{N} ._()+&-]{1,24}$/u;
const PRESSURE = ['normal', 'warn', 'critical'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBytes = (v) => Number.isSafeInteger(v) && v >= 0;
const isPercent = (v) => Number.isFinite(v) && v >= 0 && v <= 100 && Math.round(v * 10) / 10 === v;
const isIso = (v) => typeof v === 'string' && ISO_Z.test(v) && !Number.isNaN(Date.parse(v));
const isLabel = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max && LABEL.test(v);

function exactKeys(obj, keys, path, issues) {
  if (!isObject(obj)) {
    issues.push(path || '(root)');
    return false;
  }
  for (const key of Object.keys(obj)) if (!keys.includes(key)) issues.push(`${path}.${key}`);
  for (const key of keys) if (!(key in obj)) issues.push(`${path}.${key}`);
  return true;
}

function check(issues, path, ok) {
  if (!ok) issues.push(path);
}

/** @returns {string[]} paths that break the contract; empty when the snapshot is valid. */
export function validateSnapshot(s) {
  const issues = [];
  if (!exactKeys(s, ['v', 'at', 'machine', 'memory', 'cpu', 'disk', 'battery', 'processes'], '', issues)) return issues;
  check(issues, 'v', s.v === 1);
  check(issues, 'at', isIso(s.at));

  const m = s.machine;
  if (exactKeys(m, ['model', 'chip', 'cores', 'memory', 'os', 'bootedAt'], 'machine', issues)) {
    check(issues, 'machine.model', isLabel(m.model, 80));
    check(issues, 'machine.chip', isLabel(m.chip, 60));
    check(issues, 'machine.memory', isBytes(m.memory));
    check(issues, 'machine.os', isLabel(m.os, 40));
    check(issues, 'machine.bootedAt', isIso(m.bootedAt));
    if (!Array.isArray(m.cores) || m.cores.length < 1 || m.cores.length > 4) issues.push('machine.cores');
    else
      m.cores.forEach((c, i) => {
        if (exactKeys(c, ['name', 'count'], `machine.cores.${i}`, issues)) {
          check(issues, `machine.cores.${i}.name`, typeof c.name === 'string' && CORE_NAME.test(c.name));
          check(issues, `machine.cores.${i}.count`, Number.isInteger(c.count) && c.count >= 1);
        }
      });
  }

  const mem = s.memory;
  const memKeys = ['total', 'used', 'app', 'wired', 'compressed', 'cached', 'swapUsed', 'swapTotal', 'freePercent', 'pressure'];
  if (exactKeys(mem, memKeys, 'memory', issues)) {
    for (const key of memKeys.filter((k) => !['freePercent', 'pressure'].includes(k))) check(issues, `memory.${key}`, isBytes(mem[key]));
    check(issues, 'memory.freePercent', isPercent(mem.freePercent));
    check(issues, 'memory.pressure', PRESSURE.includes(mem.pressure));
  }

  const cpu = s.cpu;
  if (exactKeys(cpu, ['load', 'user', 'system', 'perCore'], 'cpu', issues)) {
    for (const key of ['load', 'user', 'system']) check(issues, `cpu.${key}`, isPercent(cpu[key]));
    check(issues, 'cpu.perCore', Array.isArray(cpu.perCore) && cpu.perCore.length >= 1 && cpu.perCore.length <= 64 && cpu.perCore.every(isPercent));
  }

  const disk = s.disk;
  if (exactKeys(disk, ['total', 'used', 'free'], 'disk', issues)) {
    for (const key of ['total', 'used', 'free']) check(issues, `disk.${key}`, isBytes(disk[key]));
  }

  const b = s.battery;
  if (b !== null && exactKeys(b, ['percent', 'charging', 'onAC', 'cycles', 'health'], 'battery', issues)) {
    check(issues, 'battery.percent', isPercent(b.percent));
    check(issues, 'battery.charging', typeof b.charging === 'boolean');
    check(issues, 'battery.onAC', typeof b.onAC === 'boolean');
    check(issues, 'battery.cycles', Number.isInteger(b.cycles) && b.cycles >= 0);
    check(issues, 'battery.health', isPercent(b.health));
  }

  const p = s.processes;
  if (exactKeys(p, ['count', 'top'], 'processes', issues)) {
    check(issues, 'processes.count', Number.isInteger(p.count) && p.count >= 0);
    if (!Array.isArray(p.top) || p.top.length > 10) issues.push('processes.top');
    else
      p.top.forEach((row, i) => {
        if (exactKeys(row, ['name', 'memory', 'cpu'], `processes.top.${i}`, issues)) {
          check(issues, `processes.top.${i}.name`, typeof row.name === 'string' && isPublishableName(row.name));
          check(issues, `processes.top.${i}.memory`, isBytes(row.memory));
          check(issues, `processes.top.${i}.cpu`, isPercent(row.cpu));
          if (i > 0) check(issues, `processes.top.${i}.memory`, row.memory <= p.top[i - 1].memory);
        }
      });
  }
  return [...new Set(issues)];
}
