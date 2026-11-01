// Turns raw process rows into the "top apps by memory" list. Only names leave the machine:
// never a pid, user, path, command line or argument. Pure functions, no I/O.
import { posix } from 'node:path';

const MAX_NAME = 48;
const TOP_N = 10;
const ALLOWED = /^[\p{L}\p{N} ._()+&-]+$/u;
const FORBIDDEN_CHARS = /[/@=:]/;
const THREE_DIGITS = /\d{3}/;
// ".mjs" or "report.py" is a file name, not an app.
const FILE_LIKE = /^\.|\.[A-Za-z0-9]{1,5}$/;
// A lowercase word in a multi-word name ("npm run dev") reads as a command line, not an app title.
const COMMAND_WORD = /(^| )[a-z]{2,}( |$)/;
const WEBKIT_PREFIX = 'com.apple.WebKit.';
const WEBKIT_APP = 'Safari (WebKit)';
// "Google Chrome Helper (Renderer)" -> "Google Chrome"; WebKit's own helpers are handled by prefix.
const HELPER_SUFFIX = / Helper(?: \([A-Za-z ]+\))?$| Web Content$| Networking$/;
// The outermost .app in a system or user Applications folder owns every helper nested inside it.
const APP_BUNDLE = /^(?:\/Applications|\/System\/Applications|\/System\/Library|\/Library|\/Users\/[^/]+\/Applications)\/(?:[^/]+\/)*?([^/]+)\.app(?:\/|$)/;
// Firefox-family content processes carry no app name of their own; they belong to their parent.
const CHILD_PROCESSES = new Set(['plugin-container']);
// Processes whose own name means little to a reader. The VM is Colima's, which runs Docker (and n8n).
const DISPLAY_NAMES = new Map([
  ['com.apple.Virtualization.VirtualMachine', 'Docker VM'],
  ['claude', 'Claude Code'],
  ['node', 'Node'],
]);

// Hidden unless the owner opts back in by editing this list. SPECS_AGENT_DENY adds to it; it cannot shrink it.
export const DEFAULT_DENY = [
  'password', 'keychain', '1password', 'bitwarden', 'keepass', 'lastpass', 'dashlane', 'enpass', 'authenticator',
  'vpn', 'wireguard', 'tailscale', 'tunnelblick', 'mullvad', 'cloudflare warp', 'cloudflared',
  'messages', 'mail', 'outlook', 'thunderbird', 'signal', 'whatsapp', 'telegram', 'slack', 'discord', 'wechat',
  'microsoft teams', 'zoom',
];

export function parseDenylist(value) {
  const extra = String(value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_DENY, ...extra])];
}

export function appName(rawName) {
  const base = posix.basename(String(rawName ?? '')).trim();
  if (base.startsWith(WEBKIT_PREFIX)) return WEBKIT_APP;
  return base.replace(HELPER_SUFFIX, '').trim();
}

// True when a name is safe to publish: short, plain characters, nothing that looks like data or a command.
export function isPublishableName(name) {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME &&
    ALLOWED.test(name) &&
    !FORBIDDEN_CHARS.test(name) &&
    !THREE_DIGITS.test(name) &&
    !FILE_LIKE.test(name) &&
    !(name.includes(' ') && COMMAND_WORD.test(name))
  );
}

function isDenied(name, deny) {
  const lower = name.toLowerCase();
  return deny.some((d) => lower.includes(d));
}

// `app` is true when the name came from an app bundle or a stripped helper suffix, so a space is a real
// app-name space. Anything else may be a process title set by a script, and must be a single word.
function resolve(row) {
  const raw = posix.basename(String(row?.name ?? '')).trim();
  const alias = DISPLAY_NAMES.get(raw);
  if (alias) return { raw, name: alias, app: true };
  const bundle = APP_BUNDLE.exec(String(row?.path ?? ''))?.[1]?.trim();
  if (bundle) return { raw, name: bundle, app: true };
  const name = appName(raw);
  return { raw, name, app: name !== raw };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {Array<{pid?: number, parentPid?: number, name?: string, path?: string, memRss?: number, cpu?: number}>} list
 *   rows from si.processes().list (memRss in KB)
 * @param {{deny?: string[], limit?: number}} [options]
 * @returns {Array<{name: string, memory: number, cpu: number}>} sorted by memory, descending
 */
export function topProcesses(list, { deny = DEFAULT_DENY, limit = TOP_N } = {}) {
  const resolved = list.map(resolve);
  const byPid = new Map(list.map((row, i) => [row?.pid, resolved[i]]));
  const groups = new Map();
  list.forEach((row, i) => {
    let r = resolved[i];
    if (!r.app && CHILD_PROCESSES.has(r.name)) r = Number.isInteger(row.parentPid) ? byPid.get(row.parentPid) : undefined;
    if (!r || isDenied(r.raw, deny) || isDenied(r.name, deny)) return;
    if (!isPublishableName(r.name) || (!r.app && r.name.includes(' '))) return;
    const memory = Math.max(0, Number(row.memRss) || 0) * 1024;
    const cpu = Math.max(0, Number(row.cpu) || 0);
    const group = groups.get(r.name) ?? { name: r.name, memory: 0, cpu: 0 };
    group.memory += memory;
    group.cpu += cpu;
    groups.set(r.name, group);
  });
  return [...groups.values()]
    .sort((a, b) => b.memory - a.memory || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((g) => ({
      name: g.name,
      memory: Math.round(g.memory),
      // ps %cpu is per core and can pass 100; the contract is 0-100.
      cpu: round1(Math.min(100, g.cpu)),
    }));
}
