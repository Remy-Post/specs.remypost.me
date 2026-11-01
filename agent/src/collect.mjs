// Builds one Snapshot v1 (docs/SPEC.md). Machine facts are cached for 10 minutes; everything else is read
// per call. Native tools run through execFile (no shell), and only an allowlist of fields is ever copied out
// of systeminformation, which also returns serials, UUIDs and the hostname.
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import si from 'systeminformation';
import { memoryFromVmStat, parseBootTime, parseSwapUsage, parseVmStat, pressureWord } from './parse.mjs';
import { parseDenylist, topProcesses } from './sanitize.mjs';
import { validateSnapshot } from './validate.mjs';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT_MS = 5000;
const FACTS_TTL_MS = 10 * 60 * 1000;
const CPU_SAMPLE_MS = 1000;
const DATA_VOLUME = '/System/Volumes/Data';

// Absolute paths and a fixed environment, so a user's PATH or locale can't change what runs or how it prints.
const COMMANDS = { sysctl: '/usr/sbin/sysctl', vm_stat: '/usr/bin/vm_stat', sw_vers: '/usr/bin/sw_vers' };

export async function runCommand(name, args = []) {
  const { stdout } = await execFileAsync(COMMANDS[name], args, {
    timeout: CMD_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' },
  });
  return stdout;
}

const round1 = (n) => Math.round(n * 10) / 10;

function percent(n, label) {
  if (!Number.isFinite(n)) throw new RangeError(`${label} is not a number`);
  return round1(Math.min(100, Math.max(0, n)));
}

const bytes = (n) => Math.max(0, Math.round(Number(n) || 0));

// Drops every character the contract's label patterns refuse, then trims to the length limit.
const LABEL_STRIP = /[^\p{L}\p{N} .,()+&-]/gu;
const CORE_STRIP = /[^\p{L}\p{N} ._()+&-]/gu;
const text = (value, max, strip = LABEL_STRIP) =>
  String(value ?? '')
    .replace(strip, '')
    .trim()
    .slice(0, max);

/**
 * @param {{ run?: typeof runCommand, sysinfo?: typeof si, now?: () => Date, sleepMs?: (ms: number) => Promise<unknown>,
 *           deny?: string[], factsTtlMs?: number, cpuSampleMs?: number }} [deps]
 */
export function createCollector({
  run = runCommand,
  sysinfo = si,
  now = () => new Date(),
  sleepMs = sleep,
  deny = parseDenylist(process.env.SPECS_AGENT_DENY),
  factsTtlMs = FACTS_TTL_MS,
  cpuSampleMs = CPU_SAMPLE_MS,
} = {}) {
  let facts = null;
  let factsAt = 0;

  const sysctl = async (key) => (await run('sysctl', ['-n', key])).trim();

  async function readCores() {
    const levels = Number(await sysctl('hw.nperflevels').catch(() => 0));
    const cores = [];
    for (let i = 0; i < Math.min(levels, 4); i++) {
      const [name, count] = await Promise.all([sysctl(`hw.perflevel${i}.name`), sysctl(`hw.perflevel${i}.physicalcpu`)]);
      cores.push({ name: text(name, 24, CORE_STRIP) || 'Cores', count: Number(count) });
    }
    return cores.length > 0 ? cores : [{ name: 'Cores', count: availableParallelism() }];
  }

  async function readMachine() {
    const [system, chip, cores, memsize, version, boottime] = await Promise.all([
      sysinfo.system(),
      sysctl('machdep.cpu.brand_string'),
      readCores(),
      sysctl('hw.memsize'),
      run('sw_vers', ['-productVersion']),
      sysctl('kern.boottime'),
    ]);
    return {
      model: text(system.version, 80) || text(await sysctl('hw.model'), 80),
      chip: text(chip, 60),
      cores,
      memory: bytes(memsize),
      os: text(`macOS ${version.trim()}`, 40),
      bootedAt: parseBootTime(boottime),
    };
  }

  async function machineFacts() {
    if (!facts || now().getTime() - factsAt >= factsTtlMs) {
      facts = await readMachine();
      factsAt = now().getTime();
    }
    return facts;
  }

  async function readMemory(total) {
    const [vmStat, swap, level, pressure] = await Promise.all([
      run('vm_stat'),
      sysctl('vm.swapusage'),
      sysctl('kern.memorystatus_level'),
      sysctl('kern.memorystatus_vm_pressure_level'),
    ]);
    const { app, wired, compressed, used, cached } = memoryFromVmStat(parseVmStat(vmStat));
    const { swapUsed, swapTotal } = parseSwapUsage(swap);
    return {
      total,
      used,
      app,
      wired,
      compressed,
      cached,
      swapUsed,
      swapTotal,
      freePercent: percent(Number(level), 'kern.memorystatus_level'),
      pressure: pressureWord(pressure),
    };
  }

  // currentLoad() reports the change since its previous call; a call a second after a priming one measures "now",
  // not an average over the 5 minutes since the last poll.
  async function readCpu() {
    await sysinfo.currentLoad();
    await sleepMs(cpuSampleMs);
    const load = await sysinfo.currentLoad();
    return {
      load: percent(load.currentLoad, 'cpu.load'),
      user: percent(load.currentLoadUser, 'cpu.user'),
      system: percent(load.currentLoadSystem, 'cpu.system'),
      perCore: load.cpus.slice(0, 64).map((core, i) => percent(core.load, `cpu.perCore.${i}`)),
    };
  }

  async function readDisk() {
    const volumes = await sysinfo.fsSize();
    const volume = volumes.find((v) => v.mount === DATA_VOLUME) ?? volumes.find((v) => v.mount === '/');
    if (!volume) throw new Error('no data volume found');
    // APFS volumes share one container, so "used" is the container size minus what is still available.
    const total = bytes(volume.size);
    const free = Math.min(total, bytes(volume.available));
    return { total, used: total - free, free };
  }

  async function readBattery() {
    const b = await sysinfo.battery();
    if (!b.hasBattery) return null;
    const design = Number(b.designedCapacity);
    const health = design > 0 ? percent((Number(b.maxCapacity) / design) * 100, 'battery.health') : null;
    // Without capacities the health figure can't be computed honestly, so report no battery at all.
    if (health === null) return null;
    return {
      percent: percent(b.percent, 'battery.percent'),
      charging: Boolean(b.isCharging),
      onAC: Boolean(b.acConnected),
      cycles: Math.max(0, Math.trunc(Number(b.cycleCount) || 0)),
      health,
    };
  }

  async function readProcesses() {
    const procs = await sysinfo.processes();
    return { count: procs.list.length, top: topProcesses(procs.list, { deny }) };
  }

  return async function collect() {
    const machine = await machineFacts();
    const [memory, cpu, disk, battery, processes] = await Promise.all([
      readMemory(machine.memory),
      readCpu(),
      readDisk(),
      readBattery(),
      readProcesses(),
    ]);
    const snapshot = { v: 1, at: now().toISOString(), machine, memory, cpu, disk, battery, processes };
    const issues = validateSnapshot(snapshot);
    if (issues.length > 0) throw new Error(`snapshot breaks Snapshot v1 at: ${issues.join(', ')}`);
    return snapshot;
  };
}
