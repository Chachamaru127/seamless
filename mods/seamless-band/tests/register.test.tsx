import type { On, TurnStepChunk } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'seamless-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const DONE = {
  answer: 'All fixed.',
  durationMs: 1000,
  isAborted: false,
  reason: 'answer',
  category: null,
  explanation: null,
} as const

const SPAWN = {
  prompt: 'Do the work.',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

const STEP = { turnId: 't1', model: 'claude-opus-5-5', messageCount: 1 } as const

/**
 * Stands for the engine beneath the band, which draws nothing of its own
 * there (the surveys aside).
 */
function seatBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine" />
  })
}

/**
 * Seats the engine beneath the plugin: a clock, turns, a model whose steps
 * yield `script[index]`, and tools that answer `toolAnswer`. `seen` keeps
 * what the box said at each `look()` a step or a tool takes.
 */
function seat(on: On, script: readonly (readonly TurnStepChunk[])[]) {
  const box = {
    read: async () => '',
    seen: [] as string[],
    toolAnswer: { deny: 'stubbed in the test' } as { deny: string },
    onTool: async () => {},
  }

  const clock = mock.clock(on, { now: 1_000_000 })
  seatBand(on)

  const look = async () => {
    box.seen.push(await box.read())
  }

  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))

  on('turn.step', async function* ($, e) {
    for (const chunk of script[e.index] ?? []) {
      yield chunk
      await clock.advance(300)
      await look()
    }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: e.index + 1 < script.length ? 'tool_use' : 'end_turn',
      usage: null,
    } as const
  })

  on('tool.call', async () => {
    await box.onTool()
    await look()

    return box.toolAnswer
  })

  return { box, clock }
}

async function mount($: Engine, box: { read: () => Promise<string> }) {
  const ui = await $.ui.mount(BAND)

  box.read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''

  return ui
}

async function step($: Engine, index: number) {
  for await (const _ of $.turn.step({ ...STEP, index })) {
    // drained: the beneath hook looks at the box between chunks
  }
}

describe('register', () => {
  test('the box says idle before any turn, its triangle closed', async ($, on) => {
    mock.clock(on)
    seatBand(on)

    const ui = await $.ui.mount(BAND)
    const text = (await ui.find({ key: 'activity' }))?.text ?? ''

    expect(text).toContain('待機中')
    expect(text).toContain('▸')
  })

  test('another plugin drawing the band keeps its box, under this one', async ($, on) => {
    mock.clock(on)

    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box key="beneath">
          <Text>2 tasks for you</Text>
        </Box>
      )
    })

    const ui = await $.ui.mount(BAND)

    expect((await ui.find({ key: 'activity' }))?.text ?? '').toContain('待機中')
    expect((await ui.find({ key: 'beneath' }))?.text ?? '').toContain('2 tasks for you')
  })

  test('a turn reads, thinks, prepares, runs, reviews, writes and ends', async ($, on) => {
    const { box } = seat(on, [
      [
        { kind: 'thinking', index: 0, text: 'The config looks off. I should check the loader first' },
        { kind: 'tool', index: 1, id: 'tu1', name: 'Read' },
        { kind: 'input', index: 1, json: '{"file_path": "src/app.ts"' },
      ],
      [{ kind: 'text', index: 0, text: 'All fixed now, the loader reads it.' }],
    ])

    await mount($, box)

    const { turnId } = await $.turn.start({ text: 'fix the config', turnId: 't1' })

    expect(await box.read()).toContain('指示を読んでいる')

    await step($, 0)

    expect(box.seen[0]).toContain('考えている: I should check the loader first')
    expect(box.seen[1]).toContain('指示を読んでいる')
    expect(box.seen[2]).toContain('ファイルを読む: app.ts')
    expect(box.seen.join(' ')).not.toContain('Preparing')

    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })

    expect(box.seen[3]).toContain('ファイルを読む: app.ts')
    expect(await box.read()).toContain('1手順の結果を確認している')

    await step($, 1)

    expect(box.seen[4]).toContain('返事を書いている / 7語')

    await $.turn.complete({ ...DONE, turnId })

    expect(await box.read()).toContain('待機中 / 前回')
  })

  test('the triangle opens the history of the turn', async ($, on) => {
    const { box } = seat(on, [
      [{ kind: 'thinking', index: 0, text: 'Look at the file.' }],
      [{ kind: 'text', index: 0, text: 'Done.' }],
    ])

    const ui = await mount($, box)

    const { turnId } = await $.turn.start({ text: 'fix the config', turnId: 't1' })

    await step($, 0)
    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })
    await step($, 1)
    await $.turn.complete({ ...DONE, turnId })

    expect(await ui.find({ key: 'history' })).toBeUndefined()

    await ui.press({ key: 'toggle' })

    const history = (await ui.find({ key: 'history' }))?.text ?? ''

    expect(history).toContain('fix the config')
    expect(history).toContain('考えた (4語)')
    expect(history).toContain('⊘ 道具を使っている: ファイルを読む: app.ts')
    expect(history).toContain('返事を書いた (1語)')
    expect(history).toContain('で完了')
    expect((await ui.find({ key: 'activity' }))?.text).toContain('▾')
  })

  test('thinking with no thought text keeps the last action', async ($, on) => {
    const { box } = seat(on, [
      [{ kind: 'thinking', index: 0, text: '' }],
      [{ kind: 'thinking', index: 0, text: '' }],
    ])

    await mount($, box)
    await $.turn.start({ text: 'fix the config', turnId: 't1' })
    await step($, 0)
    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })
    await step($, 1)

    expect(box.seen[0]).toContain('指示を読んでいる')
    expect(box.seen[2]).toContain('ファイルを読む: app.ts')
    expect(box.seen.join(' ')).not.toContain('Thinking')
  })

  test('a command being written shows its description, never the command', async ($, on) => {
    const { box } = seat(on, [
      [
        { kind: 'tool', index: 0, id: 'tu1', name: 'Bash' },
        { kind: 'input', index: 0, json: '{"command": "npm test --silent"' },
        { kind: 'input', index: 0, json: ', "description": "Run the tests"' },
      ],
    ])

    await mount($, box)
    await $.turn.start({ text: 'test it', turnId: 't1' })
    await step($, 0)

    expect(box.seen[1]).toContain('指示を読んでいる')
    expect(box.seen[2]).toContain('Run the tests')
    expect(box.seen.join(' ')).not.toContain('npm test')
  })

  test('control characters in a label never take the box down', async ($, on) => {
    const { box } = seat(on, [])
    const ui = await mount($, box)
    const esc = String.fromCharCode(27)
    const bel = String.fromCharCode(7)
    const rlo = String.fromCharCode(0x202e)

    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: `src/${esc}]0;title${bel}${esc}[31m${rlo}red.ts` })
    await $.tool.call({ tool: 'Read', file_path: `src/${'x'.repeat(200000)}.ts` })
    await ui.press({ key: 'toggle' })

    const history = (await ui.find({ key: 'history' }))?.text ?? ''

    expect(box.seen[0]).toContain('ファイルを読む')
    expect(box.seen[0]).toContain('red.ts')
    expect(box.seen[0]).not.toContain(esc)
    expect(box.seen[0]).not.toContain(rlo)
    expect(box.seen[1]?.length ?? 0).toBeLessThan(400)
    expect(history).toContain('red.ts')
  })

  test('a call waiting on a permission prompt says so', async ($, on) => {
    const { box } = seat(on, [])

    box.onTool = async () => {
      await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } })
    }

    await mount($, box)
    await $.turn.start({ text: 'test it', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })

    expect(box.seen[0]).toContain('承認待ち: 道具を使っている: Run the tests')
  })

  test('agents still at work after the turn keep the box busy', async ($, on) => {
    const { box, clock } = seat(on, [])

    on('agent.spawn', ($, e) => ({ model: 'claude-opus-5-5', agentId: e.tool_use_id === 'tu1' ? 'a1' : 'a2' }))

    const ui = await mount($, box)
    const { turnId } = await $.turn.start({ text: 'launch the panel', turnId: 't1' })

    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu1', description: 'Draft the plan' })
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2', description: 'Storyboard the video' })
    await $.turn.complete({ ...DONE, turnId })
    // A call made inside a subagent's loop, which carries its id.
    await $.tool.call({ tool: 'Read', file_path: 'README.md', agentId: 'a1' } as Parameters<Engine['tool']['call']>[0])
    await clock.advance(300)

    const team = (await ui.find({ key: 'agents' }))?.text ?? ''

    expect(await box.read()).toContain('2個の子エージェントが作業中')
    expect(team).toContain('Draft the plan › 道具を使っている: ファイルを読む: README.md')
    expect(team).toContain('Storyboard the video › 開始している')

    await $.turn.complete({ ...DONE, turnId: 't2', agentId: 'a2' })

    expect(await box.read()).toContain('Draft the plan › 道具を使っている: ファイルを読む: README.md')
    expect(await ui.find({ key: 'agents' })).toBeUndefined()

    await $.turn.complete({ ...DONE, turnId: 't3', agentId: 'a1', reason: 'error' })
    await ui.press({ key: 'toggle' })

    const history = (await ui.find({ key: 'history' }))?.text ?? ''

    expect(await box.read()).toContain('待機中')
    expect(history).toContain('✓ 子エージェント: Storyboard the video')
    expect(history).toContain('✗ 子エージェント: Draft the plan')
  })

  test('a named agent is shown by its Agent call description, never its prompt', async ($, on) => {
    const { box, clock } = seat(on, [])

    on('agent.list', () => ({
      value: [{
        id: 'areviewer-1f2e',
        description: 'You are reviewing the diff. Read every file and',
        name: 'reviewer',
        type: 'general-purpose',
        status: 'running',
      }],
    }))

    const ui = await mount($, box)

    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts', agentId: 'areviewer-1f2e' } as Parameters<Engine['tool']['call']>[0])
    await clock.advance(1000)

    // Before its Agent call is seen, the engine's handle for it stands.
    expect(await box.read()).toContain('reviewer › 道具を使っている: ファイルを読む: app.ts')

    box.toolAnswer = { result: { status: 'teammate_spawned' } } as never
    await $.tool.call({
      tool: 'Agent',
      name: 'reviewer',
      description: 'Review the diff',
      prompt: 'You are reviewing the diff. Read every file and…',
    } as Parameters<Engine['tool']['call']>[0])
    await clock.advance(1000)

    expect(await box.read()).toContain('Review the diff › 道具を使っている: ファイルを読む: app.ts')
    expect(await box.read()).not.toContain('You are reviewing')
    expect(await ui.find({ key: 'agents' })).toBeUndefined()
  })

  test('a background agent is named from the Agent call that launched it', async ($, on) => {
    const { box, clock } = seat(on, [])

    await mount($, box)

    box.toolAnswer = {
      result: { status: 'async_launched', agentId: 'b1', description: 'This is a long prompt. Read it all.' },
    } as never

    await $.tool.call({ tool: 'Agent', description: 'Tour the source', prompt: 'Read it.' } as Parameters<Engine['tool']['call']>[0])

    expect(await box.read()).toContain('Tour the source › 開始している')

    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts', agentId: 'b1' } as Parameters<Engine['tool']['call']>[0])
    await clock.advance(300)

    expect(await box.read()).toContain('Tour the source › 道具を使っている: ファイルを読む: app.ts')
  })
})

test('six left states show Japanese labels and update elapsed seconds', async ($, on) => {
  const { box, clock } = seat(on, [
    [{ kind: 'thinking', index: 0, text: '確認する。' }],
    [{ kind: 'text', index: 0, text: '結果です。' }],
  ])
  const ui = await mount($, box)
  await $.turn.start({ text: '確認', turnId: 't1' })
  await clock.advance(2000)
  expect(await box.read()).toContain('指示を読んでいる / 2秒')
  await step($, 0)
  expect(box.seen[0]).toContain('考えている: 確認する。 / 0秒')
  box.onTool = async () => {
    await clock.advance(2700)
    expect(await box.read()).toContain('道具を使っている: テストを実行 / 2秒')
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'test' } })
    await clock.advance(1000)
    expect(await box.read()).toContain('承認待ち: 道具を使っている: テストを実行 / 3秒')
  }
  await $.tool.call({ tool: 'Bash', command: 'test', description: 'テストを実行' })
  await step($, 1)
  expect(box.seen.join(' ')).toContain('返事を書いている')
  await $.turn.complete({ ...DONE, turnId: 't1' })
  await clock.advance(2700)
  expect(await box.read()).toContain('待機中')
  expect(await box.read()).toContain('/ 2秒')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'history' }))?.text).toContain('3秒')
})

test('turn.step forwards its completion result and streamed chunks unchanged', async ($, on) => {
  mock.clock(on)
  const chunk = { kind: 'text', index: 0, text: 'unchanged' } as const
  const result = { turnId: 't1', index: 0, answer: 'unchanged', toolUses: [], stopReason: 'end_turn', usage: null } as const
  on('turn.step', async function* () { yield chunk; return result })
  const stream = $.turn.step({ ...STEP, index: 0 })
  expect((await stream.next()).value).toEqual(chunk)
  expect((await stream.next()).value).toEqual(result)
})

test('thinking and reply timers advance while the stream is open', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  seatBand(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  let read = async () => ''
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: '判断する。' }
    await clock.advance(2000)
    expect(await read()).toContain('考えている: 判断する。 / 2秒')
    yield { kind: 'text', index: 1, text: '回答です。' }
    await clock.advance(3000)
    expect(await read()).toContain('返事を書いている')
    expect(await read()).toContain('/ 3秒')
    return { turnId: e.turnId, index: e.index, answer: '回答です。', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const ui = await $.ui.mount(BAND)
  read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''
  await $.turn.start({ text: '質問', turnId: 't1' })
  await step($, 0)
})


for (const stop of ['return', 'throw'] as const) test(`turn.step closes inner stream on outer ${stop}`, async ($, on) => {
  mock.clock(on)
  let closed = 0
  on('turn.step', async function* ($, e) {
    try {
      yield { kind: 'text', index: 0, text: 'first' }
      yield { kind: 'text', index: 1, text: 'second' }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    } finally { closed++ }
  })
  const stream = $.turn.step({ ...STEP, index: 0 })
  await stream.next()
  if (stop === 'return') await stream.return(undefined)
  else {
    let caught = false
    try { await stream.throw(new Error('stop')) } catch { caught = true }
    expect(caught).toBe(true)
  }
  expect(closed).toBe(1)
})
