import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { peersOf, companiesOf, focusOf, noticesOf, settle, stepsOf, peerName } from '../hooks/exchanges'
import { trackSvg } from '../hooks/appearance'
import { requestResults } from './fixtures/status-results'
import { clip, durationOf } from '../hooks/text'

const BAND = { plugin: 'seamless-band', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
const START = { surface: 'desktop', isInteractive: true, cwd: '/work' } as const
const PANE = { ...BAND, component: 'Pane', requestId: 'seamless-team' } as never
/** The team pane's tally line, as the pane says it. */
const tally = (sent: number, received: number, unread: number) => `送った ${sent} · 受け取った ${received} · 未読 ${unread}`
const at = '2026-10-04T09:00:00Z'
const request = (name: keyof typeof requestResults) => requestResults[name]
const candidate = (requests: unknown[], provider = 'codex', nativeId = '12345678-abc') => ({ id: `${provider}:${nativeId}`, provider, nativeId, cwd: '/work/project', generation: 'g1', requests })
const response = (requests: unknown[], inbound: unknown[] = []) => ({ status: 'ok', candidates: [candidate(requests)], inbound })
const incoming = (sender: string) => ({ id: 'received', from: { id: 'codex:12345678-abc', nativeId: '12345678-abc', generation: 'g1' }, sender, at })

function seat(on: On, data: unknown) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const state = { data, calls: [] as unknown[], mode: 'ok', delay: 0 }
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('session.end', () => ({ sessionId: 'test-session' }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('process.run', async ($, e) => {
    state.calls.push(e)
    if (state.delay) await clock.sleep(state.delay)
    if (state.mode === 'timeout') return { deny: 'process timeout after 20000ms' }
    if (state.mode === 'failure') return { value: { exitCode: 1, stdout: '', stderr: 'failed' } }
    return { value: { exitCode: 0, stdout: state.mode === 'json' ? '{' : JSON.stringify(state.data), stderr: '' } }
  })
  return { clock, state }
}

for (const [name, requests, inbound, right, label, word] of [
  ['processing', [request('processing')], [], '↑1', '読んでいる', '読んでいる'],
  ['replied', [request('replied')], [], '↑1', '返信', '返信あり'],
  ['reached', [request('reached')], [], '↑1(1)', '届いた', '届いた・未読'],
  ['unknown', [request('unknown')], [], '↑1(1)', '未確認', '送った'],
  ['pending', [request('pending')], [], '↑1(1)', '未確認', '送った'],
  ['submitted', [request('submitted')], [], '↑1(1)', '未確認', '送った'],
  ['unknown but processing observed', [request('unknown processing')], [], '↑1', '読んでいる', '読んでいる'],
  ['unknown but replied observed', [request('unknown replied')], [], '↑1', '返信', '返信あり'],
  ['rejected but reached observed', [request('rejected reached')], [], '↑1(1)', '届いた', '届いた・未読'],
  ['missing delivery', [{ ...request('accepted'), delivery: undefined }], [], '↑1(1)', '未確認', '送った'],
  ['rejected', [request('rejected')], [], '↑1', '届かなかった', '! 届かなかった'],
  ['accepted', [request('accepted')], [], '↑1(1)', '未確認', '送った'],
  ['unobserved processing', [request('unobserved processing')], [], '↑1(1)', '未確認', '送った'],
  ['verified inbound', [], [incoming('verified')], '↓1(1)', 'まだ読んでいない', '依頼が届いた'],
  ['declared inbound', [], [incoming('declared')], '↓1(1)', '未確認', '依頼が届いた'],
] as const) {
  test(`right side tally: ${name}`, async ($, on) => {
    const { clock } = seat(on, response([...requests], [...inbound]))
    await $.session.start(START); await $.ui.mount(BAND)
    await clock.settle()
    const ui = await $.ui.mount(BAND)
    // The counts moved to the team pane: the line names the peer and its state, and ×n opens the pane.
    expect((await ui.find({ key: 'team' }))?.props.label).toBe('×1')
    const pane = await $.ui.mount(PANE)
    expect((await pane.find({ key: 'pane-tally' }))?.text).toContain(right.startsWith('↑') ? tally(1, 0, 0) : tally(0, 1, 1))
    expect((await pane.find({ key: 'card-0' }))?.text).toContain('project')
    expect((await ui.find({ key: 'focus-codex' }))?.text).toMatch(new RegExp(`^${word}`))
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${word}`) }))?.props.color).toBe(name === 'rejected' ? 'error' : name.includes('inbound') || name.includes('replied') ? 'success' : 'warning')
    await ui.press({ key: 'toggle' })
    const peer = await ui.find({ key: 'peer-0' })
    expect(peer?.text).toContain('project')
    expect(peer?.text).toContain('Codex 12345678')
    expect(peer?.text).toContain(label)
    expect(peer?.text).not.toContain('本文は保存していません')
    const problems = (await ui.find({ key: 'problems' }))?.text
    if (name === 'rejected') expect(problems).toContain('project への依頼')
    else expect(problems).toBeUndefined()
  })
}

test('received requests count as unread until the next turn begins', async ($, on) => {
  // The test clock starts at 1,000,000 ms; the request arrived before it.
  const { clock } = seat(on, response([], [{ ...incoming('verified'), at: '1970-01-01T00:00:00Z' }]))
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ key: 'pane-tally' }))?.text).toContain(tally(0, 1, 1))
  await clock.advance(1); await $.turn.start({ text: 'read it', turnId: 't' })
  expect((await pane.find({ key: 'pane-tally' }))?.text).toContain(tally(0, 1, 0))
})

test('company totals include both directions and count what is not confirmed', async ($, on) => {
  const data = response([request('replied')], [incoming('verified')])
  data.candidates.push(candidate([{ ...request('reached'), at: '2026-10-04T10:00:00Z' }], 'codex', '87654321'))
  data.candidates.push(candidate([], 'claude'))
  const { clock } = seat(on, data)
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  // Two conversations with exchanges; the one without any is not a peer.
  expect((await ui.find({ key: 'team' }))?.props.label).toBe('×2')
  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ key: 'pane-title' }))?.text).toBe('チーム · 2 会話')
  expect((await pane.find({ key: 'pane-tally' }))?.text).toContain(tally(2, 1, 1))
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'exchanges' }))?.text).toContain('project')
  expect((await ui.find({ key: 'exchanges' }))?.text).not.toContain('直近24時間')
})

for (const mode of ['failure', 'timeout', 'json', 'status', 'shape']) {
  test(`query ${mode} makes right unknown while left keeps ticking, then recovers`, async ($, on) => {
    const { clock, state } = seat(on, mode === 'status' ? { status: 'error' } : mode === 'shape' ? { status: 'ok', candidates: null } : response([request('replied')]))
    state.mode = mode
    await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
    await $.turn.start({ text: 'work', turnId: 't' })
    const ui = await $.ui.mount(BAND)
    await clock.advance(2000)
    expect((await ui.find({ type: 'Text', text: '!' }))?.props.color).toBe('error')
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'problems' }))?.text).toContain('やりとりの状態を確かめられなかった')
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'activity' }))?.text).toContain('指示を読んでいる')
    expect((await ui.find({ type: 'Text', text: '2秒' }))?.text).toBe('2秒')
    state.mode = 'ok'; state.data = response([request('replied')])
    await clock.advance(58000); await clock.settle()
    expect((await ui.find({ key: 'focus-codex' }))?.text).toBe('返信あり')
    expect(await ui.find({ type: 'Text', text: '!' })).toBeUndefined()
  })
}

test('queries start on desktop render, every 60 seconds, after seamless tools and receives without overlap', async ($, on) => {
  const { clock, state } = seat(on, response([]))
  on('tool.call', () => ({ result: 'ok' }))
  state.delay = 20000
  await $.session.start(START); await $.ui.mount(BAND)
  expect(state.calls.length).toBe(1)
  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'message' })
  await $.tool.call({ tool: 'mcp__seamless__sessions' } as Parameters<Engine['tool']['call']>[0])
  expect(state.calls.length).toBe(1)
  state.delay = 0
  await clock.advance(20000); await clock.settle()
  expect(state.calls.length).toBe(2)
  const call = state.calls[0] as { argv: string[]; init: { timeoutMs: number } }
  expect(call.argv[0]).toBe('/Users/tachibanashuuta/.local/share/mise/installs/node/24/bin/node')
  expect(call.argv[1]).toBe('/Users/tachibanashuuta/LocalWork/Code/seamless/src/cli.ts')
  expect(call.argv.slice(2)).toEqual(['band'])
  expect(call.init.timeoutMs).toBe(20000)
  state.delay = 0
  await clock.advance(39999)
  expect(state.calls.length).toBe(2)
  await clock.advance(1); await clock.settle()
  expect(state.calls.length).toBe(3)
  await $.tool.call({ tool: 'Read', file_path: '/work/x' })
  expect(state.calls.length).toBe(3)
  await $.tool.call({ tool: 'mcp__seamless__send', track: 'req1' } as Parameters<Engine['tool']['call']>[0]); await clock.settle()
  expect(state.calls.length).toBe(4)
  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'message' }); await clock.settle()
  expect(state.calls.length).toBe(5)
})

test('snippet is only first 40 characters of current main-session send input, sanitized on display', async ($, on) => {
  const dirty = '\u0000\u001b\u0085\u200b\u202e\u2066\u034f\ufe0f'
  const data = response([request('reached')])
  data.candidates[0].cwd = `/work/pro${dirty}ject`
  const { clock } = seat(on, data)
  on('tool.call', () => ({ result: 'same result' }))
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const text = 'あ'.repeat(25) + dirty + 'Z'.repeat(40)
  const result = await $.tool.call({ tool: 'mcp__seamless__send', id: 'req1', text } as Parameters<Engine['tool']['call']>[0])
  expect(result).toEqual({ result: 'same result' })
  await clock.settle(); await ui.press({ key: 'toggle' })
  const row = (await ui.find({ key: 'peer-0' }))?.text ?? ''
  expect(row).toContain('あ'.repeat(25))
  expect(row).toContain('Z'.repeat(7))
  expect(row).not.toContain('Z'.repeat(8))
  expect(row).not.toMatch(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u)
})

test('missing timestamps and unavailable inbound sender workspace stay unconfirmed', async () => {
  const data = response([{ ...request('replied'), at: null }])
  expect(companiesOf(peersOf(JSON.stringify(data)))[0].color).toBe('#8d8b85')
  const onlyInbound = peersOf(JSON.stringify({ status: 'ok', candidates: [], inbound: [incoming('declared')] }))
  expect(onlyInbound[0].cwd).toBe('')
  expect(companiesOf(onlyInbound)[0].color).toBe('#8d8b85')
})

test('tool.call, tool.check, prompt.submit and session.receive pass input and output unchanged', async ($, on) => {
  const { clock } = seat(on, response([]))
  let toolSeen: unknown
  let checkSeen: unknown
  let promptSeen: unknown
  on('tool.call', ($, e) => { toolSeen = e; return { deny: 'original denial' } })
  on('tool.check', ($, e) => { checkSeen = e; return { decision: 'ask' } })
  on('prompt.submit', ($, e) => { promptSeen = e; return { text: e.text } })
  const input = { tool: 'Bash', command: 'echo unchanged', description: 'check' } as const
  expect(await $.tool.call(input)).toEqual({ deny: 'original denial' })
  expect(toolSeen).toMatchObject(input)
  const check = { tool: 'Bash', input: { command: 'echo unchanged' } } as const
  expect(await $.tool.check(check)).toMatchObject({ decision: 'ask' })
  expect(checkSeen).toMatchObject(check)
  expect(await $.prompt.submit({ text: 'unchanged' })).toMatchObject({ text: 'unchanged' })
  expect(promptSeen).toMatchObject({ text: 'unchanged' })
  expect(await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'unchanged' })).toMatchObject({ text: 'unchanged' })
  await clock.settle()
})

test('reset discards snippets and ignores an old query completing in the new conversation', async ($, on) => {
  const { clock, state } = seat(on, response([request('reached')]))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  await $.tool.call({ tool: 'mcp__seamless__send', id: 'req1', text: 'private preview' } as Parameters<Engine['tool']['call']>[0]); await clock.settle()
  state.delay = 10000
  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'start slow query' })
  await $.session.end({ reason: 'clear' })
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount(BAND)
  await clock.advance(10000); await clock.settle()
  expect(await ui.find({ key: 'team' })).toBeUndefined()
  state.delay = 0
  await clock.advance(50000); await clock.settle()
  await ui.press({ key: 'toggle' })
  const rows = (await ui.find({ key: 'exchanges' }))?.text ?? ''
  expect(rows).not.toContain('private preview')
  expect(rows).toContain('project')
})

test('failed refresh grays existing peer rows instead of showing stale green', async ($, on) => {
  const { clock, state } = seat(on, response([request('replied')]))
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  state.mode = 'failure'
  await clock.advance(60000); await clock.settle()
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'peer-0' }))?.text).toContain('未確認')
  expect((await ui.find({ key: 'peer-0' }))?.text).not.toContain('返信')
  expect(await ui.find({ key: 'focus-codex' })).toBeUndefined()
})


test('clip counts code points without splitting emoji surrogate pairs', async () => {
  expect(clip('😀😁😂', 3)).toBe('😀😁😂')
  expect(clip('A😀BC', 3)).toBe('A😀…')
  expect(clip('😀😁😂', 2)).toBe('😀…')
  expect(clip('😀😁😂', 1)).toBe('…')
})

test('inbound across generations joins one peer by provider and nativeId', async () => {
  const old = incoming('verified')
  old.from.generation = 'old'
  const data = response([request('reached')], [old])
  data.candidates.push(candidate([], 'claude', '12345678-abc'))
  const peers = peersOf(JSON.stringify(data))
  expect(peers.length).toBe(1)
  expect(peers[0].generation).toBe('g1')
  expect(peers[0].cwd).toBe('/work/project')
  expect(peers[0].exchanges.length).toBe(2)
  expect(companiesOf(peers)[0].count).toBe(2)
})

for (const mode of ['ok', 'failure']) test(`busy ${mode} refresh coalesces queued requests into one follow-up`, async ($, on) => {
  const { clock, state } = seat(on, response([]))
  state.mode = mode
  state.delay = 1000
  await $.session.start(START); await $.ui.mount(BAND)
  for (let i = 0; i < 3; i++) await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'refresh' })
  expect(state.calls.length).toBe(1)
  await clock.advance(999)
  expect(state.calls.length).toBe(1)
  await clock.advance(1); await clock.settle()
  expect(state.calls.length).toBe(2)
  await clock.advance(1000); await clock.settle()
  expect(state.calls.length).toBe(2)
})

test('session end discards queued refresh without starting another query', async ($, on) => {
  const { clock, state } = seat(on, response([]))
  state.delay = 1000
  await $.session.start(START); await $.ui.mount(BAND)
  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'refresh' })
  await $.session.end({ reason: 'clear' })
  await clock.advance(1000); await clock.settle()
  expect(state.calls.length).toBe(1)
})

test('desktop band draws inside the app card with theme colors: purpose bold, action thin, marks and logos as Svg', async ($, on) => {
  const data = response([request('replied')])
  data.candidates.push(candidate([request('reached')], 'claude', 'claude-peer'))
  const { clock } = seat(on, data)
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  await $.turn.start({ text: '見本に合わせる。細部は後で', turnId: 'design' })
  const ui = await $.ui.mount(BAND)
  const band = (await ui.find({ key: 'band' }))?.props ?? {}
  expect(band).not.toHaveProperty('backgroundColor')
  expect(band).not.toHaveProperty('borderStyle')
  expect((await ui.find({ type: 'Text', text: '見本に合わせる' }))?.props).toMatchObject({ bold: true, color: 'text' })
  expect((await ui.find({ type: 'Text', text: /指示を読んでいる/ }))?.props).toMatchObject({ color: 'inactive' })
  expect((await ui.find({ type: 'Text', text: /指示を読んでいる/ }))?.props.bold).not.toBe(true)
  expect((await ui.find({ type: 'Text', text: '0秒' }))?.props.color).toBe('subtle')
  const stateMark = await ui.find({ type: 'Svg' })
  expect(stateMark?.props.source).toContain('#8070f0')
  // The Desktop app drops an Svg whose alt is empty (2026-10-05, on screen).
  expect(stateMark?.props.alt).toBe('作業中')
  expect(await ui.find({ key: 'details' })).toBeUndefined()
  // The line names one peer by its conversation, with a grey monogram for the company: no brand colours.
  expect((await ui.find({ key: 'team' }))?.props.label).toBe('×2')
  const avatar = (await ui.find({ key: 'chip-avatar' }))?.children[0] as { type: string; props: Record<string, unknown> }
  expect(avatar.type).toBe('Svg')
  expect(avatar.props).toMatchObject({ width: 14, height: 14 })
  expect(['Codex', 'Claude']).toContain(avatar.props.alt)
  expect(avatar.props.source).toContain('#8d8b85')
  expect(avatar.props.source).not.toContain('#10a37f')
  expect(avatar.props.source).not.toContain('#d97757')
  expect((await ui.find({ key: 'chip-name' }))?.text).toBe('project')
  const track = (await ui.find({ key: 'chip-track' }))?.children[0] as { props: Record<string, unknown> }
  expect(track.props.height).toBe(8)
  expect([...String(track.props.source).matchAll(/<line /g)].length).toBe(3)
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'goal' }))?.text).toContain('見本に合わせる。細部は後で')
  for (const text of ['目的', 'やりとり']) expect((await ui.find({ type: 'Text', text }))?.props.color).toBe('subtle')
  expect((await ui.find({ key: 'peer-0' }))?.text).toContain('project')
  expect((await ui.find({ key: 'peer-0' }))?.text).toContain('返信')
  expect((await ui.find({ key: 'peer-1' }))?.text).toContain('届いた')
  expect((await ui.find({ key: 'peer-1' }))?.text).toContain('読む')
  expect(await ui.find({ key: 'plan' })).toBeUndefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ key: 'details' })).toBeUndefined()
})

 test('elapsed time stays short across the minute boundary', async () => {
  expect(durationOf(59999)).toBe('59秒')
  expect(durationOf(60000)).toBe('1分0秒')
  expect(durationOf(72000)).toBe('1分12秒')
  expect(durationOf(-1000)).toBe('0秒')
})

for (const interactive of [true, false]) test(`terminal interactive=${interactive} never queries or adds UI`, async ($, on) => {
  const { clock, state } = seat(on, response([]))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', { component: 'ToolProgress' }, () => ({ type: 'Text', props: {}, children: ['original progress'] }))
  await $.session.start({ ...START, surface: 'terminal', isInteractive: interactive })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'received' })
  await $.tool.call({ tool: 'mcp__seamless__sessions' } as Parameters<Engine['tool']['call']>[0])
  await clock.advance(120000); await clock.settle()
  expect(state.calls.length).toBe(0)
  expect(await ui.find({ key: 'band' })).toBeUndefined()
  expect(await ui.find({ key: 'activity' })).toBeUndefined()
  const progress = await $.ui.mount({ ...BAND, surface: 'terminal', component: 'ToolProgress', props: { tool_use_id: 'tool' } } as never)
  expect(await progress.find({ type: 'Text', text: 'original progress' })).toBeDefined()
  expect(state.calls.length).toBe(0)
})

test('desktop session waits for first AbovePrompt render and starts one 60 second poller', async ($, on) => {
  const { clock, state } = seat(on, response([]))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'before drawing' })
  await $.tool.call({ tool: 'mcp__seamless__sessions' } as Parameters<Engine['tool']['call']>[0])
  await clock.advance(120000)
  expect(state.calls.length).toBe(0)
  await $.ui.mount(BAND); await clock.settle()
  expect(state.calls.length).toBe(1)
  await $.ui.mount(BAND); await clock.settle()
  expect(state.calls.length).toBe(1)
  await clock.advance(59999)
  expect(state.calls.length).toBe(1)
  await clock.advance(1); await clock.settle()
  expect(state.calls.length).toBe(2)
})

const T = Date.parse(at)
const staged = (stages: Partial<Record<'reached' | 'processing' | 'replied', number>>, extra: Record<string, unknown> = {}) => ({
  status: 'ok', id: 'req1', delivery: 'submitted', at, ...extra,
  stages: (['accepted', 'reached', 'processing', 'replied'] as const).map(stage => stage === 'accepted'
    ? { stage, status: 'observed', evidence: [], at }
    : { stage, status: stages[stage] === undefined ? 'unobserved' : 'observed', evidence: [], at: stages[stage] === undefined ? null : new Date(T + stages[stage]!).toISOString() }),
})
const peers = (requests: unknown[], inbound: unknown[] = [], status = 'online') =>
  peersOf(JSON.stringify({ status: 'ok', candidates: [{ ...candidate(requests), status }], inbound }))

test('the closed band names the exchange that matters: unread first, then the newest request on its way', () => {
  expect(focusOf(peers([staged({})]), null, T + 5000)).toMatchObject({ provider: 'codex', word: '送った', tone: 'attn', sinceMs: T })
  expect(focusOf(peers([staged({ reached: 1000 })]), null, T + 5000)).toMatchObject({ word: '届いた・未読', sinceMs: T + 1000 })
  expect(focusOf(peers([staged({ reached: 1000, processing: 2000 })]), null, T + 5000)).toMatchObject({ word: '読んでいる', sinceMs: T + 2000 })
  expect(focusOf(peers([staged({ reached: 1000, processing: 2000, replied: 3000 })]), null, T + 5000)).toMatchObject({ word: '返信あり', tone: 'ok' })
  // An answer older than half an hour says nothing more; the counts stay.
  expect(focusOf(peers([staged({ replied: 3000 })]), null, T + 31 * 60_000)).toBeNull()
  expect(focusOf(peers([{ ...staged({}), delivery: 'rejected', stages: [] }]), null, T)).toMatchObject({ word: '届かなかった', tone: 'fail' })
  const reply = { ...incoming('verified'), at: new Date(T + 3000).toISOString() }
  expect(focusOf(peers([staged({ reached: 1000, processing: 2000, replied: 3000 })], [reply]), null, T + 5000)).toMatchObject({ word: '返信が届いた', tone: 'ok' })
  expect(focusOf(peers([staged({})], [incoming('verified')]), null, T)).toMatchObject({ word: '依頼が届いた' })
  // Read once the next turn began after it came.
  expect(focusOf(peers([staged({})], [incoming('verified')]), T + 1, T + 5000)).toMatchObject({ word: '送った' })
  expect(focusOf([], null, T)).toBeNull()
})

test('a request is drawn as its way so far: sent, arrived, read, answered, with the times', () => {
  const [peer] = peers([staged({ reached: 60_000, processing: 120_000 })])
  expect(stepsOf(peer!, peer!.exchanges[0]!, null).map(step => [step.word, step.state])).toEqual([['送った', 'done'], ['届いた', 'done'], ['読んでいる', 'now'], ['返信', 'todo']])
  expect(stepsOf(peer!, peer!.exchanges[0]!, null)[2]!.at).toBe(T + 120_000)
  const [waiting] = peers([staged({ reached: 60_000 })])
  expect(stepsOf(waiting!, waiting!.exchanges[0]!, null).map(step => step.state)).toEqual(['done', 'done', 'now', 'todo'])
  const [done] = peers([staged({ reached: 1, processing: 2, replied: 3 })])
  expect(stepsOf(done!, done!.exchanges[0]!, null).map(step => [step.word, step.state])).toEqual([['送った', 'done'], ['届いた', 'done'], ['読んだ', 'done'], ['返信', 'done']])
  const [lost] = peers([{ ...staged({}), delivery: 'rejected', stages: [] }])
  expect(stepsOf(lost!, lost!.exchanges[0]!, null).map(step => [step.word, step.state])).toEqual([['送った', 'done'], ['届かなかった', 'bad']])
  const [received] = peers([], [incoming('verified')])
  expect(stepsOf(received!, received!.exchanges[0]!, null).map(step => step.word)).toEqual(['受け取った', 'まだ読んでいない'])
  expect(stepsOf(received!, received!.exchanges[0]!, T + 1).map(step => step.word)).toEqual(['受け取った', '読んだ'])
  expect(peers([staged({})], [], 'offline')[0]!.online).toBe(false)
  expect(peers([staged({})])[0]!.online).toBe(true)
})

/** The notices of a later look, the earlier one seen first with nothing told. */
const notices = (before: ReturnType<typeof peers>, after: ReturnType<typeof peers>, told = new Set<string>()) => {
  noticesOf(before, told, false)
  return noticesOf(after, told, true)
}

test('changes between two looks become notices: taken up, answered, not delivered, received', () => {
  const sent = peers([staged({ reached: 1000 })])
  expect(notices(sent, peers([staged({ reached: 1000, processing: 2000 })]), new Set())).toEqual(['project が依頼を読み始めました'])
  expect(notices(peers([staged({ reached: 1000, processing: 2000 })]), peers([staged({ reached: 1000, processing: 2000, replied: 3000 })]), new Set())).toEqual(['project が依頼に返信しました'])
  // An answer that also came here as a message is told once, as the message.
  const reply = { ...incoming('verified'), at: new Date(T + 3000).toISOString() }
  expect(notices(peers([staged({ processing: 2000 })]), peers([staged({ processing: 2000, replied: 3000 })], [reply]), new Set())).toEqual(['project から返信が届きました'])
  expect(notices([], peers([], [incoming('verified')]), new Set())).toEqual(['project から依頼が届きました'])
  expect(notices(sent, peers([{ ...staged({}), delivery: 'rejected', stages: [] }]), new Set())).toEqual(['project に依頼が届きませんでした'])
  expect(notices([], peers([{ ...staged({}), id: 'req2', delivery: 'rejected', stages: [] }]), new Set())).toEqual(['project に依頼が届きませんでした'])
  expect(notices(sent, sent, new Set())).toEqual([])
  // A request first met by the later look is told by where it stands.
  expect(notices([], peers([staged({ processing: 2000 })]), new Set())).toEqual(['project が依頼を読み始めました'])
  expect(notices([], peers([staged({ reached: 1000 })]), new Set())).toEqual([])
  // A request and a message with the same id are two things.
  const both = peers([staged({ processing: 2000 })], [{ ...incoming('verified'), id: 'req1' }])
  expect(notices(peers([staged({ processing: 2000 })]), both, new Set())).toEqual(['project から依頼が届きました'])
  expect(notices(both, both, new Set())).toEqual([])
  // One reply seen first as an answer, then as a message, is told once.
  const told = new Set<string>()
  const answered = peers([staged({ processing: 2000, replied: 3000 })])
  expect(notices(peers([staged({ processing: 2000 })]), answered, told)).toEqual(['project が依頼に返信しました'])
  expect(notices(answered, peers([staged({ processing: 2000, replied: 3000 })], [reply]), told)).toEqual([])
})

test('a stage that drops out of a look and comes back is not told again', () => {
  const told = new Set<string>()
  noticesOf(peers([staged({ reached: 1000 })]), told, false)
  expect(noticesOf(peers([staged({ reached: 1000, processing: 2000 })]), told, true)).toEqual(['project が依頼を読み始めました'])
  // The peer's history could not be read: the stages are gone for a look.
  expect(noticesOf(peers([staged({})]), told, true)).toEqual([])
  expect(noticesOf(peers([staged({ reached: 1000, processing: 2000 })]), told, true)).toEqual([])
  // An answer told, then seen only as the message that carried it, is not told again, nor as a new request.
  expect(noticesOf(peers([staged({ reached: 1000, processing: 2000, replied: 3000 })]), told, true)).toEqual(['project が依頼に返信しました'])
  const reply = { ...incoming('verified'), id: 'msg1', at: new Date(T + 3000).toISOString() }
  expect(noticesOf(peers([staged({})], [reply]), told, true)).toEqual([])
  // Taken up after it was answered says nothing.
  const late = new Set<string>()
  noticesOf(peers([staged({ reached: 1000 })]), late, false)
  expect(noticesOf(peers([staged({ replied: 3000 })]), late, true)).toEqual(['project が依頼に返信しました'])
  expect(noticesOf(peers([staged({ processing: 2000, replied: 3000 })]), late, true)).toEqual([])
  // A message seen first, its answer stage later, with the message gone or still there: told once.
  for (const keepsMessage of [false, true]) {
    const first = new Set<string>()
    const message = { ...incoming('verified'), id: 'msg2', at: new Date(T + 3000).toISOString() }
    noticesOf(peers([staged({ reached: 1000 })]), first, false)
    expect(noticesOf(peers([staged({ reached: 1000 })], [message]), first, true)).toEqual(['project から依頼が届きました'])
    expect(noticesOf(peers([staged({ reached: 1000, processing: 2000, replied: 3000 })], keepsMessage ? [message] : []), first, true)).toEqual([])
    expect(noticesOf(peers([staged({ reached: 1000, processing: 2000, replied: 3000 })]), first, true)).toEqual([])
  }
})

test('a peer whose state is unknown is said neither running nor stopped', () => {
  expect(peers([staged({})], [], 'unknown')[0]!.online).toBeNull()
  expect(peersOf(JSON.stringify({ status: 'ok', candidates: [candidate([staged({})])], inbound: [] }))[0]!.online).toBeNull()
})

test('a failed look leaves the peer without a running state', async ($, on) => {
  const { clock, state } = seat(on, { status: 'ok', candidates: [{ ...candidate([staged({ reached: 1000 })]), status: 'online' }], inbound: [] })
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'peer-0' }))?.text).toContain('動いている')
  state.mode = 'failure'
  await clock.advance(60000); await clock.settle()
  expect((await ui.find({ key: 'peer-0' }))?.text).not.toContain('動いている')
  expect((await ui.find({ key: 'peer-0' }))?.text).toContain('状態は未確認')
})

test('a running Grok CLI peer is named Grok and said to be running in the open band', async ($, on) => {
  const grok = { ...candidate([staged({ reached: 1000 })], 'grok', '01a11a77-0e68-7ce1-a4c6-9e88420abdb5'), status: 'online' }
  const parsed = peersOf(JSON.stringify({ status: 'ok', candidates: [grok], inbound: [] }))
  expect(parsed[0]!.provider).toBe('grok')
  expect(parsed[0]!.online).toBe(true)
  const { clock } = seat(on, { status: 'ok', candidates: [grok], inbound: [] })
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  const peer = (await ui.find({ key: 'peer-0' }))?.text ?? ''
  expect(peer).toContain('動いている')
  expect(peer).toContain('Grok 01a11a77')
})

test('a stopped Grok CLI peer is said to be stopped in the open band', async ($, on) => {
  const grok = { ...candidate([staged({ reached: 1000 })], 'grok', '01a11a77-0e68-7ce1-a4c6-9e88420abdb5'), status: 'offline' }
  const { clock } = seat(on, { status: 'ok', candidates: [grok], inbound: [] })
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  const peer = (await ui.find({ key: 'peer-0' }))?.text ?? ''
  expect(peer).toContain('止まっている')
  expect(peer).not.toContain('動いている')
})

test('a change seen by a later look is told as a toast; the first look tells nothing', async ($, on) => {
  const { clock, state } = seat(on, response([staged({ reached: 1000 })]))
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return {} as never })
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  expect(toasts).toEqual([])
  state.data = response([staged({ reached: 1000, processing: 2000 })])
  await clock.advance(60000); await clock.settle()
  expect(toasts).toEqual(['project が依頼を読み始めました'])
  await clock.advance(60000); await clock.settle()
  expect(toasts).toEqual(['project が依頼を読み始めました'])
})

test('the open band puts the exchanges first: each peer, whether it runs, and each request with its steps', async ($, on) => {
  const { clock } = seat(on, { status: 'ok', candidates: [{ ...candidate([staged({ reached: 60_000, processing: 120_000 })]), status: 'online' }], inbound: [] })
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  await $.turn.start({ text: '帯を仕上げる', turnId: 't' })
  await $.tool.call({ tool: 'mcp__seamless__send', id: 'req1', text: '設計の疑問点を3件、返して' } as Parameters<Engine['tool']['call']>[0]); await clock.settle()
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  const details = (await ui.find({ key: 'details' }))?.text ?? ''
  expect(details.indexOf('やりとり')).toBeLessThan(details.indexOf('目的'))
  const peer = (await ui.find({ key: 'peer-0' }))?.text ?? ''
  expect(peer).toContain('動いている')
  expect(peer).toContain('「設計の疑問点を3件、返して…」')
  expect(peer).toMatch(/送った \d+:\d\d─届いた \d+:\d\d─読んでいる \d+:\d\d〜─返信/)
  const chain = (await ui.find({ key: 'req-steps-0-0' }))?.children as { type: string; props: Record<string, unknown> }[] | undefined
  const now = chain?.find(node => node.type === 'Svg' && node.props.alt === '今ここ')
  expect(now?.props.source).toContain('#d9752b')
})

test('a stage once seen stays: a look that misses it does not take the request back', () => {
  const memory = new Map()
  settle(peers([staged({ reached: 1000, processing: 2000, replied: 3000 })]), memory)
  const missed = settle(peers([staged({ reached: 1000 })]), memory)
  expect(focusOf(missed, null, T + 5000)).toMatchObject({ word: '返信あり' })
  expect(stepsOf(missed[0]!, missed[0]!.exchanges[0]!, null).map(step => step.state)).toEqual(['done', 'done', 'done', 'done'])
  expect(missed[0]!.exchanges[0]!.color).toBe('#38c68e')
  const bare = settle(peers([{ ...staged({}), stages: [] }]), memory)
  expect(focusOf(bare, null, T + 5000)).toMatchObject({ word: '返信あり' })
})

test('the band does not step back when a later look misses a stage', async ($, on) => {
  const { clock, state } = seat(on, response([staged({ reached: 1000, processing: 2000, replied: 3000 })]))
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ key: 'focus-codex' }))?.text).toBe('返信あり')
  state.data = response([staged({ reached: 1000 })])
  await clock.advance(60000); await clock.settle()
  expect((await ui.find({ key: 'focus-codex' }))?.text).toBe('返信あり')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'peer-0' }))?.text).not.toContain('読んでいる')
})

test('more than three changes in one look are told as two and a count of the rest', async ($, on) => {
  const { clock, state } = seat(on, response([]))
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return {} as never })
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  state.data = response([], ['m1', 'm2', 'm3', 'm4'].map((id, i) => ({ ...incoming('verified'), id, at: new Date(T + i * 1000).toISOString() })))
  await clock.advance(60000); await clock.settle()
  expect(toasts).toEqual(['project から依頼が届きました', 'project から依頼が届きました', 'ほか2件のやりとりの変化。帯を開くと見られます'])
})

test('the track colours the line into a step by that step: grey up to one not yet reached, green between seen ones', () => {
  const bars = (states: Parameters<typeof trackSvg>[0]) => [...trackSvg(states).matchAll(/<line [^>]*stroke="(#[0-9a-f]{6})"/g)].map(m => m[1])
  expect(bars(['done', 'done', 'now', 'todo'])).toEqual(['#2f8f5b', '#2f8f5b', '#8d8b85'])
  expect(bars(['done', 'done', 'done', 'done'])).toEqual(['#2f8f5b', '#2f8f5b', '#2f8f5b'])
  expect(bars(['done', 'bad'])).toEqual(['#2f8f5b'])
  expect(bars(['done', 'now'])).toEqual(['#2f8f5b'])
})

test('a peer is named by its conversation: the folder, or the repository and worktree', () => {
  const peer = (cwd: string) => ({ provider: 'codex' as const, nativeId: '12345678-abc', generation: 'g', cwd, online: null, exchanges: [] })
  expect(peerName(peer('/Users/t/Code/seamless'))).toBe('seamless')
  expect(peerName(peer('/Users/t/Code/seamless/.claude/worktrees/hello-6d7bef'))).toBe('seamless · hello-6d7bef')
  expect(peerName(peer(''))).toBe('作業場所は未確認')
})

// Grok CLI (specs/202610-more-peers T1-6b): an envelope waiting in the inbox is said to be accepted and not delivered,
// with a note when the peer has not moved for 5 minutes; one whose handing over is unknown asks for the person's check.
const grokPeer = (request: unknown, now?: number) => peersOf(JSON.stringify({ status: 'ok', candidates: [{ ...candidate([request], 'grok', '01a11a77-0e68-7ce1-a4c6-9e88420abdb5'), status: 'online' }], inbound: [] }), now)[0]!
const reachWord = (request: unknown, now?: number) => { const p = grokPeer(request, now); return stepsOf(p, p.exchanges[0]!, null)[1]! }
test('a Grok request without delivery confirmation says accepted, not delivered; the idle note comes only after 5 minutes', () => {
  const waiting = (activeAgoMs: number) => staged({}, { inbox: 'pending', peerActiveAt: new Date(T - activeAgoMs).toISOString() })
  expect(reachWord(waiting(4 * 60_000), T).word).toBe('受理・未配信')
  expect(reachWord(waiting(6 * 60_000), T).word).toBe('受理・未配信（相手は 5 分以上動いていない。次の 1 手の後に届く）')
  expect(reachWord(waiting(6 * 60_000), T).state).toBe('now')
  expect(grokPeer(waiting(6 * 60_000), T).exchanges[0]!.label).toContain('受理・未配信')
  // Being taken by the hook (delivering) is still waiting; without a clock no idle note is guessed.
  expect(reachWord(staged({}, { inbox: 'delivering', peerActiveAt: new Date(T - 600_000).toISOString() })).word).toBe('受理・未配信')
})
test('a Grok request whose handing over is unknown asks for the person to check, and a delivered one says delivered', () => {
  for (const inbox of ['handed', 'unknown']) {
    const step = reachWord(staged({}, { inbox }))
    expect(step.word).toBe('成否不明。立花さんの確認が要る')
    expect(step.state).toBe('bad')
  }
  expect(reachWord(staged({ reached: 1000 }, { inbox: 'delivered' })).word).toBe('届いた')
  // A Claude or Codex request has no inbox and keeps its words.
  expect(stepsOf(peers([staged({})])[0]!, peers([staged({})])[0]!.exchanges[0]!, null)[1]!.word).not.toContain('受理・未配信')
})
test('the open band shows a waiting Grok request as accepted and not delivered', async ($, on) => {
  const { clock } = seat(on, { status: 'ok', candidates: [{ ...candidate([staged({}, { inbox: 'pending' })], 'grok', '01a11a77-0e68-7ce1-a4c6-9e88420abdb5'), status: 'online' }], inbound: [] })
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'peer-0' }))?.text ?? '').toContain('受理・未配信')
})
