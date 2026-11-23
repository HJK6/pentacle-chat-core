// Canonical distribution reader and verified-copy maintainer tool.
// No network for "check"; "verify" reads a fixed public Git repository.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const PUBLIC = 'https://github.com/HJK6/pentacle-chat-core.git';
const MAIN = 'refs/heads/main';
const COPY = 'pentacle-chat-core';
const PIN = 'config/pentacle-chat-core-pin.json';
const MANIFEST = 'distribution.json';
const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MODE = /^(100644|100755)$/;

function fail(message) {
  throw new Error('CHAT_CORE_VERIFICATION: ' + message);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeName(name) {
  return typeof name === 'string'
    && /^[a-zA-Z0-9._/-]+$/.test(name)
    && name.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git');
}

function ownKeys(obj, keys) {
  return obj && typeof obj === 'object' && !Array.isArray(obj)
    && Object.keys(obj).length === keys.length && keys.every(key => Object.hasOwn(obj, key));
}

function readPin(root) {
  const pin = JSON.parse(fs.readFileSync(path.join(root, PIN), 'utf8'));
  if (!ownKeys(pin, ['schema', 'representation', 'path', 'commit', 'files'])
      || pin.schema !== 3 || pin.representation !== 'verified_copy' || pin.path !== COPY
      || typeof pin.commit !== 'string' || !COMMIT.test(pin.commit) || !Array.isArray(pin.files)
      || !pin.files.length) fail('invalid pin');
  let previous = '';
  for (const entry of pin.files) {
    if (!ownKeys(entry, ['path', 'mode', 'sha256']) || !safeName(entry.path) || entry.path <= previous
        || typeof entry.mode !== 'string' || !MODE.test(entry.mode)
        || typeof entry.sha256 !== 'string' || !DIGEST.test(entry.sha256)) fail('invalid file index');
    previous = entry.path;
  }
  return pin;
}

function git(root, args) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|INDEX_FILE|CONFIG)(_|$)/.test(key)) {
      delete env[key];
    }
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = os.devNull;
  return execFileSync('git', args, { cwd: root, env, maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
}

function manifestPaths(bytes) {
  const data = JSON.parse(bytes.toString('utf8'));
  if (!ownKeys(data, ['schema', 'paths']) || data.schema !== 1 || !Array.isArray(data.paths)
      || !data.paths.includes(MANIFEST) || !data.paths.every(safeName)
      || data.paths.some((name, i, all) => all.some((other, j) => i !== j && (name === other || name.startsWith(other + '/'))))) {
    fail('invalid distribution manifest');
  }
  return data.paths;
}

function index(entries) {
  return entries.map(({ path, mode, bytes }) => ({ path, mode, sha256: hash(bytes) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function equalIndex(want, got, label) {
  const expected = new Map(want.map(row => [row.path, row]));
  for (const item of got) {
    const prior = expected.get(item.path);
    if (!prior) fail(label + ' unexpected entry: ' + item.path);
    if (prior.mode !== item.mode || prior.sha256 !== item.sha256) fail(label + ' mode or bytes differ: ' + item.path);
    expected.delete(item.path);
  }
  if (expected.size) fail(label + ' missing entry: ' + expected.keys().next().value);
}

function diskIndex(root) {
  const folder = path.join(root, COPY);
  if (!fs.lstatSync(folder).isDirectory()) fail('copy must be a real directory');
  const files = [];
  function walk(current, prefix) {
    for (const name of fs.readdirSync(current)) {
      // Local npm installs may create this root only; it must not be tracked.
      if (!prefix && name === 'node_modules') continue;
      const rel = prefix + name;
      if (!safeName(rel)) fail('invalid copy path');
      const full = path.join(current, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        if (!fs.readdirSync(full).length) fail('unexpected empty directory: ' + rel);
        walk(full, rel + '/');
      } else if (stat.isFile()) {
        files.push({ path: rel, mode: (stat.mode & 0o100) ? '100755' : '100644', bytes: fs.readFileSync(full) });
      } else fail('non-regular copy entry: ' + rel);
    }
  }
  walk(folder, '');
  if (fs.existsSync(path.join(root, '.git'))
      && git(root, ['ls-files', '-z', '--', COPY + '/node_modules']).length) fail('tracked node_modules');
  return index(files);
}

function check(root) {
  const pin = readPin(root);
  equalIndex(pin.files, diskIndex(root), 'local copy');
  return pin;
}

function gitEntries(upstream, commit) {
  if (!COMMIT.test(commit)) fail('expected a full immutable commit');
  if (git(upstream, ['cat-file', '-t', commit]).toString().trim() !== 'commit') fail('not a commit');
  try {
    git(upstream, ['merge-base', '--is-ancestor', commit, MAIN]);
  } catch {
    fail('commit is not reachable from public main');
  }
  const sections = manifestPaths(git(upstream, ['show', commit + ':' + MANIFEST]));
  const listing = git(upstream, ['ls-tree', '-r', '-z', commit, '--', ...sections])
    .toString('utf8').split('\0').filter(Boolean);
  const entries = listing.map(line => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match || !safeName(match[3])) fail('non-regular upstream entry');
    return { path: match[3], mode: match[1], bytes: git(upstream, ['cat-file', 'blob', match[2]]) };
  });
  for (const section of sections) {
    if (!entries.some(row => row.path === section || row.path.startsWith(section + '/'))) {
      fail('missing distribution path: ' + section);
    }
  }
  return entries;
}

function checkAgainstGit(root, upstream) {
  const pin = check(root);
  const official = index(gitEntries(upstream, pin.commit));
  equalIndex(official, pin.files, 'upstream commit');
  return pin;
}

// Exported for the maintainer script and disposable fixtures. The CI entry
// acquires its own trusted main rather than following a consumer-supplied URL.
function syncFromGit(root, upstream, commit) {
  const entries = gitEntries(upstream, commit);
  const folder = path.join(root, COPY);
  const config = path.join(root, 'config');
  if (fs.existsSync(folder) && !fs.lstatSync(folder).isDirectory()) fail('copy must be a real directory');
  if (fs.existsSync(config) && !fs.lstatSync(config).isDirectory()) fail('config must be a real directory');
  const temp = fs.mkdtempSync(path.join(root, '.chat-core-sync-'));
  try {
    const staged = path.join(temp, 'copy');
    for (const { path: filename, mode, bytes } of entries) {
      const target = path.join(staged, filename);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: 'wx' });
      fs.chmodSync(target, mode === '100755' ? 0o755 : 0o644);
    }
    const pin = { schema: 3, representation: 'verified_copy', path: COPY, commit, files: index(entries) };
    fs.writeFileSync(path.join(temp, 'pin'), JSON.stringify(pin, null, 2) + '\n', { flag: 'wx' });
    fs.mkdirSync(config, { recursive: true });
    const backup = path.join(temp, 'previous');
    const hadCopy = fs.existsSync(folder);
    if (hadCopy) fs.renameSync(folder, backup);
    try {
      fs.renameSync(staged, folder);
      fs.renameSync(path.join(temp, 'pin'), path.join(root, PIN));
    } catch (error) {
      fs.rmSync(folder, { recursive: true, force: true });
      if (hadCopy) fs.renameSync(backup, folder);
      throw error;
    }
    return pin;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function withPublicMain(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-core-public-'));
  try {
    git(temp, ['clone', '--quiet', '--bare', '--no-tags', '--single-branch', '--branch', 'main', PUBLIC, 'upstream']);
    return fn(path.join(temp, 'upstream'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const [verb, destination, commit, ...extra] = process.argv.slice(2);
    const root = path.resolve(destination || '.');
    if (extra.length || (!['sync', 'check-tree'].includes(verb) && commit !== undefined)) fail('unexpected arguments');
    const pin = verb === 'check' ? check(root)
      : verb === 'verify' ? withPublicMain(upstream => checkAgainstGit(root, upstream))
      : verb === 'check-tree' && commit ? checkAgainstGit(root, path.resolve(commit))
      : verb === 'sync' && COMMIT.test(commit || '') ? withPublicMain(upstream => syncFromGit(root, upstream, commit))
      : fail('usage: verified-copy.cjs check|verify CONSUMER, or sync CONSUMER COMMIT');
    process.stdout.write('chat core ' + pin.commit + '\n');
  } catch (error) {
    process.stderr.write(String(error.message || error) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { check, checkAgainstGit, syncFromGit };
