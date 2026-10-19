import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

test('the three v1 products are listed through their manifests alone', async () => {
  const registry = await loadManifestRegistry();
  const peers = registry.peers();

  assert.deepEqual(peers.map((peer) => peer.id), ['claude-code', 'codex', 'grok-bot']);
  assert.deepEqual(peers.map((peer) => peer.provider), ['claude', 'codex', 'grok-bot']);
  assert.deepEqual(peers.map((peer) => peer.displayName), ['Claude Code', 'Codex', 'Grok Bot']);
  assert.deepEqual(peers.map((peer) => peer.write), ['unix_socket', 'command', 'https_webhook']);
  assert.deepEqual(peers.map((peer) => peer.discovery), ['sessions_json', 'rollout', 'roster']);

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
