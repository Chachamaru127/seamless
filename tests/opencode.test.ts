import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyEvent,
  defineSeamlessPlugin,
  drainSession,
  inboxDir,
  keyOf,
  putEnvelope,
  readPeer,
  type Envelope,
  type OpenCodePluginApi,
  type PeerRecord,
  type PluginOptions,
} from '../packages/opencode-plugin/index.ts';
import {
  listOpencodePeers,
  opencodeState,
  readOpencodeStructure,
  sendOpencodeEnvelope,
} from '../src/adapters/opencode.ts';

const SESSION = 'ses_abc123';
const NOW = 1_790_000_000_000;
const GEN = '2.0.32:1000';
const session = { id: SESSION, title: 'work', directory: '/work', version: '2.0.32', time: { created: 1000, updated: 1000 } };

type Prompt = { sessionID: string; text: string };
// A fake official plugin API: the session list and `session.prompt` are the only product methods the plugin uses.
function fakeApi(): { api: OpenCodePluginApi; prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  const api: OpenCodePluginApi = {
    app: { version: '2.0.32' },
    location: { directory: '/work' },
    session: {
      async list() {
        return { data: [structuredClone(session)] };
      },
      async prompt(input) {
        prompts.push(input);
        return { data: { info: { id: `msg-${prompts.length}` } } };
      },
    },
  };
  return { api, prompts };
}
const options = (home: string): PluginOptions => ({ home, now: () => NOW, pid: 4242, pollMs: 0, subscribe: false });
const envelope = (id = 'r1'): Envelope => ({
  schemaVersion: 1,
  id,
  sender: { id: 'claude:claude-a', nativeId: 'claude-a', generation: '41@100' },
  recipient: { id: `opencode:${SESSION}`, nativeId: SESSION, generation: GEN },
  text: 'lsof の回数を数えて',
  acceptedAt: NOW,
});

async function home(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'seamless-opencode-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function setup(t: test.TestContext, api: OpenCodePluginApi, dir: string): Promise<void> {
  const plugin = defineSeamlessPlugin(options(dir));
  assert.equal(plugin.id, 'seamless');
  const cleanup = await plugin.setup(api);
  t.after(cleanup);
}

test('idle: the plugin writes the session to the peers file and injects a pending request with session.prompt', async (t) => {
  const dir = await home(t);
  const { api, prompts } = fakeApi();
  await setup(t, api, dir);

  // What seamless sees: one session, idle, so a request can be handed over now.
  const peer = await readPeer(SESSION, dir);
  assert.equal(peer?.state, 'idle');
  assert.equal(peer?.generation, GEN);
  assert.equal(opencodeState(peer!), 'ready');
  assert.equal((await listOpencodePeers({ home: dir })).peers.length, 1);

  // The adapter puts the envelope in pending/; the plugin is the side that calls the official prompt.
  assert.deepEqual(await sendOpencodeEnvelope(envelope(), { home: dir }), { status: 'submitted', nativeMessageId: 'r1' });
  const drained = await applyEvent(api, { type: 'session.idle', properties: { sessionID: SESSION } }, options(dir));
  assert.deepEqual(drained, { status: 'idle', sessionId: SESSION, injected: 1 });

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0]!.sessionID, SESSION);
  assert.match(prompts[0]!.text, /lsof の回数を数えて/);
  assert.match(prompts[0]!.text, /立花さんの承認ではありません/);
  assert.match(prompts[0]!.text, /依頼 ID: r1/);
  assert.deepEqual(await readdir(join(inboxDir(SESSION, dir), 'pending')), []);

  // The plugin's receipt is the evidence for `reached`; the write itself never claims it.
  const structure = await readOpencodeStructure(peer!, { home: dir });
  assert.deepEqual(structure.map((item) => item.peer?.id), ['r1']);
  assert.equal(structure[0]!.generation, GEN);
  // The prompt is now in the session, so the listed state moves to next_turn until OpenCode says idle again.
  assert.equal((await readPeer(SESSION, dir))?.state, 'busy');
});

test('busy: the plugin reports busy, keeps the request pending, and injects it at the next idle event', async (t) => {
  const dir = await home(t);
  const { api, prompts } = fakeApi();
  await setup(t, api, dir);
  assert.deepEqual(await sendOpencodeEnvelope(envelope(), { home: dir }), { status: 'submitted', nativeMessageId: 'r1' });

  const busy = await applyEvent(api, { type: 'session.status', properties: { sessionID: SESSION, status: { type: 'busy' } } }, options(dir));
  assert.equal((busy as PeerRecord).state, 'busy');
  assert.equal(opencodeState((await listOpencodePeers({ home: dir })).peers[0]!), 'next_turn');

  // Busy is an answer, not a failure: nothing is taken from pending and the prompt is not called.
  assert.deepEqual(await drainSession(api, SESSION, options(dir)), { status: 'busy', sessionId: SESSION, injected: 0 });
  assert.equal(prompts.length, 0);
  assert.equal((await readdir(join(inboxDir(SESSION, dir), 'pending'))).length, 1);

  // At the next turn boundary the same request is handed over exactly once.
  await applyEvent(api, { type: 'session.idle', properties: { sessionID: SESSION } }, options(dir));
  assert.equal(prompts.length, 1);
  assert.deepEqual(await readdir(join(inboxDir(SESSION, dir), 'pending')), []);
});

test('a prompt that fails leaves the envelope unknown and never injects it twice', async (t) => {
  const dir = await home(t);
  const { api } = fakeApi();
  api.session!.prompt = async () => { throw new Error('transport'); };
  await setup(t, api, dir);
  await sendOpencodeEnvelope(envelope('r2'), { home: dir });

  assert.deepEqual(await drainSession(api, SESSION, options(dir)), { status: 'idle', sessionId: SESSION, injected: 0 });
  assert.deepEqual(await readdir(join(inboxDir(SESSION, dir), 'unknown')), [keyOf(envelope('r2').sender, 'r2') + '.json']);
  assert.deepEqual(await readOpencodeStructure((await readPeer(SESSION, dir))!, { home: dir }), []);
});

test('an error answer with no prompt id is not a delivery: no receipt, the envelope is unknown', async (t) => {
  const dir = await home(t);
  const { api } = fakeApi();
  let calls = 0;
  // The two shapes a refused prompt can arrive in: an error object alone, and an error next to a message id.
  const answers: unknown[] = [
    { error: { message: 'model unavailable' } },
    { data: { info: { id: 'msg-refused' }, error: { message: 'refused' } } },
  ];
  api.session!.prompt = async () => { calls += 1; return answers.shift(); };
  await setup(t, api, dir);

  for (const id of ['r3', 'r4']) {
    await sendOpencodeEnvelope(envelope(id), { home: dir });
    assert.deepEqual(await drainSession(api, SESSION, options(dir)), { status: 'idle', sessionId: SESSION, injected: 0 });
  }

  // Failure is not delivery: no receipt exists, and both requests are final in unknown/ in the order they were handed.
  assert.deepEqual(await readdir(join(inboxDir(SESSION, dir), 'delivered')), []);
  assert.deepEqual((await readdir(join(inboxDir(SESSION, dir), 'unknown'))).sort(), ['r3', 'r4'].map((id) => keyOf(envelope(id).sender, id) + '.json').sort());
  assert.deepEqual(await readOpencodeStructure((await readPeer(SESSION, dir))!, { home: dir }), []);

  // unknown is final: the next idle event does not hand the refused requests over again.
  await drainSession(api, SESSION, options(dir));
  assert.equal(calls, 2);
});

test('two concurrent puts of one request write one envelope and inject it once', async (t) => {
  const dir = await home(t);
  const { api, prompts } = fakeApi();
  await setup(t, api, dir);
  const request = envelope('r5');

  // One atomic create decides the duplicate: exactly one put writes, the other reports the state the winner left behind.
  const results = await Promise.all([putEnvelope(request, dir), putEnvelope(request, dir)]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['exists', 'written']);
  assert.deepEqual(await readdir(join(inboxDir(SESSION, dir), 'pending')), [keyOf(request.sender, request.id) + '.json']);

  assert.deepEqual(await drainSession(api, SESSION, options(dir)), { status: 'idle', sessionId: SESSION, injected: 1 });
  assert.equal(prompts.length, 1);
  assert.deepEqual(await readdir(join(inboxDir(SESSION, dir), 'pending')), []);
});
