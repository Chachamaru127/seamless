import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.ts';
import { createAutomatic, type Automatic } from '../src/automatic.ts';
import { Discovery, whoVerdict } from '../src/discovery.ts';
import { Registry } from '../src/registry.ts';
import type { Registration, Observation } from '../src/protocol.ts';
import type { GitContext } from '../src/git-context.ts';
import type { SessionIdentity } from '../src/sessions-scan.ts';
import type { Caller } from '../src/caller.ts';

const record = (over: Record<string, unknown> = {}) => ({
  version: '2.1.303', pid: 41, sessionId: 'waiting', cwd: '/tmp/work', startedAt: 1_000_000,
  kind: 'interactive', status: 'idle', name: 'main', messagingSocketPath: '/tmp/cc-socks/41.sock', ...over,
});

async function claudeHome(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), 'seamless-who-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.claude', 'sessions'), { recursive: true });
  return home;
}

async function cli(automatic: Automatic, args: string[], whoOptions?: { home?: string }) {
  let output = '';
  const log = console.log;
  console.log = (v: unknown) => { output += String(v); };
  try { await runCli(args, automatic, undefined, async () => '', whoOptions); } finally { console.log = log; }
  return JSON.parse(output);
}

const fixtureListing = {
  status: 'ok',
  candidates: [
    { id: 'claude:waiting', provider: 'claude', host: 'local', nativeId: 'waiting', generation: 'g', cwd: '/work', version: '2.1.303', versionStatus: 'verified', status: 'online', reason: null, requests: [], operations: { read: true, send: true }, ticket: 't1' },
    { id: 'claude:working', provider: 'claude', host: 'local', nativeId: 'working', generation: 'g', cwd: '/work', version: '2.1.303', versionStatus: 'verified', status: 'online', reason: null, requests: [], operations: { read: true, send: true }, ticket: 't2' },
    { id: 'claude:nosocket', provider: 'claude', host: 'local', nativeId: 'nosocket', generation: 'g', cwd: '/work', version: '2.1.303', versionStatus: 'verified', status: 'unknown', reason: 'unreachable', requests: [], operations: { read: true, send: true }, ticket: null },
  ],
  external: [{ id: 'grok-bot:bot1', product: 'grok-bot', host: 'external', displayName: 'bot1', keyVersion: 1, operations: { read: false, send: true }, status: 'registered', ticket: 't3' }],
};

test('a waiting, working, sleeping and socketless peer get ready, next_turn, wake_needed and unreachable', async t => {
  const home = await claudeHome(t);
  await writeFile(join(home, '.claude', 'sessions', '41.json'), JSON.stringify(record()));
  await writeFile(join(home, '.claude', 'sessions', '42.json'), JSON.stringify(record({ pid: 42, sessionId: 'working', status: 'busy', messagingSocketPath: '/tmp/cc-socks/42.sock' })));
  const { messagingSocketPath: _socket, ...noSocket } = record({ pid: 43, sessionId: 'nosocket' });
  await writeFile(join(home, '.claude', 'sessions', '43.json'), JSON.stringify(noSocket));

  const calls: Array<{ method: string; input: any }> = [];
  const automatic: Automatic = async (method, input) => {
    calls.push({ method, input });
    return method === 'sessions' ? structuredClone(fixtureListing) : { status: 'unexpected_method' };
  };
  const out = await cli(automatic, ['who', '--json'], { home });

  assert.equal(out.status, 'ok');
  assert.deepEqual(out.peers.map((p: any) => [p.id, p.state, p.reason ?? null]), [
    ['claude:waiting', 'ready', null],
    ['claude:working', 'next_turn', null],
    ['claude:nosocket', 'unreachable', 'no_inbox_socket'],
    ['grok-bot:bot1', 'wake_needed', null],
  ]);
  assert.equal(out.peers[0].versionStatus, 'verified');
  assert.deepEqual(calls, [{ method: 'sessions', input: { operation: 'send', scope: 'any', includeOffline: true } }]);
});

test('a Claude record without a socket, or with no record at all, is unreachable: no_inbox_socket in the registry path', async t => {
  const home = await claudeHome(t);
  const { messagingSocketPath: _socket, ...noSocket } = record({ pid: 41, sessionId: 'nosocket' });
  await writeFile(join(home, '.claude', 'sessions', '41.json'), JSON.stringify(noSocket));
  await writeFile(join(home, '.claude', 'sessions', '42.json'), JSON.stringify(record({ pid: 42, sessionId: 'waiting' })));

  const mk = (id: string, provider: 'claude' | 'codex', nativeId: string): Registration => ({ id, provider, nativeId, generation: 'g1', host: 'local', displayName: id, role: 'work', workspace: '/w', operations: ['read', 'send'], grants: [] });
  const a = mk('a', 'codex', 'a'), b = mk('b', 'claude', 'nosocket'), c = mk('c', 'claude', 'waiting'), d = mk('d', 'claude', 'missing'), e = mk('e', 'codex', 'e');
  for (const x of [a, b, c, d, e]) for (const y of [a, b, c, d, e]) if (x !== y) for (const operation of ['read', 'send'] as const) { x.grants.push({ peer: y.id, operation, direction: 'outbound' }); y.grants.push({ peer: x.id, operation, direction: 'inbound' }); }
  const ctx: Extract<GitContext, { state: 'git' }> = { state: 'git', workspace: '/w', repository: '/repo', worktree: '/w', headState: 'attached', branch: 'refs/heads/main', head: 'abc', dirty: false };
  const observation = (r: Registration): Observation => ({ nativeId: r.nativeId, generation: r.generation, status: 'online', observedAt: 100000, contextObservedAt: 100000, source: 'fixture', cwd: '/w', context: ctx });
  const registry = new Registry([a, b, c, d, e], async r => observation(r));

  const out = await new Discovery(registry, 'a', { wallNow: () => 100000, home }).who({ operation: 'send' });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.peers.map(p => [p.id, p.state, p.reason ?? null]), [
    ['b', 'unreachable', 'no_inbox_socket'],
    ['c', 'ready', null],
    ['d', 'unreachable', 'no_inbox_socket'],
    ['e', 'next_turn', null],
  ]);
});

test('AC16: T3 Code claude processes are listed as unreachable: no_inbox_socket, with a socketless record and with none at all', async t => {
  const home = await claudeHome(t);
  // A T3 Code thread starts `claude --output-format stream-json`; its sessions JSON (when one exists) names no socket.
  const { messagingSocketPath: _socket, ...noSocket } = record({ pid: 10142, sessionId: 't3-10142' });
  await writeFile(join(home, '.claude', 'sessions', '10142.json'), JSON.stringify(noSocket));

  const mk = (id: string, provider: 'claude' | 'codex', nativeId: string): Registration => ({ id, provider, nativeId, generation: 'g1', host: 'local', displayName: id, role: 'work', workspace: '/w', operations: ['read', 'send'], grants: [] });
  const caller = mk('codex:caller', 'codex', 'caller'), socketless = mk('claude:t3-10142', 'claude', 't3-10142'), missing = mk('claude:t3-88557', 'claude', 't3-88557');
  for (const peer of [socketless, missing]) {
    for (const operation of ['read', 'send'] as const) {
      caller.grants.push({ peer: peer.id, operation, direction: 'outbound' });
      peer.grants.push({ peer: caller.id, operation, direction: 'inbound' });
    }
  }
  const ctx: Extract<GitContext, { state: 'git' }> = { state: 'git', workspace: '/w', repository: '/repo', worktree: '/w', headState: 'attached', branch: 'refs/heads/main', head: 'abc', dirty: false };
  const observation = (r: Registration): Observation => ({ nativeId: r.nativeId, generation: r.generation, status: 'online', observedAt: 100000, contextObservedAt: 100000, source: 'fixture', cwd: '/w', context: ctx });
  const registry = new Registry([caller, socketless, missing], async r => observation(r));

  const out = await new Discovery(registry, caller.id, { wallNow: () => 100000, home }).who({ operation: 'send' });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.peers.map(p => [p.id, p.state, p.reason ?? null]), [
    ['claude:t3-10142', 'unreachable', 'no_inbox_socket'],
    ['claude:t3-88557', 'unreachable', 'no_inbox_socket'],
  ]);
});

test('a failed Desktop connection is passed through as unverified_desktop and shown as unreachable', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seamless-who-desktop-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const caller = { provider: 'codex' as const, nativeId: 'a', generation: 'g', cwd: home, socket: 'unused', source: 'codex-turn-metadata' as const, version: '26.930.31730+12947' };
  const target: SessionIdentity = { provider: 'codex', nativeId: 'b', generation: 'g', cwd: home, socket: 'unused', version: '26.930.31730+12947', status: 'unknown', reason: 'unreachable' };
  let reachable = false;
  const automatic = createAutomatic({
    home,
    limitsPath: join(home, 'limits.json'),
    caller: async () => ({ status: 'ok', caller: caller as Caller }),
    scan: async () => ({ sessions: [caller, { ...target }], codexWorkspace: 'observed' }),
    scanOptions: { git: async cwd => ({ state: 'no_git', workspace: cwd }), reachable: async () => reachable },
  });

  const down = await cli(automatic, ['who', '--json'], { home });
  assert.equal(down.status, 'ok');
  assert.deepEqual(down.peers.map((p: any) => [p.id, p.state, p.reason, p.versionStatus]), [
    ['codex:b', 'unreachable', 'desktop_unavailable', 'unverified_desktop'],
  ]);

  reachable = true;
  const up = await cli(automatic, ['who', '--json'], { home });
  assert.deepEqual(up.peers.map((p: any) => [p.id, p.state, p.reason ?? null, p.versionStatus]), [
    ['codex:b', 'wake_needed', null, 'verified'],
  ]);
});

test('the verdict table keeps fix_required and hooks products out of ready', () => {
  assert.deepEqual(whoVerdict({ provider: 'grok', nativeId: 'g', status: 'online', versionStatus: null }), { state: 'next_turn' });
  assert.deepEqual(whoVerdict({ provider: 'grok', nativeId: 'g', status: 'offline', reason: 'process_exited' }), { state: 'wake_needed' });
  assert.deepEqual(whoVerdict({ provider: 'grok', nativeId: 'g', status: 'unknown', reason: 'unreachable' }), { state: 'unreachable', reason: 'unreachable' });
  assert.deepEqual(whoVerdict({ provider: 'codex', nativeId: 'c', status: 'offline', versionStatus: 'verified' }), { state: 'wake_needed' });
  assert.deepEqual(whoVerdict({ provider: 'claude', nativeId: 'c', inbox: { status: 'reachable', socket: '/s', kind: null, claudeStatus: null, name: null } }), { state: 'next_turn' });
  // A stopped conversation keeps a socket in its last record; the process state wins.
  assert.deepEqual(whoVerdict({ provider: 'claude', nativeId: 'c', status: 'offline', inbox: { status: 'reachable', socket: '/s', kind: null, claudeStatus: 'idle', name: null } }), { state: 'wake_needed' });
  assert.deepEqual(whoVerdict({ provider: 'claude', nativeId: 'c', inbox: { status: 'unreachable', reason: 'session_record_unreadable' } }), { state: 'unreachable', reason: 'session_record_unreadable' });
  assert.deepEqual(whoVerdict({ provider: 'codex', nativeId: 'c', status: 'online', versionStatus: 'fix_required' }), { state: 'unreachable', reason: 'fix_required' });
  assert.deepEqual(whoVerdict({ provider: 'codex', nativeId: 'c', status: 'unknown', reason: 'generation_changed', versionStatus: 'verified' }), { state: 'next_turn' });
  assert.deepEqual(whoVerdict({ provider: 'grok-bot', nativeId: 'b', status: 'revoked' }), { state: 'unreachable', reason: 'revoked' });
  assert.deepEqual(whoVerdict({ provider: 'grok-bot', nativeId: 'b', status: 'scope_unset' }), { state: 'unreachable', reason: 'scope_unset' });
});
