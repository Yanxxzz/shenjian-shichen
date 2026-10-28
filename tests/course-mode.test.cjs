'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const bridge = path.resolve(__dirname, '../skills/gcsjsb/scripts/sjoop_bridge.cjs');
const { normalizeOptions, prepareTargets } = require(bridge);
const configDir = path.resolve(__dirname, '../skills/gcsjsb/examples');
const linux = { host: 'oop.example.edu', studentId: 'example' };

test('unspecified course remains local and ignores SSH configuration', () => {
  const result = normalizeOptions({ sources: ['hello.cpp'], sshConfig: linux }, configDir, {});
  assert.equal(result.course, 'gaocheng');
  assert.deepEqual(result.options.selectedCompilers, ['msvc', 'mingw']);
  assert.equal(result.options.sshConfig, undefined);
});

test('gaocheng cannot select Linux, even with valid SSH settings', () => {
  assert.throws(() => normalizeOptions({ course: 'gaocheng', sources: ['hello.cpp'],
    selectedCompilers: ['msvc', 'linux'], sshConfig: linux }, configDir, {}), /only for course=oop/);
});

test('OOP supports Linux and resolves its private key relative to the config', () => {
  const { options } = normalizeOptions({ course: 'oop', sources: ['hello.cpp'],
    sshConfig: { ...linux, privateKeyPath: '../keys/example' } }, configDir, {});
  assert.deepEqual(options.selectedCompilers, ['msvc', 'mingw', 'linux']);
  assert.equal(options.sshConfig.privateKeyPath, path.resolve(configDir, '../keys/example'));
  assert.equal(options.sources[0], path.join(configDir, 'hello.cpp'));
});

test('OOP can choose only local compilers without SSH configuration', () => {
  const { options } = normalizeOptions({ course: 'oop', sources: ['hello.cpp'],
    selectedCompilers: ['mingw'] }, configDir, {});
  assert.equal(options.sshConfig, undefined);
});

test('unknown courses and unconfigured OOP Linux fail clearly', () => {
  assert.throws(() => normalizeOptions({ course: 'other', sources: ['hello.cpp'] }, configDir, {}), /course must/);
  assert.throws(() => normalizeOptions({ course: 'oop', sources: ['hello.cpp'] }, configDir, {}), /requires sshConfig/);
});

test('batch targets retain their course boundary when overriding defaults', () => {
  assert.throws(() => prepareTargets({ defaults: { course: 'oop', sources: ['hello.cpp'], sshConfig: linux },
    targets: [{ id: 'oop' }, { id: 'gaocheng', course: 'gaocheng', selectedCompilers: ['linux'] }] }, configDir, {}), /only for course=oop/);
  const targets = prepareTargets({ defaults: { sources: ['hello.cpp'] }, targets: [
    { id: 'local' }, { id: 'remote', course: 'oop', sshConfig: linux },
  ] }, configDir, {});
  assert.deepEqual(targets.map(target => target.course), ['gaocheng', 'oop']);
  assert.equal(targets[0].options.selectedCompilers.includes('linux'), false);
  assert.equal(targets[1].options.selectedCompilers.includes('linux'), true);
});

test('Linux settings support environment variables without storing them in the input', () => {
  const raw = { course: 'oop', sources: ['hello.cpp'] };
  const { options } = normalizeOptions(raw, configDir, {
    SJOOP_SSH_HOST: 'oop.example.edu', SJOOP_STUDENT_ID: 'example', SJOOP_KEY_PASSPHRASE: 'test-only',
  });
  assert.equal(options.sshConfig.host, 'oop.example.edu');
  assert.equal(options.sshConfig.passphrase, 'test-only');
  assert.equal(raw.sshConfig, undefined);
});

test('CLI validates examples without needing the extension', () => {
  for (const name of ['gaocheng', 'oop']) {
    const result = spawnSync(process.execPath, [bridge, '--config', path.join(configDir, `${name}.example.json`), '--check-config'],
      { encoding: 'utf8', env: { ...process.env, SJOOP_EXTENSION_DIR: 'missing-extension' } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).targets[0].course, name);
  }
});

test('CLI rejects a later invalid batch target before loading the extension', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shenjian-course-test-'));
  try {
    const config = path.join(dir, 'batch.json');
    fs.writeFileSync(config, JSON.stringify({ defaults: { sources: ['hello.cpp'] },
      targets: [{ id: 'local' }, { id: 'invalid', selectedCompilers: ['linux'] }] }));
    const result = spawnSync(process.execPath, [bridge, '--config', config],
      { encoding: 'utf8', env: { ...process.env, SJOOP_EXTENSION_DIR: 'missing-extension' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /only for course=oop/);
    assert.doesNotMatch(result.stderr, /TypeScript|Cannot find module/);
  } finally {
    // Only remove the exact file and directory created by this test.
    fs.unlinkSync(path.join(dir, 'batch.json'));
    fs.rmdirSync(dir);
  }
});
