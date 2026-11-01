import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DENY, appName, isPublishableName, parseDenylist, topProcesses } from '../src/sanitize.mjs';

const row = (name, memRss, cpu = 0, extra = {}) => ({ name, memRss, cpu, ...extra });

test('appName keeps only the basename and folds helpers into their app', () => {
  assert.equal(appName('/Applications/Safari.app/Contents/MacOS/Safari'), 'Safari');
  assert.equal(appName('Google Chrome Helper (Renderer)'), 'Google Chrome');
  assert.equal(appName('Claude Helper (GPU)'), 'Claude');
  assert.equal(appName('Slack Helper'), 'Slack');
  assert.equal(appName('Code Helper (Plugin)'), 'Code');
  assert.equal(appName('Firefox Web Content'), 'Firefox');
  assert.equal(appName('Firefox Networking'), 'Firefox');
  assert.equal(appName('com.apple.WebKit.WebContent'), 'Safari (WebKit)');
  assert.equal(appName('com.apple.WebKit.Networking'), 'Safari (WebKit)');
  assert.equal(appName('Helper'), 'Helper');
});

test('isPublishableName rejects anything that could carry data', () => {
  for (const ok of ['Safari', 'Google Chrome', 'Safari (WebKit)', 'iStat Menus', 'a-b_c+d&e', 'Café', '日本語アプリ']) {
    assert.equal(isPublishableName(ok), true, ok);
  }
  const bad = ['', 'node.js', 'build.mjs', '.t2tmp.mjs', 'npm run dev', 'claude daemon run', 'node secret-project.js', 'npm run deploy-acme', 'a/b', 'user@host', 'KEY=value', 'host:8080', 'App 123', 'x'.repeat(49), 'tab\there', 'bell\u0007', 'emoji 😀', 'semi;colon', 'quote"d'];
  for (const name of bad) assert.equal(isPublishableName(name), false, JSON.stringify(name));
  assert.equal(isPublishableName('x'.repeat(48)), true);
  assert.equal(isPublishableName('App 12'), true);
});

test('topProcesses groups helpers, converts KB to bytes and sorts by memory', () => {
  const top = topProcesses([
    row('Google Chrome', 100, 1.04, { path: '/Applications/Google Chrome.app/Contents/MacOS' }),
    row('Google Chrome Helper (Renderer)', 300, 2.06),
    row('Google Chrome Helper (GPU)', 50, 0.5),
    row('Xcode', 200, 0.4),
    row('com.apple.WebKit.WebContent', 40, 0.2),
    row('com.apple.WebKit.Networking', 10, 0.1),
  ]);
  assert.deepEqual(top, [
    { name: 'Google Chrome', memory: 450 * 1024, cpu: 3.6 },
    { name: 'Xcode', memory: 200 * 1024, cpu: 0.4 },
    { name: 'Safari (WebKit)', memory: 50 * 1024, cpu: 0.3 },
  ]);
});

test('topProcesses drops names that look like data and never exposes a path', () => {
  const top = topProcesses([
    row('/Users/someone/work/server', 500),
    row('node --token=abc', 900),
    row('user@host', 800),
    row('worker 1234', 700),
    row('proc:one', 600),
    row('x'.repeat(60), 650),
    row('', 100),
    { memRss: 100 },
    row('Finder', 50),
  ]);
  assert.deepEqual(
    top.map((p) => p.name),
    ['server', 'Finder'],
  );
});

test('topProcesses honours the denylist case-insensitively, before grouping', () => {
  const list = [row('Slack', 100), row('Slack Helper (Renderer)', 100), row('Notes', 50), row('Xcode', 10)];
  assert.deepEqual(
    topProcesses(list, { deny: parseDenylist(' SLACK , ,NOTE ') }).map((p) => p.name),
    ['Xcode'],
  );
});

test('topProcesses hides password managers, VPNs and messaging apps by default', () => {
  const hidden = ['1Password', 'Signal', 'Messages', 'Mail', 'WireGuard', 'Bitwarden', 'Keychain Circle Notification'];
  const list = [...hidden.map((name) => row(name, 500, 0, { path: `/Applications/${name}.app/Contents/MacOS` })), row('Finder', 10)];
  assert.deepEqual(
    topProcesses(list).map((p) => p.name),
    ['Finder'],
  );
});

test('topProcesses refuses script names and subcommands that a process title can carry', () => {
  const list = [
    row('node build-acme-report.js', 900),
    row('python quarterly-forecast.py', 800),
    row('npm run deploy-acme', 700),
    row('npm run dev', 650),
    row('node secret-project.js', 600),
    row('.t2tmp.mjs', 500),
    row('colima start', 400),
    row('Finder', 10),
  ];
  assert.deepEqual(
    topProcesses(list).map((p) => p.name),
    ['Finder'],
  );
});

test('a name with spaces needs an app bundle or a helper suffix; a script title does not get one', () => {
  const top = topProcesses([
    row('Visual Studio Code', 100),
    row('Visual Studio Code', 100, 0, { path: '/Applications/Visual Studio Code.app/Contents/MacOS' }),
    row('Code Helper (Renderer)', 300, 0, { path: '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS' }),
    row('Safari Web Content', 50),
  ]);
  assert.deepEqual(
    top.map((p) => p.name),
    ['Visual Studio Code', 'Safari'],
  );
  assert.equal(top[0].memory, 400 * 1024);
});

test('plugin-container is credited to the app that spawned it', () => {
  const top = topProcesses([
    row('zen', 100, 0, { pid: 10, parentPid: 1 }),
    row('plugin-container', 200, 0, { pid: 11, parentPid: 10 }),
    row('plugin-container', 300, 0, { pid: 12, parentPid: 10 }),
    row('plugin-container', 900, 0, { pid: 13, parentPid: 999 }),
    row('plugin-container', 900, 0, { pid: 14 }),
  ]);
  assert.deepEqual(top, [{ name: 'zen', memory: 600 * 1024, cpu: 0 }]);
  const bundled = topProcesses([
    row('plugin-container', 200, 0, { path: '/Applications/Zen.app/Contents/MacOS/plugin-container.app/Contents/MacOS' }),
    row('zen', 100, 0, { path: '/Applications/Zen.app/Contents/MacOS' }),
  ]);
  assert.deepEqual(bundled.map((p) => p.name), ['Zen']);
});

test('topProcesses limits to ten entries and caps cpu at 100', () => {
  const list = Array.from({ length: 15 }, (_, i) => row(`App${String.fromCharCode(65 + i)}`, 1000 - i, 250));
  const top = topProcesses(list);
  assert.equal(top.length, 10);
  assert.equal(top[0].name, 'AppA');
  assert.equal(top[0].cpu, 100);
  assert.deepEqual(
    top.map((p) => p.memory),
    [...top.map((p) => p.memory)].sort((a, b) => b - a),
  );
});

test('parseDenylist always keeps the defaults and adds the owner entries', () => {
  assert.deepEqual(parseDenylist(undefined), DEFAULT_DENY);
  assert.deepEqual(parseDenylist(''), DEFAULT_DENY);
  assert.deepEqual(parseDenylist('A, b ,,C'), [...DEFAULT_DENY, 'a', 'b', 'c']);
  assert.deepEqual(parseDenylist('Signal'), DEFAULT_DENY);
});

test('processes with cryptic names get a readable display name', () => {
  const top = topProcesses([
    row('com.apple.Virtualization.VirtualMachine', 300),
    row('claude', 200),
    row('node', 100),
  ]);
  assert.deepEqual(top.map((p) => p.name), ['Docker VM', 'Claude Code', 'Node']);
});
