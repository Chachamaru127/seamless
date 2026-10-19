import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/cli.ts';
import {loadManifestRegistry} from '../src/core/manifest.ts';
import {
  ANTIGRAVITY_MANIFEST_PATH,
  listAntigravity,
  parseAntigravityManifest,
  readAntigravityManifest,
} from '../src/adapters/antigravity.ts';
import type {Automatic} from '../src/automatic.ts';

// S5: Antigravity CLI has no confirmed official port for finding a conversation or injecting a request. The adapter only
// decides whether `doctor`'s answer becomes a listing row, so the tests drive the real `doctor --json` path and feed its
// `antigravity` object to the listing.
const unused: Automatic = async () => ({status: 'caller_unobserved'});

async function home(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'seamless-antigravity-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}
async function doctorJson(dir: string): Promise<any> {
  let output = '';
  const log = console.log;
  console.log = (value: unknown) => { output += String(value); };
  try {
    await runCli(['doctor', '--json'], unused, undefined, async () => '', {home: dir});
  } finally {
    console.log = log;
  }
  return JSON.parse(output);
}
async function withPath<T>(path: string, run: () => Promise<T>): Promise<T> {
  const old = process.env.PATH;
  process.env.PATH = path;
  try {
    return await run();
  } finally {
    process.env.PATH = old;
  }
}
// The T3 Code install S5 measured: active.json names the release, .install-complete.json names the executable.
async function t3Antigravity(dir: string, version = '1.1.1'): Promise<string> {
  const root = join(dir, '.t3-ja', 'tools', 'antigravity-acp', `darwin-${process.arch}`);
  const release = 'abc12345';
  const versionDir = join(root, 'versions', release);
  await mkdir(versionDir, {recursive: true});
  await writeFile(join(root, 'active.json'), JSON.stringify({releaseId: release}));
  const binary = join(versionDir, 'agy_acp_server.par');
  await writeFile(binary, '#!/bin/sh\nexit 0\n');
  await chmod(binary, 0o755);
  await writeFile(join(versionDir, '.install-complete.json'), JSON.stringify({
    releaseId: release,
    version,
    executable: {name: 'agy_acp_server.par'},
  }));
  return binary;
}

test('the Antigravity declaration is phase 2, read-only and unverified', async () => {
  const manifest = await readAntigravityManifest();
  assert.equal(manifest.product, 'antigravity');
  assert.equal(manifest.provider, 'antigravity');
  assert.equal(manifest.displayName, 'Antigravity CLI');
  assert.equal(manifest.status, 'unverified');
  assert.equal(manifest.phase, 2);
  assert.deepEqual(manifest.operations, ['read']);
  assert.equal(manifest.install.hook, null);
  // The declared file is the one this adapter reads, and it is valid JSON at that path.
  assert.equal((await stat(ANTIGRAVITY_MANIFEST_PATH)).isFile(), true);
  assert.equal(JSON.parse(await readFile(ANTIGRAVITY_MANIFEST_PATH, 'utf8')).product, 'antigravity');
  // S5 is open: a declaration that claims a send port is refused rather than trusted.
  const raw = JSON.parse(await readFile(ANTIGRAVITY_MANIFEST_PATH, 'utf8'));
  assert.throws(
    () => parseAntigravityManifest({...raw, permissions: {operations: ['read', 'send'], approvalMark: 'limits.markUnapproved'}}),
    /manifest_invalid/,
  );
  // Phase 2 stays outside the core provider set: the core registry does not list it by accident.
  assert.equal((await loadManifestRegistry()).peers().some((peer) => peer.id === 'antigravity'), false);
});

test('doctor finds no executable: Antigravity is not listed', async (t) => {
  const dir = await home(t);
  const manifest = await readAntigravityManifest();
  const out = await withPath('/nonexistent', () => doctorJson(dir));
  assert.equal(out.antigravity.binary, null);
  assert.deepEqual(listAntigravity(out.antigravity, manifest), []);
});

test('a T3-managed executable is listed as unverified, not as a usable peer', async (t) => {
  const dir = await home(t);
  const binary = await t3Antigravity(dir);
  const manifest = await readAntigravityManifest();
  const out = await withPath('/nonexistent', () => doctorJson(dir));
  assert.equal(out.antigravity.binary, binary);
  assert.equal(out.antigravity.hooks, false);
  const listed = listAntigravity(out.antigravity, manifest);
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], {
    id: 'antigravity',
    product: 'antigravity',
    provider: 'antigravity',
    displayName: 'Antigravity CLI',
    status: 'unverified',
    versionStatus: 'unverified',
    binary,
    hooks: false,
  });
});

test('an executable on PATH is listed too, and doctor hooks are reported with the row', async (t) => {
  const dir = await home(t);
  const bin = join(dir, 'bin');
  await mkdir(bin);
  const binary = join(bin, 'antigravity');
  await writeFile(binary, '#!/bin/sh\necho "1.1.1"\n');
  await chmod(binary, 0o755);
  await mkdir(join(dir, '.gemini', 'antigravity-cli'), {recursive: true});
  await writeFile(
    join(dir, '.gemini', 'antigravity-cli', 'settings.json'),
    JSON.stringify({hooks: {BeforeAgent: [{hooks: [{type: 'command', command: 'seamless-hook'}]}]}}),
  );
  const manifest = await readAntigravityManifest();
  const out = await withPath(bin, () => doctorJson(dir));
  assert.equal(out.antigravity.binary, binary);
  assert.equal(out.antigravity.hooks, true);
  const listed = listAntigravity(out.antigravity, manifest);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.binary, binary);
  assert.equal(listed[0]!.hooks, true);
  assert.equal(listed[0]!.status, 'unverified');
});
