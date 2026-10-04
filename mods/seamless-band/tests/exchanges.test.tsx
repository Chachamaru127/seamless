import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { peersOf, companiesOf } from '../hooks/exchanges'
import { requestResults } from './fixtures/status-results'
import { clip, durationOf } from '../hooks/text'

const BAND = { plugin: 'seamless-band', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
const START = { surface: 'desktop', isInteractive: true, cwd: '/work' } as const
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

for (const [name, requests, inbound, color, label] of [
  ['processing', [request('processing')], [], '#38c68e', '既読'],
  ['replied', [request('replied')], [], '#38c68e', '既読 · 返信あり'],
  ['reached', [request('reached')], [], '#f9a437', '届いた · 未読'],
  ['unknown', [request('unknown')], [], '#8d8b85', '未確認'],
  ['pending', [request('pending')], [], '#8d8b85', '未確認'],
  ['submitted', [request('submitted')], [], '#8d8b85', '未確認'],
  ['unknown but processing observed', [request('unknown processing')], [], '#38c68e', '既読'],
  ['unknown but replied observed', [request('unknown replied')], [], '#38c68e', '既読 · 返信あり'],
  ['rejected but reached observed', [request('rejected reached')], [], '#f9a437', '届いた · 未読'],
  ['missing delivery', [{ ...request('accepted'), delivery: undefined }], [], '#8d8b85', '未確認'],
  ['rejected', [request('rejected')], [], '#fe3a52', '届かなかった'],
  ['accepted', [request('accepted')], [], '#8d8b85', '未確認'],
  ['unobserved processing', [request('unobserved processing')], [], '#8d8b85', '未確認'],
  ['verified inbound', [], [incoming('verified')], '#38c68e', '受け取った'],
  ['declared inbound', [], [incoming('declared')], '#8d8b85', '未確認'],
] as const) {
  test(`right color table: ${name}`, async ($, on) => {
    const { clock } = seat(on, response([...requests], [...inbound]))
    await $.session.start(START); await $.ui.mount(BAND)
    await clock.settle()
    const ui = await $.ui.mount(BAND)
    const company = await ui.find({ type: 'Text', text: /^ [0-9]/ })
    expect(company?.text).toContain(' 1')
    expect(company?.props.color).toBe(color)
    await ui.press({ key: 'toggle' })
    const peer = await ui.find({ key: 'peer-0' })
    expect(peer?.text).toContain('Codex · project')
    expect(peer?.text).toContain(label)
    expect(peer?.text).toContain('本文は保存していません')
  })
}

test('company totals include both directions and newest exchange across peers decides color', async ($, on) => {
  const data = response([request('replied')], [incoming('verified')])
  data.candidates.push(candidate([{ ...request('reached'), at: '2026-10-04T10:00:00Z' }], 'codex', '87654321'))
  data.candidates.push(candidate([], 'claude'))
  const { clock } = seat(on, data)
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^ [0-9]/ }))?.text).toContain(' 3')
  expect((await ui.find({ type: 'Text', text: /^ [0-9]/ }))?.props.color).toBe('#f9a437')
  expect(await ui.find({ key: 'company-claude' })).toBeUndefined()
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'exchanges' }))?.text).toContain('直近24時間')
  expect((await ui.find({ key: 'exchanges' }))?.text).toContain('相手ごと最大10件')
})

for (const mode of ['failure', 'timeout', 'json', 'status', 'shape']) {
  test(`query ${mode} makes right unknown while left keeps ticking, then recovers`, async ($, on) => {
    const { clock, state } = seat(on, mode === 'status' ? { status: 'error' } : mode === 'shape' ? { status: 'ok', candidates: null } : response([request('replied')]))
    state.mode = mode
    await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
    await $.turn.start({ text: 'work', turnId: 't' })
    const ui = await $.ui.mount(BAND)
    await clock.advance(2000)
    expect((await ui.find({ type: 'Text', text: '未確認' }))?.props.color).toBe('#8d8b85')
    expect((await ui.find({ type: 'Text', text: '未確認' }))?.text).toBe('未確認')
    expect((await ui.find({ key: 'activity' }))?.text).toContain('指示を読んでいる · 2秒')
    state.mode = 'ok'; state.data = response([request('replied')])
    await clock.advance(58000); await clock.settle()
    expect((await ui.find({ type: 'Text', text: /^ [0-9]/ }))?.props.color).toBe('#38c68e')
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
  expect(await ui.find({ type: 'Text', text: '未確認' })).toBeDefined()
  state.delay = 0
  await clock.advance(50000); await clock.settle()
  await ui.press({ key: 'toggle' })
  const rows = (await ui.find({ key: 'exchanges' }))?.text ?? ''
  expect(rows).not.toContain('private preview')
  expect(rows).toContain('本文は保存していません')
})

test('failed refresh grays existing peer rows instead of showing stale green', async ($, on) => {
  const { clock, state } = seat(on, response([request('replied')]))
  await $.session.start(START); await $.ui.mount(BAND); await clock.settle()
  state.mode = 'failure'
  await clock.advance(60000); await clock.settle()
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'peer-0' }))?.text).toContain('未確認')
  expect((await ui.find({ key: 'peer-0' }))?.text).not.toContain('既読')
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

for (const surface of ['desktop'] as const) test(`${surface} closed and expanded trees match the agreed band`, async ($, on) => {
  const data = response([request('replied')])
  data.candidates.push(candidate([request('reached')], 'claude', 'claude-peer'))
  const { clock } = seat(on, data)
  await $.session.start({ ...START, surface }); await $.ui.mount({ ...BAND, surface }); await clock.settle()
  await $.turn.start({ text: '見本に合わせる', turnId: 'design' })
  const ui = await $.ui.mount({ ...BAND, surface })
  expect((await ui.find({ key: 'band' }))?.props).toMatchObject({ backgroundColor: '#1d1d1b', borderStyle: 'round' })
  expect((await ui.find({ key: 'activity' }))?.props).toMatchObject({ flexDirection: 'row', paddingX: 1.5, minHeight: surface === 'desktop' ? 2.125 : 1 })
  expect((await ui.find({ type: 'Text', text: '指示を読んでいる' }))?.props).toMatchObject({ bold: true, color: '#fff' })
  expect((await ui.find({ type: 'Text', text: ' ● ' }))?.props.color).toBe('#8070f0')
  expect((await ui.find({ type: 'Text', text: ' · 0秒' }))?.props.color).toBe('#8d8b85')
  expect(await ui.find({ key: 'details' })).toBeUndefined()
  const companies = await ui.find({ key: 'companies' })
  // The kit returns raw descendants; Text keys are intentionally absent there.
  const badges = companies?.children as { type: string; props: Record<string, unknown>; children: { type: string; props: Record<string, unknown> }[] }[]
  expect(badges.map(b => b.props.key)).toEqual(['company-codex', 'company-claude'])
  for (const [index, color] of ['#38c68e', '#f9a437'].entries()) {
    const badge = badges[index]
    expect(badge.type).toBe('Box')
    expect(badge.props).toMatchObject({ backgroundColor: '#2a2a27', borderStyle: 'round' })
    expect(badge.children[1].props.color).toBe(color)
    const logo = badge.children[0]
    expect(logo.type).toBe(surface === 'desktop' ? 'Svg' : 'Text')
    if (surface === 'desktop') {
      expect(logo.props).toMatchObject({ width: 14, height: 14, alt: index === 0 ? 'Codex' : 'Claude' })
      expect(logo.props.source).toContain(color)
      expect(logo.props.source).toContain(index === 0 ? 'M12 3.2a4.4' : 'M13.8 4h3.1')
    }
  }
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'divider' }))?.props.backgroundColor).toBe('#2e2e2b')
  for (const text of ['この会話', 'やりとり']) expect((await ui.find({ type: 'Text', text }))?.props.color).toBe('#8d8b85')
  expect((await ui.find({ key: 'history' }))?.text).toContain('› 見本に合わせる')
  expect((await ui.find({ key: 'current-step' }))?.text).toContain('● 指示を読んでいる')
  expect((await ui.find({ key: 'peer-0' }))?.text).toContain('Codex · project 「本文は保存していません」既読 · 返信あり')
  expect((await ui.find({ key: 'peer-1' }))?.text).toContain('届いた · 未読')
  const peer = await ui.find({ key: 'peer-0' })
  expect((peer?.children[0] as { type: string }).type).toBe(surface === 'desktop' ? 'Svg' : 'Text')
  if (surface === 'terminal') expect(await ui.find({ type: 'Svg' })).toBeUndefined()
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
