// Fakes for the two things the collector talks to, backed by fixtures so no test reads the real machine.
import { readFileSync } from 'node:fs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
export const sysctlFixture = JSON.parse(fixture('sysctl.json'));
export const siFixture = JSON.parse(fixture('si.json'));
export const vmStatFixture = fixture('vm_stat.txt');

export function fakeRun(overrides = {}) {
  const calls = [];
  async function run(name, args = []) {
    calls.push([name, ...args]);
    if (name === 'vm_stat') return vmStatFixture;
    if (name === 'sw_vers') return `${sysctlFixture['sw_vers -productVersion']}\n`;
    const key = args.at(-1);
    if (key in overrides) {
      if (overrides[key] instanceof Error) throw overrides[key];
      return `${overrides[key]}\n`;
    }
    if (!(key in sysctlFixture)) throw new Error(`sysctl: unknown oid '${key}'`);
    return `${sysctlFixture[key]}\n`;
  }
  run.calls = calls;
  return run;
}

export function fakeSysinfo(overrides = {}) {
  const calls = { currentLoad: 0, system: 0 };
  return {
    calls,
    async system() {
      calls.system += 1;
      return structuredClone(siFixture.system);
    },
    async currentLoad() {
      calls.currentLoad += 1;
      return structuredClone(siFixture.currentLoad);
    },
    async fsSize() {
      return structuredClone(overrides.fsSize ?? siFixture.fsSize);
    },
    async battery() {
      return structuredClone(overrides.battery ?? siFixture.battery);
    },
    async processes() {
      return structuredClone(siFixture.processes);
    },
  };
}
