import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  MANIFEST_DIR,
  ManifestRegistry,
  adapterModule,
  loadManifest,
  loadManifestRegistry,
  loadManifests,
  parseManifest,
} from '../src/core/manifest.ts';
import { ContractError } from '../src/protocol.ts';
import { mcpRegistration, runSetup } from '../src/setup.ts';
import { runCli } from '../src/cli.ts';
import { createNativeRuntime } from '../src/native-runtime.ts';
import type { Automatic } from '../src/automatic.ts';
import type { WhoOptions } from '../src/discovery.ts';
import type { Registration } from '../src/protocol.ts';

const invalid = (error: unknown) => error instanceof ContractError && error.message === 'manifest_invalid';

// A manifest that passes every rule. Each broken case changes exactly one rule, so a failure names its cause.
function valid(): any {
  return {
    schemaVersion: 1,
    product: 'sample',
    provider: 'grok',
    displayName: 'Sample',
    adapter: '../adapters/grok.ts',
    identity: { kind: 'pid_session', id: 'sessionId', generation: 'pid@startedAt', record: '~/.sample/sessions/<pid>.json' },
    discovery: { kind: 'sessions_json', source: '~/.sample/sessions', fields: ['sessionId', 'cwd'] },
    write: { channel: 'inbox_file', target: 'pending' },
    evidence: { source: '~/.sample/log', stages: ['reached', 'replied'] },
    states: { idle: 'ready', busy: 'next_turn' },
    permissions: { operations: ['read', 'send'], approvalMark: 'limits.markUnapproved' },
    install: { hook: null, steps: ['node src/cli.ts setup'] },
  };
}

async function home(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'seamless-manifest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the v1 products are listed through their manifests alone', async () => {
  const registry = await loadManifestRegistry();
  const peers = registry.peers();

  // Five product manifests: the four that existed when #26 was written (Claude Code, Codex, Grok Bot, Grok CLI) and
  // opencode, which T07 declared but did not add. Issue #26 counted three plus opencode because Grok CLI's manifest
  // landed afterwards; no product was removed to keep that number.
  assert.deepEqual(peers.map((peer) => peer.id), ['claude-code', 'codex', 'grok-bot', 'grok-cli', 'opencode']);
  assert.deepEqual(peers.map((peer) => peer.provider), ['claude', 'codex', 'grok-bot', 'grok', 'opencode']);
  assert.deepEqual(peers.map((peer) => peer.displayName), ['Claude Code', 'Codex', 'Grok Bot', 'Grok CLI', 'opencode']);
  assert.deepEqual(peers.map((peer) => peer.write), ['unix_socket', 'command', 'https_webhook', 'inbox_file', 'plugin_api']);
  assert.deepEqual(peers.map((peer) => peer.discovery), ['sessions_json', 'rollout', 'roster', 'sessions_json', 'plugin']);

  // The adapter is named by the manifest and resolves to the product's own file under src/.
  const source = dirname(MANIFEST_DIR);
  for (const { product, module } of registry.adapters()) {
    assert.ok(module.startsWith(source + '/'), `${product} adapter stays under src/`);
    assert.equal((await stat(module)).isFile(), true, `${product} adapter exists`);
  }
  assert.deepEqual(registry.adapters().map(({ product, module }) => [product, module.split('/').at(-1)]), [
    ['claude-code', 'claude.ts'],
    ['codex', 'codex.ts'],
    ['grok-bot', 'webhook-send.ts'],
    ['grok-cli', 'grok.ts'],
    ['opencode', 'opencode.ts'],
  ]);

  // The listing keeps the stages the product's own records can prove, and the product's native states.
  const claude = registry.get('claude-code')!;
  assert.equal(claude.identity.id, 'sessionId');
  assert.equal(claude.discovery.fields.includes('messagingSocketPath'), true);
  assert.deepEqual(claude.evidence.stages, ['reached', 'processing', 'replied']);
  assert.equal(claude.states.idle, 'ready');
  const bot = registry.get('grok-bot')!;
  assert.deepEqual(bot.evidence.stages, ['replied']);
  assert.equal(bot.identity.generation, 'keyVersion');
  // Grok CLI is the hooks product: one inbox file per request, the Stop hook at the next turn, a metadata-only receipt.
  const grok = registry.get('grok-cli')!;
  assert.equal(grok.identity.record, '~/.grok/active_sessions.json');
  assert.equal(grok.write.channel, 'inbox_file');
  assert.deepEqual(grok.evidence.stages, ['reached', 'processing', 'replied']);
  assert.equal(grok.states.offline, 'wake_needed');
  assert.equal(grok.limits?.maxText, 8000);
  // The one hook file a Grok install names: hooks/grok-cli/seamless-hook.sh, not a path into src/.
  assert.equal(grok.install.hook, 'hooks/grok-cli/seamless-hook.sh');
  // opencode has no socket or command: the plugin writes the peers file, calls the official session.prompt, and its
  // receipt in delivered/ is the only stage it can prove. The manifest names the plugin install, not a hook.
  const opencode = registry.get('opencode')!;
  assert.equal(opencode.identity.id, 'sessionId');
  assert.equal(opencode.identity.record, '~/.seamless/peers/opencode-<sessionId>.json');
  assert.equal(opencode.discovery.kind, 'plugin');
  assert.equal(opencode.discovery.source, '~/.seamless/peers');
  assert.equal(opencode.write.channel, 'plugin_api');
  assert.equal(opencode.write.target, 'session.prompt');
  assert.deepEqual(opencode.evidence.stages, ['reached']);
  assert.equal(opencode.states.idle, 'ready');
  assert.equal(opencode.states.busy, 'next_turn');
  assert.deepEqual(opencode.permissions.operations, ['read', 'send']);
  assert.equal(opencode.limits?.maxText, 8000);
  assert.equal(opencode.install.hook, null);
  assert.equal(opencode.install.steps.includes('add packages/opencode-plugin/index.ts to ~/.config/opencode/opencode.json'), true);
});

test('a manifest installs one hook file that exists and can run', async () => {
  const registry = await loadManifestRegistry();
  const root = dirname(dirname(MANIFEST_DIR));
  for (const manifest of registry.list()) {
    if (manifest.install.hook === null) continue;
    const hook = join(root, manifest.install.hook);
    const info = await stat(hook);
    assert.equal(info.isFile(), true, `${manifest.product} hook is a file`);
    assert.equal((info.mode & 0o111) !== 0, true, `${manifest.product} hook is executable`);
    // The product-facing hook is a file of its own; the work stays in the product's module under src/.
    assert.equal(hook.startsWith(join(root, 'hooks') + '/'), true, `${manifest.product} hook lives under hooks/`);
  }
});

test('one added manifest registers a new product without touching the core', () => {
  const registry = new ManifestRegistry([valid()]);
  registry.register({ ...valid(), product: 'cursor', provider: 'codex', displayName: 'Cursor', adapter: '../adapters/codex.ts' });
  assert.deepEqual(registry.peers().map((peer) => peer.id), ['cursor', 'sample']);
  assert.equal(registry.adapter('cursor')?.endsWith('/src/adapters/codex.ts'), true);
  assert.equal(registry.adapter('missing'), undefined);
});

const broken: Array<[string, (manifest: any) => unknown]> = [
  ['no object', () => null],
  ['an array instead of an object', () => []],
  ['another schema version', (m) => ({ ...m, schemaVersion: 2 })],
  ['an unknown key', (m) => ({ ...m, extra: true })],
  ['a missing key', (m) => {
    const { write: _write, ...rest } = m;
    return rest;
  }],
  ['a product id with a space', (m) => ({ ...m, product: 'Sample Product' })],
  ['a provider the core does not know', (m) => ({ ...m, provider: 'gemini' })],
  ['an absolute adapter path', (m) => ({ ...m, adapter: '/tmp/adapter.ts' })],
  ['an adapter that climbs out of src', (m) => ({ ...m, adapter: '../../adapter.ts' })],
  ['an adapter that is not a module', (m) => ({ ...m, adapter: '../adapters/grok.json' })],
  ['an unknown identity kind', (m) => ({ ...m, identity: { ...m.identity, kind: 'pid' } })],
  ['an identity with no record', (m) => {
    const { record: _record, ...identity } = m.identity;
    return { ...m, identity };
  }],
  ['an unknown discovery kind', (m) => ({ ...m, discovery: { ...m.discovery, kind: 'magic' } })],
  ['an empty discovery field list', (m) => ({ ...m, discovery: { ...m.discovery, fields: [] } })],
  ['duplicate discovery fields', (m) => ({ ...m, discovery: { ...m.discovery, fields: ['cwd', 'cwd'] } })],
  ['an unknown write channel', (m) => ({ ...m, write: { ...m.write, channel: 'carrier_pigeon' } })],
  ['an empty evidence stage list', (m) => ({ ...m, evidence: { ...m.evidence, stages: [] } })],
  ['accepted treated as evidence', (m) => ({ ...m, evidence: { ...m.evidence, stages: ['accepted'] } })],
  ['an unknown listing state', (m) => ({ ...m, states: { idle: 'idle' } })],
  ['an invalid state condition', (m) => ({ ...m, states: { 'Idle!': 'ready' } })],
  ['no operations', (m) => ({ ...m, permissions: { ...m.permissions, operations: [] } })],
  ['an unknown operation', (m) => ({ ...m, permissions: { ...m.permissions, operations: ['write'] } })],
  ['duplicate operations', (m) => ({ ...m, permissions: { ...m.permissions, operations: ['read', 'read'] } })],
  ['an install with no steps', (m) => ({ ...m, install: { hook: null, steps: [] } })],
  ['a non-string install hook', (m) => ({ ...m, install: { hook: 5, steps: ['node src/cli.ts setup'] } })],
  ['limits without maxText', (m) => ({ ...m, limits: {} })],
  ['a zero maxText', (m) => ({ ...m, limits: { maxText: 0 } })],
];

for (const [name, change] of broken) {
  test(`a manifest with ${name} is rejected`, () => {
    assert.throws(() => parseManifest(change(valid())), invalid);
  });
}

test('two manifests for one product are refused', () => {
  const registry = new ManifestRegistry([valid()]);
  assert.throws(
    () => registry.register({ ...valid(), displayName: 'Sample Again' }),
    (error: unknown) => error instanceof ContractError && error.message === 'manifest_duplicate',
  );
});

test('the loader refuses invalid JSON, an oversized file, a missing directory and duplicate products', async (t) => {
  const dir = await home(t);

  await writeFile(join(dir, 'broken.json'), '{not json');
  await assert.rejects(loadManifest(join(dir, 'broken.json')), invalid);

  const oversized = join(dir, 'oversized.json');
  await writeFile(oversized, JSON.stringify({ ...valid(), displayName: 'x'.repeat(70_000) }));
  await assert.rejects(loadManifest(oversized), invalid);

  await assert.rejects(loadManifests(join(dir, 'absent')), invalid);
  await assert.rejects(loadManifest(join(dir, 'absent.json')), invalid);

  const duplicates = await home(t);
  await writeFile(join(duplicates, 'a.json'), JSON.stringify(valid()));
  await writeFile(join(duplicates, 'b.json'), JSON.stringify({ ...valid(), displayName: 'Sample Again' }));
  await assert.rejects(
    loadManifests(duplicates),
    (error: unknown) => error instanceof ContractError && error.message === 'manifest_duplicate',
  );
});

test('a directory of valid manifests loads as one registry', async (t) => {
  const dir = await home(t);
  await writeFile(join(dir, 'b.json'), JSON.stringify({ ...valid(), product: 'second', displayName: 'Second' }));
  await writeFile(join(dir, 'a.json'), JSON.stringify(valid()));
  await writeFile(join(dir, 'README.md'), 'manifests are read from the .json files only\n');
  const registry = await loadManifestRegistry(dir);
  assert.deepEqual(registry.peers().map((peer) => peer.id), ['sample', 'second']);
  const loaded = await loadManifests(dir);
  assert.deepEqual(loaded.map((manifest) => manifest.product), ['sample', 'second']);
});

test('the approval mark stays with limits.markUnapproved and is never fixed by a manifest', async () => {
  for (const manifest of (await loadManifestRegistry()).list()) {
    // The only accepted value: the send path still reads ~/.seamless/limits.json on every envelope.
    assert.equal(manifest.permissions.approvalMark, 'limits.markUnapproved');
  }
  assert.equal(parseManifest(valid()).permissions.approvalMark, 'limits.markUnapproved');
  for (const approvalMark of ['none', 'always', 'limits.markApproved']) {
    assert.throws(() => parseManifest({ ...valid(), permissions: { ...valid().permissions, approvalMark } }), invalid);
  }
});

// `who --json` through the command line, with no session in the fixture: every row below comes from the registration.
async function whoListing(automatic: Automatic, options: WhoOptions): Promise<any> {
  let output = '';
  const log = console.log;
  console.log = (value: unknown) => { output += String(value); };
  try {
    await runCli(['who', '--json'], automatic, undefined, async () => '', options);
  } finally {
    console.log = log;
  }
  return JSON.parse(output);
}
const emptySessions: Automatic = async () => ({ status: 'ok', candidates: [], external: [] });
async function withPath<T>(path: string, run: () => Promise<T>): Promise<T> {
  const old = process.env.PATH;
  process.env.PATH = path;
  try {
    return await run();
  } finally {
    process.env.PATH = old;
  }
}

test('a product removed from the registration leaves the who listing', async (t) => {
  const manifests = await loadManifestRegistry();
  const all = new ManifestRegistry(manifests.list(), MANIFEST_DIR);
  const withoutCodex = new ManifestRegistry(manifests.list().filter((manifest) => manifest.product !== 'codex'), MANIFEST_DIR);
  const listing = {
    status: 'ok',
    candidates: [
      { id: 'claude:session', provider: 'claude', nativeId: 'session', status: 'online', reason: null, versionStatus: 'verified' },
      { id: 'codex:thread', provider: 'codex', nativeId: 'thread', status: 'online', reason: null, versionStatus: 'verified' },
    ],
    external: [],
  };
  const automatic: Automatic = async (method) => method === 'sessions' ? structuredClone(listing) : { status: 'unexpected_method' };

  const before = await whoListing(automatic, { home: await home(t), manifests: all });
  assert.equal(before.peers.some((peer: any) => peer.id === 'codex:thread'), true, 'the full registration lists Codex');

  // The scan still reports the Codex thread; only the registration changed, and that is what who follows.
  const after = await whoListing(automatic, { home: await home(t), manifests: withoutCodex });
  assert.equal(after.peers.some((peer: any) => peer.id === 'codex:thread'), false, 'a removed product is not listed');
  assert.equal(after.peers.some((peer: any) => peer.id === 'claude:session'), true, 'the remaining products stay');
});

test('an added manifest is listed and its own adapter writes the request', async (t) => {
  const dir = await home(t), runtimeHome = await home(t);
  const fake = {
    ...valid(),
    product: 'fake',
    provider: 'grok',
    displayName: 'Fake',
    adapter: './fake-adapter.js',
    discovery: { kind: 'plugin', source: '~/.seamless/peers', fields: ['sessionId'] },
    write: { channel: 'plugin_api', target: 'session.prompt' },
    exports: { list: 'listPeers', send: 'send' },
  };
  await writeFile(join(dir, 'fake.json'), JSON.stringify(fake));
  await writeFile(join(dir, 'fake-adapter.js'), [
    "import { writeFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    'export async function listPeers() {',
    "  return [{ id: 'fake:session-1', provider: 'grok', sessionId: 'session-1', displayName: 'Fake session', state: 'idle' }];",
    '}',
    'export async function send(envelope) {',
    "  await writeFile(join(process.env.SEAMLESS_FAKE_DIR, 'sent.json'), JSON.stringify(envelope));",
    "  return { status: 'submitted', nativeMessageId: envelope.id };",
    '}',
    '',
  ].join('\n'));
  const manifests = await loadManifestRegistry(dir);
  process.env.SEAMLESS_FAKE_DIR = runtimeHome;
  t.after(() => { delete process.env.SEAMLESS_FAKE_DIR; });

  const listing = await whoListing(emptySessions, { home: runtimeHome, manifests });
  assert.deepEqual(
    listing.peers.filter((peer: any) => peer.id === 'fake:session-1').map((peer: any) => [peer.state, peer.displayName]),
    [['ready', 'Fake session']],
  );

  // The send port is the manifest's own module: nothing in the core names this product.
  const { adapter } = createNativeRuntime({ home: runtimeHome, manifests });
  const target: Registration = { id: 'fake:session-1', provider: 'grok', nativeId: 'session-1', generation: 'g1', host: 'local', displayName: 'Fake', workspace: runtimeHome, operations: ['read', 'send'], grants: [] };
  const receipt = await adapter.send(target, {
    id: 'm-1',
    sender: { id: 'fake:session-2', nativeId: 'session-2', generation: 'g2' },
    recipient: { id: target.id, nativeId: target.nativeId, generation: target.generation },
    text: 'hello',
  });
  assert.deepEqual(receipt, { status: 'submitted', nativeMessageId: 'm-1' });
  const sent = JSON.parse(await readFile(join(runtimeHome, 'sent.json'), 'utf8'));
  assert.deepEqual([sent.schemaVersion, sent.id, sent.text, typeof sent.acceptedAt], [1, 'm-1', 'hello', 'number']);
});

test('a manifest discovery port puts its peers in who: opencode idle and busy', async (t) => {
  const runtimeHome = await home(t);
  await mkdir(join(runtimeHome, '.seamless', 'peers'), { recursive: true, mode: 0o700 });
  const peer = (sessionId: string, state: 'idle' | 'busy', title: string) => ({
    schemaVersion: 1, provider: 'opencode', sessionId, generation: `g-${sessionId}`, title, directory: '/', state, updatedAt: 1, pluginVersion: '1',
  });
  await writeFile(join(runtimeHome, '.seamless', 'peers', 'opencode-a.json'), JSON.stringify(peer('a', 'idle', 'Idle one')), { mode: 0o600 });
  await writeFile(join(runtimeHome, '.seamless', 'peers', 'opencode-b.json'), JSON.stringify(peer('b', 'busy', 'Busy one')), { mode: 0o600 });

  const listing = await whoListing(emptySessions, { home: runtimeHome });
  assert.deepEqual(
    listing.peers.filter((p: any) => String(p.id).startsWith('opencode:')).map((p: any) => [p.id, p.state, p.displayName]),
    [['opencode:a', 'ready', 'Idle one'], ['opencode:b', 'next_turn', 'Busy one']],
  );
});

test('the phase 2 declaration is listed as unverified only when its executable exists', async (t) => {
  const runtimeHome = await home(t);
  const absent = await withPath('/nonexistent', () => whoListing(emptySessions, { home: runtimeHome }));
  assert.equal(absent.peers.some((p: any) => p.id === 'antigravity'), false, 'no executable, no row');

  const root = join(runtimeHome, '.t3-ja', 'tools', 'antigravity-acp', `darwin-${process.arch}`);
  const release = 'abc12345', versionDir = join(root, 'versions', release);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(root, 'active.json'), JSON.stringify({ releaseId: release }));
  const binary = join(versionDir, 'agy_acp_server.par');
  await writeFile(binary, '#!/bin/sh\nexit 0\n');
  await chmod(binary, 0o755);
  await writeFile(join(versionDir, '.install-complete.json'), JSON.stringify({ releaseId: release, version: '1.1.1', executable: { name: 'agy_acp_server.par' } }));

  const present = await withPath('/nonexistent', () => whoListing(emptySessions, { home: runtimeHome }));
  const row = present.peers.find((p: any) => p.id === 'antigravity');
  assert.deepEqual([row?.state, row?.versionStatus, row?.displayName], ['unreachable', 'unverified', 'Antigravity CLI']);
});

test('setup treats a registration with another or no type as a change', async (t) => {
  const dir = await home(t);
  const file = join(dir, '.claude.json');
  const entry = mcpRegistration();
  const write = (registration: unknown) => writeFile(file, JSON.stringify({ mcpServers: { seamless: registration } }) + '\n', { mode: 0o600 });

  // Same command and args, a different type: the old comparison said unchanged, which #10 recorded as a leftover.
  await write({ ...entry, type: 'http' });
  const retyped = await runSetup({ home: dir, dryRun: true });
  assert.equal(retyped.changes[0]?.action, 'would_update');

  // A registration with no type cannot be proven to be the stdio entry, so it is written with one.
  await write({ command: entry.command, args: entry.args });
  const untyped = await runSetup({ home: dir, dryRun: true });
  assert.equal(untyped.changes[0]?.action, 'would_update');

  await write(entry);
  const same = await runSetup({ home: dir, dryRun: true });
  assert.equal(same.changes[0]?.action, 'unchanged');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).mcpServers.seamless.type, 'stdio');
});
