import type { On, TurnStepChunk } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { activityOf, commandPurpose } from '../hooks/activity-of'

const BAND = {
  plugin: 'seamless-band',
  surface: 'desktop',
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
    // TodoWrite goes through unless a test says otherwise: the plan follows only a successful one.
    todoAnswer: { result: 'ok' } as { result: string; isError?: boolean } | { deny: string } | 'throw',
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

  on('tool.call', async ($, e) => {
    await box.onTool()
    await look()

    if (e.tool !== 'TodoWrite') return box.toolAnswer
    if (box.todoAnswer === 'throw') throw new Error('stopped')
    return box.todoAnswer
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

    expect(box.seen[0]).toContain('考えている')
    expect(box.seen[0]).not.toContain('I should check')
    expect(box.seen[1]).toContain('指示を読んでいる')
    expect(box.seen[2]).toContain('app.ts を読む')
    expect(box.seen.join(' ')).not.toContain('Preparing')

    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })

    expect(box.seen[3]).toContain('app.ts を読む')
    expect(await box.read()).toContain('1手順の結果を確認している')

    await step($, 1)

    expect(box.seen[4]).toContain('返事を書いている / 29字')

    await $.turn.complete({ ...DONE, turnId })

    expect(await box.read()).toContain('fix the config')
    expect(await box.read()).toContain('で完了、1手順')
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

    expect(await ui.find({ key: 'details' })).toBeUndefined()

    await ui.press({ key: 'toggle' })

    const steps = (await ui.find({ key: 'steps' }))?.text ?? ''

    expect((await ui.find({ key: 'goal' }))?.text).toContain('fix the config')
    expect(steps).toContain('app.ts を読む')
    expect(steps).not.toContain('道具を使っている')
    expect(steps).not.toContain('考えた')
    expect(steps).not.toContain('返事を書いた')
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
    expect(box.seen[2]).toContain('app.ts を読む')
    expect(box.seen.join(' ')).not.toContain('Thinking')
  })

  test('a command being written is said in Japanese, never as the command or an English description', async ($, on) => {
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
    expect(box.seen[2]).toContain('試験を走らせる')
    expect(box.seen.join(' ')).not.toContain('npm test')
    expect(box.seen.join(' ')).not.toContain('Run the tests')
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

    const history = (await ui.find({ key: 'steps' }))?.text ?? ''

    expect(box.seen[0]).toContain('red.ts を読む')
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

    expect(box.seen[0]).toContain('承認を待っています')
    expect(box.seen[0]).toContain('試験を走らせる')
    expect(box.seen[0]).not.toContain('承認待ち:')
  })

  test('agents still at work after the turn keep the box busy', async ($, on) => {
    const { box, clock } = seat(on, [])

    on('agent.spawn', ($, e) => ({ model: 'claude-opus-5-5', agentId: e.tool_use_id === 'tu1' ? 'a1' : 'a2' }))

    const ui = await mount($, box)
    const { turnId } = await $.turn.start({ text: 'launch the panel', turnId: 't1' })

    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu1', description: '計画を書く' })
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2', description: '絵コンテを作る' })
    await $.turn.complete({ ...DONE, turnId })
    // A call made inside a subagent's loop, which carries its id.
    await $.tool.call({ tool: 'Read', file_path: 'README.md', agentId: 'a1' } as Parameters<Engine['tool']['call']>[0])
    await clock.advance(300)

    await ui.press({ key: 'toggle' })
    const team = (await ui.find({ key: 'agents' }))?.text ?? ''

    expect(await box.read()).toContain('2個の子エージェントが作業中')
    expect(team).toContain('計画を書く › README.md を読む')
    expect(team).toContain('絵コンテを作る › 開始している')

    await $.turn.complete({ ...DONE, turnId: 't2', agentId: 'a2' })

    expect(await box.read()).toContain('計画を書く › README.md を読む')
    expect(await ui.find({ key: 'agents' })).toBeUndefined()

    await $.turn.complete({ ...DONE, turnId: 't3', agentId: 'a1', reason: 'error' })
    const history = (await ui.find({ key: 'steps' }))?.text ?? ''

    expect(await box.read()).toContain('launch the panel')
    expect(await box.read()).toContain('で完了')
    expect(history).toContain('子エージェント: 絵コンテを作る')
    expect(history).toContain('子エージェント: 計画を書く')
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
    expect(await box.read()).toContain('reviewer › app.ts を読む')

    box.toolAnswer = { result: { status: 'teammate_spawned' } } as never
    await $.tool.call({
      tool: 'Agent',
      name: 'reviewer',
      description: '差分を見る',
      prompt: 'You are reviewing the diff. Read every file and…',
    } as Parameters<Engine['tool']['call']>[0])
    await clock.advance(1000)

    expect(await box.read()).toContain('差分を見る › app.ts を読む')
    expect(await box.read()).not.toContain('You are reviewing')
    expect(await ui.find({ key: 'agents' })).toBeUndefined()
  })

  test('a background agent is named from the Agent call that launched it', async ($, on) => {
    const { box, clock } = seat(on, [])

    await mount($, box)

    box.toolAnswer = {
      result: { status: 'async_launched', agentId: 'b1', description: 'This is a long prompt. Read it all.' },
    } as never

    await $.tool.call({ tool: 'Agent', description: 'ソースを見て回る', prompt: 'Read it.' } as Parameters<Engine['tool']['call']>[0])

    expect(await box.read()).toContain('ソースを見て回る › 開始している')

    await $.tool.call({ tool: 'Read', file_path: 'src/app.ts', agentId: 'b1' } as Parameters<Engine['tool']['call']>[0])
    await clock.advance(300)

    expect(await box.read()).toContain('ソースを見て回る › app.ts を読む')
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
  expect(await box.read()).toContain('指示を読んでいる')
  expect(await box.read()).toContain('2秒')
  await step($, 0)
  expect(box.seen[0]).toContain('考えている: 確認する。')
  box.onTool = async () => {
    await clock.advance(2700)
    expect(await box.read()).toContain('テストを実行')
    expect(await box.read()).toContain('2秒')
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'test' } })
    await clock.advance(1000)
    expect(await box.read()).toContain('承認を待っています')
    expect(await box.read()).toContain('テストを実行')
    expect(await box.read()).toContain('3秒')
  }
  await $.tool.call({ tool: 'Bash', command: 'test', description: 'テストを実行' })
  await step($, 1)
  expect(box.seen.join(' ')).toContain('返事を書いている')
  await $.turn.complete({ ...DONE, turnId: 't1' })
  await clock.advance(2700)
  expect(await box.read()).toContain('確認')
  expect(await box.read()).toContain('で完了')
  expect(await box.read()).not.toContain('2秒')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'steps' }))?.text).toContain('3秒')
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
    expect(await read()).toContain('考えている: 判断する。')
    expect(await read()).toContain('2秒')
    yield { kind: 'text', index: 1, text: '回答です。' }
    await clock.advance(3000)
    expect(await read()).toContain('返事を書いている')
    expect(await read()).toContain('3秒')
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

test('desktop line: the plan step with n/m from TodoWrite, the action of the moment, no plan after it ends', async ($, on) => {
  const { box } = seat(on, [])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  box.read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''
  expect(await box.read()).toContain('待機中')
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'read', activeForm: '読む', status: 'completed' }, { content: 'plan', activeForm: '計画\u202eを作成中', status: 'in_progress' }, { content: 'ship', activeForm: '出す', status: 'pending' }] } as Parameters<Engine['tool']['call']>[0])
  box.onTool = async () => {
    expect(await box.read()).toContain('コマンドの目的')
    expect(await box.read()).toContain('計画を作成中 2/3')
    expect(await box.read()).not.toContain('\u202e')
  }
  await $.tool.call({ tool: 'Bash', command: 'test', description: 'コマンドの目的' })
  box.onTool = async () => {}
  await ui.press({ key: 'toggle' })
  const plan = (await ui.find({ key: 'plan' }))?.text ?? ''
  expect(plan).toContain('計画 2/3')
  expect(plan).toContain('read')
  expect(plan).toContain('計画を作成中')
  expect(plan).toContain('ship')
  expect(await ui.find({ key: 'steps' })).toBeUndefined()
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'plan', activeForm: '計画を作成中', status: 'completed' }] } as Parameters<Engine['tool']['call']>[0])
  box.onTool = async () => {
    expect(await box.read()).toContain('コマンドの目的')
    expect(await box.read()).not.toContain('計画を作成中')
  }
  await $.tool.call({ tool: 'Bash', command: 'test', description: 'コマンドの目的' })
})

test('desktop line leads with the purpose, drops the generic tool word, and goes quiet with the turn', async ($, on) => {
  const { box } = seat(on, [])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  box.read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''
  const { turnId } = await $.turn.start({ text: 'plan it. then ship', turnId: 't1' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'plan', activeForm: '計画を作成中', status: 'in_progress' }] } as Parameters<Engine['tool']['call']>[0])
  box.onTool = async () => {
    const text = await box.read()
    expect(text).toContain('plan it')
    expect(text).not.toContain('then ship')
    expect(text).toContain('計画を作成中 1/1')
    expect(text).toContain('app.ts を読む')
    expect(text).not.toContain('道具を使っている')
  }
  await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })
  box.onTool = async () => {}
  await $.turn.complete({ ...DONE, turnId })
  expect(await box.read()).toContain('plan it')
  expect(await box.read()).toContain('で完了')
  expect(await box.read()).not.toContain('計画を作成中')
})

test('desktop line has no generic tool word with parallel calls', async ($, on) => {
  const { box } = seat(on, [])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  box.read = async () => (await ui.find({ key: 'activity' }))?.text ?? ''
  await $.turn.start({ text: 'run both', turnId: 't1' })
  box.onTool = async () => {
    box.onTool = async () => {
      const text = await box.read()
      expect(text).toContain('テストを実行')
      expect(text).toContain('(+ほか1件)')
      expect(text).not.toContain('道具を使っている')
    }
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'テストを実行' })
  }
  await $.tool.call({ tool: 'Read', file_path: 'src/app.ts' })
})

const todos = (statuses: readonly ('pending' | 'in_progress' | 'completed')[]) =>
  ({ tool: 'TodoWrite', todos: statuses.map((status, i) => ({ content: `step ${i + 1}`, activeForm: `doing ${i + 1}`, status })) }) as Parameters<Engine['tool']['call']>[0]

test('plan times: the step in progress keeps counting, a finished step keeps its time', async ($, on) => {
  const { clock } = seat(on, [])
  const ui = await $.ui.mount(BAND)
  await $.tool.call(todos(['in_progress', 'pending']))
  await clock.advance(5000)
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'plan' }))?.text).toContain('doing 15秒')
  await $.tool.call(todos(['completed', 'in_progress']))
  await clock.advance(20000)
  await $.tool.call(todos(['completed', 'in_progress']))
  const plan = (await ui.find({ key: 'plan' }))?.text ?? ''
  expect(plan).toContain('step 15秒')
  expect(plan).toContain('doing 220秒')
})

test('a new request clears a finished plan and keeps an unfinished one', async ($, on) => {
  seat(on, [])
  const ui = await $.ui.mount(BAND)
  await $.tool.call(todos(['completed', 'completed']))
  await $.turn.start({ text: 'next thing', turnId: 't1' })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ key: 'plan' })).toBeUndefined()
  await $.tool.call(todos(['completed', 'in_progress']))
  await $.turn.start({ text: 'and more', turnId: 't2' })
  expect((await ui.find({ key: 'plan' }))?.text).toContain('計画 2/2')
})

test('a long plan shows the step in progress, with what is hidden before and after', async ($, on) => {
  seat(on, [])
  const ui = await $.ui.mount(BAND)
  await $.tool.call(todos(['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'in_progress', 'pending', 'pending', 'pending', 'pending']))
  await ui.press({ key: 'toggle' })
  const plan = (await ui.find({ key: 'plan' }))?.text ?? ''
  expect(plan).toContain('計画 8/12')
  expect(plan).toContain('doing 8')
  expect(plan).toContain('済み 5件')
  expect(plan).toContain('ほか 1件')
  expect(plan).not.toContain('step 5')
})

test('steps mark done, failed, refused and stopped apart', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  seatBand(on)
  const answers: Record<string, () => unknown> = {
    'done.ts': () => ({ result: 'ok' }),
    'failed.ts': () => ({ result: 'bad', isError: true }),
    'refused.ts': () => ({ deny: 'no' }),
    'stopped.ts': () => { throw new Error('stopped') },
  }
  on('tool.call', ($, e) => answers[String((e as unknown as { file_path: string }).file_path)]() as { result: string })
  const ui = await $.ui.mount(BAND)
  for (const name of Object.keys(answers)) {
    try { await $.tool.call({ tool: 'Read', file_path: name }) } catch { /* the stopped call */ }
  }
  await ui.press({ key: 'toggle' })
  const tints = ['#2f8f5b', '#d64545', '#d9752b', '#8d8b85']
  const words = ['済み', '失敗', '拒否', '中断']
  for (const [i, name] of Object.keys(answers).entries()) {
    const row = await ui.find({ key: `step-${i}` })
    expect(row?.text).toContain(name)
    const mark = row?.children[0] as { props: { source: string; alt: string } }
    expect(mark.props.source).toContain(tints[i])
    expect(mark.props.alt).toBe(words[i])
  }
})

test('plan clock starts over when a step returns to progress from pending or from outside the list', async ($, on) => {
  const { clock } = seat(on, [])
  const ui = await $.ui.mount(BAND)
  await $.tool.call(todos(['in_progress']))
  await clock.advance(5000)
  await $.tool.call(todos(['pending']))
  await clock.advance(15000)
  await $.tool.call(todos(['in_progress']))
  await clock.advance(3000)
  await $.tool.call(todos(['completed']))
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'plan' }))?.text).toContain('step 13秒')
  await $.tool.call({ tool: 'TodoWrite', todos: [] } as Parameters<Engine['tool']['call']>[0])
  await $.tool.call(todos(['in_progress']))
  await clock.advance(2000)
  expect((await ui.find({ key: 'plan' }))?.text).toContain('doing 12秒')
})

test('a long plan keeps the step in progress in view even after many steps not started', async ($, on) => {
  seat(on, [])
  const ui = await $.ui.mount(BAND)
  await $.tool.call(todos(['pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'in_progress', 'pending', 'pending', 'pending', 'pending']))
  await ui.press({ key: 'toggle' })
  const plan = (await ui.find({ key: 'plan' }))?.text ?? ''
  expect(plan).toContain('doing 8')
  expect(plan).toContain('前に 5件')
  expect(plan).not.toContain('済み')
})

for (const [how, answer] of [['refused', { deny: 'no' }], ['failed', { result: 'bad', isError: true }], ['stopped', 'throw']] as const) test(`a ${how} TodoWrite leaves the plan and its clock as they were`, async ($, on) => {
  const { box, clock } = seat(on, [])
  const ui = await $.ui.mount(BAND)
  await $.tool.call(todos(['in_progress', 'pending']))
  await clock.advance(4000)
  box.todoAnswer = answer
  try { await $.tool.call(todos(['completed', 'in_progress'])) } catch { /* the stopped call */ }
  await clock.advance(1000)
  await ui.press({ key: 'toggle' })
  const plan = (await ui.find({ key: 'plan' }))?.text ?? ''
  expect(plan).toContain('計画 1/2')
  expect(plan).toContain('doing 15秒')
  box.todoAnswer = { result: 'ok' }
  await $.tool.call(todos(['completed', 'in_progress']))
  expect((await ui.find({ key: 'plan' }))?.text).toContain('計画 2/2')
})

test('steps are said in plain Japanese: what the model wrote in English is not shown', () => {
  const said = (tool: string, args: Record<string, unknown>) => activityOf(tool, args).replace('道具を使っている: ', '')

  expect(said('Bash', { command: 'git status', description: 'Show working tree status' })).toBe('変更の状況を見る')
  expect(said('Bash', { command: 'git status', description: '変更を確かめる' })).toBe('変更を確かめる')
  expect(said('Read', { file_path: '/a/b/register.tsx' })).toBe('register.tsx を読む')
  expect(said('Edit', { file_path: 'x/app.ts' })).toBe('app.ts を直す')
  expect(said('Grep', { pattern: 'TOOL_PREFIX\\|activityOf' })).toBe('ファイルの中を探す')
  expect(said('Grep', { pattern: 'activityOf' })).toBe('ファイルの中を探す')
  expect(said('Grep', { pattern: 'sk_test_SECRET123' })).toBe('ファイルの中を探す')
  expect(said('Grep', { pattern: '手順' })).toBe('「手順」をファイルの中から探す')
  expect(said('Bash', { command: 'curl x', description: '実行: curl --token secret' })).toBe('ネットから取ってくる')
  expect(said('WebSearch', { query: '調査 https://example.com/?token=secret' })).toBe('ウェブで調べる')
  expect(said('WebFetch', { url: 'https://DEMO_SECRET.example.com/private?token=FAKE' })).toBe('ウェブのページを読む')
  expect(said('Bash', { command: 'curl x', description: '実行: curl secret.example.co.uk' })).toBe('ネットから取ってくる')
  expect(said('Grep', { pattern: '確認 git status' })).toBe('ファイルの中を探す')
  expect(said('WebSearch', { query: '調査 ftp://DEMO_SECRET.example.co.uk' })).toBe('ウェブで調べる')
  expect(said('Bash', { command: 'bash scripts/verify.sh', description: 'verify.sh で試験を走らせる（3/7）' })).toBe('verify.sh で試験を走らせる（3/7）')
  expect(said('Agent', { description: 'Codex の判定を待つ' })).toBe('子エージェントに頼む: Codex の判定を待つ')
  expect(said('Bash', { command: 'x', description: 'deploy.sh 123456 を実行する' })).toBe('コマンドを動かす')
  expect(said('Grep', { pattern: '番号 123456' })).toBe('ファイルの中を探す')
  expect(said('Agent', { description: 'deploy.sh 123456 を実行する' })).toBe('子エージェントに頼む')
  expect(said('WebSearch', { query: 'claude mods desktop' })).toBe('ウェブで調べる')
  expect(said('Agent', { description: 'Review the diff' })).toBe('子エージェントに頼む')
  expect(said('Agent', { description: '差分を見る' })).toBe('子エージェントに頼む: 差分を見る')
  expect(said('Skill', { skill: 'team-design' })).toBe('手順書を使う: team-design')
  expect(said('mcp__Claude_Browser__navigate', {})).toBe('ブラウザを操作する')
  expect(said('mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch', {})).toBe('外部の道具を使う')
  expect(said('SomethingNew', {})).toBe('道具を使う')
})

test('a command is said by what it does, and nothing of the command is shown', () => {
  expect(commandPurpose('cd /repo && git commit -m "x"')).toBe('変更を履歴に保存する')
  expect(commandPurpose('FOO=1 bash scripts/verify.sh')).toBe('試験を走らせる')
  expect(commandPurpose('bash ./scripts/build.sh')).toBe('スクリプトを動かす')
  expect(commandPurpose('scripts/verify.sh')).toBe('試験を走らせる')
  expect(commandPurpose('cd mods && claude plugin test .')).toBe('Claude Code を使う')
  expect(commandPurpose('npm test --silent')).toBe('試験を走らせる')
  expect(commandPurpose('curl -H "Authorization: Bearer abc" https://x.example/y')).toBe('ネットから取ってくる')
  expect(commandPurpose('frobnicate --token=abc')).toBe('コマンドを動かす')
})

test('agents with English descriptions go by their handle or a fixed word', async ($, on) => {
  const { box, clock } = seat(on, [])

  on('agent.spawn', ($, e) => ({ model: 'claude-opus-5-5', agentId: e.tool_use_id === 'tu1' ? 'a1' : 'a2' }))

  const ui = await mount($, box)
  const { turnId } = await $.turn.start({ text: 'launch', turnId: 't1' })

  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu1', description: 'Draft the plan' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2', description: 'Storyboard the video', name: 'boarder' } as never)
  await $.turn.complete({ ...DONE, turnId })
  await $.tool.call({ tool: 'Read', file_path: 'README.md', agentId: 'a1' } as Parameters<Engine['tool']['call']>[0])
  await clock.advance(300)
  await ui.press({ key: 'toggle' })

  const team = (await ui.find({ key: 'agents' }))?.text ?? ''

  expect(team).toContain('子エージェント › README.md を読む')
  expect(team).toContain('boarder › 開始している')
  expect(team).not.toContain('Draft the plan')
  expect(team).not.toContain('Storyboard')
})

test('a Japanese thought is quoted, an English one is not; replies count characters', async ($, on) => {
  const { box } = seat(on, [
    [{ kind: 'thinking', index: 0, text: '設定がおかしい。読み込みを先に見る。' }],
    [{ kind: 'thinking', index: 0, text: '確認: `deploy.sh 12` を見る。' }],
    [{ kind: 'text', index: 0, text: '直しました。読み込みは正常です。' }],
  ])

  await mount($, box)
  await $.turn.start({ text: '確認', turnId: 't1' })
  await step($, 0)
  expect(box.seen.join(' ')).toContain('考えている: 設定がおかしい。 読み込みを先に見る。')
  await step($, 1)
  expect(box.seen.join(' ')).not.toContain('deploy.sh')
  await step($, 2)
  expect(box.seen.join(' ')).toContain('返事を書いている / 16字')
  await $.turn.complete({ ...DONE, turnId: 't1' })
})

test('a thought is counted in characters in the history', async ($, on) => {
  const { box } = seat(on, [
    [{ kind: 'thinking', index: 0, text: '設定を見る。' }],
    [{ kind: 'text', index: 0, text: '済み。' }],
  ])
  const written: { kind: string; label: string }[][] = []

  on('state.set', ($, e, next) => {
    const { key, value } = e as unknown as { key: string; value: unknown }

    if (key === 'history' && Array.isArray(value)) written.push(value as { kind: string; label: string }[])

    return next(e)
  })
  const ui = await mount($, box)

  await $.turn.start({ text: '確認', turnId: 't1' })
  await step($, 0)
  await step($, 1)
  const entries = written.flat()

  expect(entries.find(entry => entry.kind === 'thought')?.label).toBe('考えた (6字)')
  expect(entries.find(entry => entry.kind === 'reply')?.label).toBe('返事を書いた (3字)')
  void ui
})

test('an agent the engine lists under an English sentence goes by a fixed word', async ($, on) => {
  const { box, clock } = seat(on, [])

  on('agent.list', () => ({
    value: [{ id: 'ax-1', description: 'Review https://x.example', name: 'Review https://x.example', type: 'general-purpose', status: 'running' }],
  }))

  await mount($, box)
  await $.tool.call({ tool: 'Read', file_path: 'src/app.ts', agentId: 'ax-1' } as Parameters<Engine['tool']['call']>[0])
  await clock.advance(1000)

  expect(await box.read()).toContain('子エージェント › app.ts を読む')
  expect(await box.read()).not.toContain('x.example')
})
