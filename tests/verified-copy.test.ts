import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import verifier from '../scripts/verified-copy.cjs';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function rig(t: TestContext) {
  const tmp = mkdtempSync(join(tmpdir(), 'verified copy fixture '));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const upstream = join(tmp, 'upstream');
  const app = join(tmp, 'consumer');
  const copy = join(app, 'pentacle-chat-core');
  mkdirSync(upstream);
  mkdirSync(app);
  git(upstream, 'init', '-q', '-b', 'main');
  git(upstream, 'config', 'user.name', 'Example Author');
  git(upstream, 'config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(upstream, 'src'));
  mkdirSync(join(upstream, 'tests'));
  const manifest = ['distribution.json', 'src', 'tests', 'package.json'];
  writeFileSync(join(upstream, 'distribution.json'), JSON.stringify({ schema: 1, paths: manifest }));
  writeFileSync(join(upstream, 'package.json'), '{"name":"example-core","dependencies":{"dep":"1.0.0"}}');
  writeFileSync(join(upstream, 'src', 'index.js'), 'first\n');
  writeFileSync(join(upstream, 'tests', 'conversation.json'), '[1,2,3]');
  function commit(label: string) {
    git(upstream, 'add', '-A');
    git(upstream, 'commit', '-qm', label);
    return git(upstream, 'rev-parse', 'HEAD');
  }
  const first = commit('first');
  const pin = join(app, 'config', 'pentacle-chat-core-pin.json');
  verifier.syncFromGit(app, upstream, first);
  return { upstream, app, copy, first, pin, commit };
}

test('offline drift, and recomputed hashes never attest independent upstream bytes', (t) => {
  const { app, upstream, pin, copy, first } = rig(t);
  assert.equal(verifier.checkAgainstGit(app, upstream).commit, first);
  const f = join(copy, 'src', 'index.js');
  const modified = Buffer.from('First\n'); // one byte only
  writeFileSync(f, modified);
  assert.throws(() => verifier.check(app), /local copy mode or bytes differ: src\/index.js/);
  const saved = JSON.parse(readFileSync(pin, 'utf8'));
  saved.files.find((row: { path: string }) => row.path === 'src/index.js').sha256 =
    createHash('sha256').update(modified).digest('hex');
  writeFileSync(pin, JSON.stringify(saved));
  assert.equal(verifier.check(app).commit, first);
  assert.throws(() => verifier.checkAgainstGit(app, upstream), /upstream commit mode or bytes differ: src\/index.js/);
  saved.remote = 'https://example.invalid/fork';
  writeFileSync(pin, JSON.stringify(saved));
  assert.throws(() => verifier.check(app), /invalid pin/);
});

test('required fixture, package metadata, extra files, symlinks and modes are checked', (t) => {
  const { app, upstream, copy, first } = rig(t);
  const fixture = join(copy, 'tests', 'conversation.json');
  rmSync(fixture);
  rmSync(join(copy, 'tests'), { recursive: true });
  assert.throws(() => verifier.check(app), /missing entry: tests\/conversation.json/);
  verifier.syncFromGit(app, upstream, first);
  const pkg = join(copy, 'package.json');
  writeFileSync(pkg, '{"name":"example-core"}');
  assert.throws(() => verifier.check(app), /mode or bytes differ: package.json/);
  verifier.syncFromGit(app, upstream, first);
  writeFileSync(join(copy, 'src', 'unexpected.js'), '');
  assert.throws(() => verifier.check(app), /unexpected entry/);
  verifier.syncFromGit(app, upstream, first);
  chmodSync(fixture, 0o755);
  assert.throws(() => verifier.check(app), /mode or bytes differ/);
  verifier.syncFromGit(app, upstream, first);
  rmSync(fixture);
  symlinkSync('../package.json', fixture);
  assert.throws(() => verifier.check(app), /non-regular copy entry/);
});

test('only an intentional main-reachable bump replaces the distribution and pin', (t) => {
  const { app, upstream, first, copy, commit } = rig(t);
  git(upstream, 'switch', '-qc', 'side');
  writeFileSync(join(upstream, 'src', 'index.js'), 'not on main');
  const side = commit('unrelated branch');
  assert.throws(() => verifier.syncFromGit(app, upstream, side), /not reachable/);
  assert.equal(verifier.check(app).commit, first);
  git(upstream, 'switch', '-q', 'main');
  writeFileSync(join(upstream, 'src', 'index.js'), 'second\n');
  const next = commit('change behavior upstream');
  assert.equal(verifier.checkAgainstGit(app, upstream).commit, first);
  verifier.syncFromGit(app, upstream, next);
  assert.equal(verifier.checkAgainstGit(app, upstream).commit, next);
  assert.equal(readFileSync(join(copy, 'src', 'index.js'), 'utf8'), 'second\n');
});
