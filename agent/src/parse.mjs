// Parsers for the text that vm_stat, sysctl and sw_vers print. Pure functions so tests can feed them fixtures.

const VM_FIELDS = {
  wired: 'Pages wired down',
  anonymous: 'Anonymous pages',
  purgeable: 'Pages purgeable',
  fileBacked: 'File-backed pages',
  compressor: 'Pages occupied by compressor',
};

export function parseVmStat(text) {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('vm_stat: page size not found');
  const pages = {};
  for (const [key, label] of Object.entries(VM_FIELDS)) {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, 'm').exec(text);
    if (!match) throw new Error(`vm_stat: "${label}" not found`);
    pages[key] = Number(match[1]);
  }
  return { pageSize, ...pages };
}

// Activity Monitor's arithmetic: used = app + wired + compressed.
export function memoryFromVmStat(vm) {
  const bytes = (pages) => pages * vm.pageSize;
  const app = bytes(Math.max(0, vm.anonymous - vm.purgeable));
  const wired = bytes(vm.wired);
  const compressed = bytes(vm.compressor);
  return { app, wired, compressed, used: app + wired + compressed, cached: bytes(vm.fileBacked) };
}

const UNIT = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

// "total = 7168.00M  used = 5940.31M  free = 1227.69M  (encrypted)"
export function parseSwapUsage(text) {
  const read = (label) => {
    const match = new RegExp(`${label} = ([\\d.]+)([KMGT])`).exec(text);
    if (!match) throw new Error(`vm.swapusage: ${label} not found`);
    return Math.round(Number(match[1]) * UNIT[match[2]]);
  };
  return { swapTotal: read('total'), swapUsed: read('used') };
}

// "{ sec = 1793110834, usec = 793548 } Tue Oct 27 10:20:34 2026"
export function parseBootTime(text) {
  const sec = Number(/sec = (\d+)/.exec(text)?.[1]);
  if (!Number.isFinite(sec) || sec <= 0) throw new Error('kern.boottime: sec not found');
  return new Date(sec * 1000).toISOString();
}

const PRESSURE = { 1: 'normal', 2: 'warn', 4: 'critical' };

// Unknown levels read as normal rather than inventing a state the schema doesn't have.
export function pressureWord(level) {
  return PRESSURE[Number(level)] ?? 'normal';
}
