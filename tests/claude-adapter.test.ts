import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeInbox, claudeSessionFiles, createClaudeReader, findClaudeInbox, findClaudeProcessInbox, findClaudeSession, findClaudeSessionByPid } from '../src/adapters/claude.ts';
import type { Registration } from '../src/protocol.ts';

const record = (over: Record<string, unknown> = {}) => ({ version: '2.1.303', pid: 41, sessionId: 's1', cwd: '/tmp/work', startedAt: 1_000_000, kind: 'interactive', status: 'idle', name: 'main', messagingSocketPath: '/tmp/cc-socks/41.sock', ...over });

async function claudeHome(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), 'seamless-claude-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.claude', 'sessions'), { recursive: true });
  return home;
}

test('a sessions JSON with a socket is reachable and carries kind, status and name', async t => {
  const home = await claudeHome(t);
  await writeFile(join(home, '.claude', 'sessions', '41.json'), JSON.stringify(record()));
  assert.deepEqual(await findClaudeInbox('s1', { home }), { status: 'reachable', socket: '/tmp/cc-socks/41.sock', kind: 'interactive', claudeStatus: 'idle', name: 'main' });
  assert.deepEqual(await findClaudeProcessInbox(41, { home }), { status: 'reachable', socket: '/tmp/cc-socks/41.sock', kind: 'interactive', claudeStatus: 'idle', name: 'main' });
  const session = await findClaudeSession('s1', { home });
  if (!session || session === 'unreadable') return assert.fail();
  assert.deepEqual([session.kind, session.status, session.name], ['interactive', 'idle', 'main']);
  const byPid = await findClaudeSessionByPid(41, { home });
  if (!byPid || byPid === 'unreadable') return assert.fail();
  assert.deepEqual([byPid.kind, byPid.status, byPid.name], ['interactive', 'idle', 'main']);
});

test('a sessions JSON without a socket field is unreachable: no_inbox_socket', async t => {
  const home = await claudeHome(t);
  const { messagingSocketPath: _socket, ...noSocket } = record();
  await writeFile(join(home, '.claude', 'sessions', '41.json'), JSON.stringify(noSocket));
  assert.deepEqual(await findClaudeInbox('s1', { home }), { status: 'unreachable', reason: 'no_inbox_socket' });
  assert.deepEqual(await findClaudeProcessInbox(41, { home }), { status: 'unreachable', reason: 'no_inbox_socket' });
  await writeFile(join(home, '.claude', 'sessions', '41.json'), JSON.stringify(record({ messagingSocketPath: '' })));
  assert.deepEqual(await findClaudeInbox('s1', { home }), { status: 'unreachable', reason: 'no_inbox_socket' });
});

test('kind, status and name are not conditions for reaching the inbox', async t => {
  const home = await claudeHome(t);
  const { kind: _kind, status: _status, name: _name, ...bare } = record();
  await writeFile(join(home, '.claude', 'sessions', '41.json'), JSON.stringify(bare));
  assert.deepEqual(await findClaudeInbox('s1', { home }), { status: 'reachable', socket: '/tmp/cc-socks/41.sock', kind: null, claudeStatus: null, name: null });
});

test('a claude process with no sessions JSON is unreachable: no_inbox_socket', async t => {
  const home = await claudeHome(t);
  assert.deepEqual(await findClaudeProcessInbox(99, { home }), { status: 'unreachable', reason: 'no_inbox_socket' });
  assert.deepEqual(await findClaudeProcessInbox(0, { home }), { status: 'unreachable', reason: 'no_inbox_socket' });
  assert.deepEqual(await findClaudeInbox('missing', { home }), { status: 'unreachable', reason: 'no_inbox_socket' });
});

test('a record that cannot be read is not reported as having no socket', async t => {
  const home = await claudeHome(t);
  await writeFile(join(home, '.claude', 'sessions', '41.json'), '{broken');
  assert.deepEqual(await findClaudeProcessInbox(41, { home }), { status: 'unreachable', reason: 'session_record_unreadable' });
  assert.deepEqual(claudeInbox('unreadable'), { status: 'unreachable', reason: 'session_record_unreadable' });
  assert.deepEqual(claudeInbox(null), { status: 'unreachable', reason: 'no_inbox_socket' });
});

async function configHome(t: test.TestContext) {
  const config = await mkdtemp(join(tmpdir(), 'seamless-claude-config-'));
  t.after(() => rm(config, { recursive: true, force: true }));
  await mkdir(join(config, 'sessions'), { recursive: true });
  return config;
}

test('the default folder and the folder CLAUDE_CONFIG_DIR names are both listed, once per pid', async t => {
  const home = await claudeHome(t);
  const config = await configHome(t);
  await writeFile(join(home, '.claude', 'sessions', '41.json'), JSON.stringify(record()));
  // Same pid under the configured folder: not a second candidate.
  await writeFile(join(config, 'sessions', '41.json'), JSON.stringify(record({ sessionId: 'shadowed' })));
  await writeFile(join(config, 'sessions', '42.json'), JSON.stringify(record({ pid: 42, sessionId: 's2', messagingSocketPath: '/tmp/cc-socks/42.sock' })));
  const env = { CLAUDE_CONFIG_DIR: config };
  const files = await claudeSessionFiles({ home, env });
  assert.equal(files.unreadable, false);
  assert.deepEqual(files.files.map(f => f.pid), [41, 42]);
  assert.deepEqual(files.files.map(f => f.path), [join(home, '.claude', 'sessions', '41.json'), join(config, 'sessions', '42.json')]);
  const first = await findClaudeSession('s1', { home, env });
  if (!first || first === 'unreadable') return assert.fail();
  assert.equal(first.pid, 41);
  const second = await findClaudeSession('s2', { home, env });
  if (!second || second === 'unreadable') return assert.fail();
  assert.deepEqual([second.pid, second.sessionId, second.messagingSocketPath], [42, 's2', '/tmp/cc-socks/42.sock']);
  assert.equal(await findClaudeSession('shadowed', { home, env }), null);
  const byPid = await findClaudeSessionByPid(42, { home, env });
  if (!byPid || byPid === 'unreadable') return assert.fail();
  assert.equal(byPid.sessionId, 's2');
  // Without the variable the configured folder is not read.
  assert.equal(await findClaudeSession('s2', { home, env: {} }), null);
  assert.deepEqual((await claudeSessionFiles({ home, env: {} })).files.map(f => f.pid), [41]);
});

test('a transcript under the configured folder is read from there', async t => {
  const home = await claudeHome(t);
  const config = await configHome(t);
  await writeFile(join(config, 'sessions', '42.json'), JSON.stringify(record({ pid: 42, sessionId: 's2', cwd: '/tmp/work' })));
  const dir = join(config, 'projects', '-tmp-work');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 's2.jsonl'), JSON.stringify({ sessionId: 's2', uuid: 'u1', type: 'user', message: { content: 'hello' } }) + '\n');
  const target = { id: 'claude-s2', provider: 'claude', nativeId: 's2', generation: '42@1000000', host: 'local', displayName: 's2', workspace: '/tmp/work', operations: ['read'], grants: [] } satisfies Registration;
  const transcript = await createClaudeReader({ home, env: { CLAUDE_CONFIG_DIR: config } })(target, { complete: true });
  if (!('items' in transcript)) return assert.fail(JSON.stringify(transcript));
  assert.deepEqual(transcript.items.map(item => [item.role, item.text]), [['user', 'hello']]);
});
