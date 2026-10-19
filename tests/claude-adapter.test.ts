import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeInbox, findClaudeInbox, findClaudeProcessInbox, findClaudeSession, findClaudeSessionByPid } from '../src/adapters/claude.ts';

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
