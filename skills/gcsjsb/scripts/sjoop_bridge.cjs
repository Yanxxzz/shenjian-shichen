#!/usr/bin/env node
'use strict';

// Independent adapter; third-party extension source is not bundled or modified.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function argument(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
  return value;
}

function normalizeOptions(raw, configDir, env = process.env) {
  const course = raw.course ?? 'gaocheng';
  if (!['gaocheng', 'oop'].includes(course)) {
    throw new Error('course must be gaocheng or oop.');
  }
  const selected = raw.selectedCompilers ?? (course === 'oop' ? ['msvc', 'mingw', 'linux'] : ['msvc', 'mingw']);
  if (!Array.isArray(selected) || !selected.length || selected.some(name => !['msvc', 'mingw', 'linux'].includes(name))) {
    throw new Error('selectedCompilers must contain msvc, mingw, and/or linux.');
  }
  // Check the course before touching extension code, credentials or the network.
  if (selected.includes('linux') && course !== 'oop') {
    throw new Error('Linux verification is available only for course=oop; gaocheng uses local compilers.');
  }
  if (!Array.isArray(raw.sources) || !raw.sources.length || raw.sources.some(source => typeof source !== 'string' || !source)) {
    throw new Error('Each target requires a nonempty sources array of paths.');
  }
  const { course: ignoredCourse, sshConfig, ...options } = raw;
  options.selectedCompilers = [...selected];
  options.workspaceRoot = path.resolve(configDir, raw.workspaceRoot || '.');
  options.sources = raw.sources.map(source => path.resolve(configDir, source));
  options.outputBaseName ||= path.basename(options.sources[0], path.extname(options.sources[0]));
  options.testCases ??= [];
  options.timeoutMs ??= 5000;
  options.strictDiff ??= true;
  options.normalizeNewlines ??= true;
  options.stripTrailingNewlines ??= false;
  if (selected.includes('linux')) {
    const ssh = { port: 22, remoteDir: '~/sjoop_tmp', flags: [], ...sshConfig };
    ssh.host ||= env.SJOOP_SSH_HOST;
    ssh.studentId ||= env.SJOOP_STUDENT_ID;
    ssh.privateKeyPath ||= env.SJOOP_PRIVATE_KEY_PATH;
    if (typeof ssh.host !== 'string' || !ssh.host.trim() || typeof ssh.studentId !== 'string' || !ssh.studentId.trim()) {
      throw new Error('OOP Linux verification requires sshConfig.host and studentId, or their SJOOP environment variables.');
    }
    // Keep passphrases out of JSON configuration and result files.
    if (ssh.passphrase) throw new Error('Use SJOOP_KEY_PASSPHRASE instead of a passphrase in JSON.');
    if (env.SJOOP_KEY_PASSPHRASE) ssh.passphrase = env.SJOOP_KEY_PASSPHRASE;
    if (ssh.privateKeyPath) ssh.privateKeyPath = path.resolve(configDir, ssh.privateKeyPath);
    options.sshConfig = ssh;
  }
  if (options.customGpp) options.customGpp = path.resolve(configDir, options.customGpp);
  if (options.customVcvars) options.customVcvars = path.resolve(configDir, options.customVcvars);
  return { course, options };
}

function prepareTargets(config, configDir, env = process.env) {
  if (Object.hasOwn(config, 'targets')) {
    if (!Array.isArray(config.targets) || !config.targets.length) {
      throw new Error('targets must be a nonempty array.');
    }
    return config.targets.map((target, index) => {
      const { id, ...raw } = { ...config.defaults, ...target };
      return { id: id || String(index + 1), ...normalizeOptions(raw, configDir, env) };
    });
  }
  return [{ id: config.id || '1', ...normalizeOptions(config, configDir, env) }];
}

function latestDirectory(parent, prefix) {
  if (!fs.existsSync(parent)) return undefined;
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => path.join(parent, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function locateTypescript(extensionDir, argv) {
  const supplied = argument(argv, '--typescript') || process.env.SJOOP_TYPESCRIPT_PATH;
  if (supplied) return require.resolve(path.resolve(supplied));
  try { return require.resolve('typescript', { paths: [extensionDir, process.cwd()] }); } catch {}
  const roots = new Set([
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code'),
    path.join(process.env.ProgramFiles || '', 'Microsoft VS Code'),
    ...String(process.env.PATH || '').split(path.delimiter)
      .filter(item => item && fs.existsSync(path.join(item, 'code.cmd')))
      .map(item => path.resolve(item, '..')),
  ]);
  const suffix = 'resources/app/extensions/node_modules/typescript/lib/typescript.js';
  for (const root of roots) {
    const direct = path.join(root, suffix);
    if (fs.existsSync(direct)) return direct;
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = path.join(root, entry.name, suffix);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error('TypeScript was not found; supply --typescript PATH or SJOOP_TYPESCRIPT_PATH.');
}

function loadRunner(argv) {
  const extensionDir = argument(argv, '--extension') || process.env.SJOOP_EXTENSION_DIR ||
    latestDirectory(path.join(os.homedir(), '.vscode', 'extensions'), 'jeefy.sjoop-assistant-');
  if (!extensionDir) throw new Error('SJOOP Assistant is not installed; supply --extension DIR.');
  const ts = require(locateTypescript(extensionDir, argv));
  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText;
    module._compile(compiled, filename);
  };
  return require(path.join(extensionDir, 'src', 'compilers', 'runner.ts')).CompilerRunner;
}

function failed(result) {
  return Object.values(result.compilations).some(item => item && !item.success) ||
    Object.values(result.runs).flat().some(item => item.status !== 'AC');
}

function emit(value, output) {
  const json = JSON.stringify(value, null, 2) + '\n';
  if (!output) {
    process.stdout.write(json);
    return;
  }
  const destination = path.resolve(output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, json, 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node sjoop_bridge.cjs --config options.json [--check-config] [--output result.json]\n' +
      'Options: --extension DIR, --typescript PATH. Paths in JSON resolve against the config directory.\n' +
      'course: gaocheng (default, local compilers only), or oop (Linux SSH available).\n' +
      '--check-config validates every target without loading the extension, compiling or connecting.\n');
    return 0;
  }
  const configPath = argument(argv, '--config');
  if (!configPath) throw new Error('Missing --config options.json.');
  const fullPath = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, ''));
  // Prepare every target before starting any compiler or SSH operation.
  const targets = prepareTargets(config, path.dirname(fullPath));
  const output = argument(argv, '--output');
  if (argv.includes('--check-config')) {
    emit({ valid: true, targets: targets.map(({ id, course, options }) => ({
      id, course, selectedCompilers: options.selectedCompilers,
    })) }, output);
    return 0;
  }
  const runner = loadRunner(argv);
  const results = [];
  let anyFailure = false;
  for (const { id, course, options } of targets) {
    options.onProgress = message => process.stderr.write(`[${id}] ${message}\n`);
    try {
      const result = await runner.executeBatch(options);
      results.push({ id, course, selectedCompilers: options.selectedCompilers, result });
      anyFailure ||= failed(result);
    } catch (error) {
      results.push({ id, course, error: error.message });
      anyFailure = true;
    }
    if (output) emit({ targets: results }, output);
  }
  if (!output) emit({ targets: results });
  return Number(anyFailure);
}

module.exports = { normalizeOptions, prepareTargets, main };
if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`[SJOOP bridge] ${error.message}\n`);
    process.exitCode = 1;
  });
}
