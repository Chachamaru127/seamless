import { brandSvg, marks, stateTone, theme, tone } from './appearance'
import { peersOf, talliesOf, latest, peerLabel, companyName, UNKNOWN } from './exchanges'
import type { Peer } from './exchanges'
import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, Timer, TurnCompleteReason, TurnStepChunk } from 'claude-code'

import type {
  ActivityAgent,
  ActivityEntry,
  ActivityNow,
  ActivityOutcome,
  ActivityPlanItem,
} from '../types'
import { activityOf, agentNameOf, partialArgsOf, plainText } from './activity-of'
import { clip, durationOf, oneLine, printable, sizeOf, thoughtOf, charsIn } from './text'

const IDLE: ActivityNow = {
  phase: 'idle',
  label: '待機中',
  sinceMs: 0,
}

const MAX_HISTORY = 100
const MAX_THOUGHT_CHARS = 70
const MAX_THOUGHT_BUFFER = 2000
const MAX_INPUT_HEAD = 4000
const LARGE_INPUT_CHARS = 1024
const MAX_LABEL_CHARS = 120
const MAX_AGENT_NAME_CHARS = 40
const MAX_AGENT_ROWS = 6
const TOOL_PREFIX = '道具を使っている: '
const MAX_GOAL_CHARS = 400
const MAX_MACRO_CHARS = 28
const MAX_PLAN_ROWS = 6
const MAX_STEP_ROWS = 5
const MAX_PLAN_ITEMS = 100
const MAX_GOAL_SHOWN = 100
const STREAM_THROTTLE_MS = 250
const TICK_MS = 1000

const now = atom({ plugin: 'seamless-band', key: 'now' } as const, IDLE)

const history = atom(
  { plugin: 'seamless-band', key: 'history' } as const,
  [] as readonly ActivityEntry[],
)

const team = atom(
  { plugin: 'seamless-band', key: 'agents' } as const,
  [] as readonly ActivityAgent[],
)

const isExpanded = atom(
  { plugin: 'seamless-band', key: 'isExpanded' } as const,
  false,
)

const goal = atom({ plugin: 'seamless-band', key: 'goal' } as const, '')

const plan = atom(
  { plugin: 'seamless-band', key: 'plan' } as const,
  [] as readonly ActivityPlanItem[],
)

/** What the model is doing in the main loop, between and around tool calls. */
type ModelPhase = 'idle' | 'requesting' | 'thinking' | 'writing' | 'composing' | 'compacting'

/** A main-loop tool call in flight. */
type Call = {
  tool: string
  label: string
  purpose: string
  startMs: number
  isAwaitingApproval: boolean
}

/**
 * A subagent at work, from its spawn (or its first call, when the spawn came
 * before a reload) to its stop. `toolUseId` names the Agent call that started
 * it; `activeMs` is when it last did something.
 */
type Agent = {
  name: string
  label: string
  startMs: number
  activeMs: number
  toolUseId: string | null
  isBackground: boolean
}

/**
 * The module's live view of the session, from which the headline is drawn:
 * started over on a reload, while the headline and history in `$.state` stay.
 */
type Live = {
  planStarts: Map<string, number>
  planEnds: Map<string, number>
  planSeen: Map<string, ActivityPlanItem['status']>
  readSinceMs: number | null
  calls: Map<string, Call>
  agents: Map<string, Agent>
  agentNames: Map<string, string>
  described: Map<string, string>
  phase: ModelPhase
  phaseStartMs: number
  turnStartMs: number | null
  turnActions: number
  isFirstRequest: boolean
  resultsToReview: number
  thought: string
  thoughtChars: number
  replyChars: number
  composing: { tool: string; head: string; chars: number } | null
  lastAction: string | null
  lastTurn: string | null
  lastPublishMs: number
  trailing: Timer | null
  isSweeping: boolean
  ticker: Timer | null
}

/**
 * Registers What's Agent Doing: a box above the prompt naming what Claude is
 * doing right now, and, behind its triangle, what it has done.
 *
 * The model's own stream (`turn.step`) says whether it is reading, thinking
 * (the thought's latest sentence), writing the reply or composing a tool's
 * input; `tool.call` says which tool runs, `classic.PermissionRequest` when
 * one waits for approval, and a subagent's calls show under its Agent call.
 *
 * @param on the engine's registrar
 */
export const register: Register = (on, options) => {
  const exchanges: ExchangeLive = { desktop: false, ended: false, peers: [], unknown: true, error: null, busy: false, pending: false, generation: 0, snippets: new Map(), poller: null, node: typeof options.nodePath === 'string' ? options.nodePath : DEFAULT_NODE, repository: typeof options.repositoryPath === 'string' ? options.repositoryPath : '' }
  const live: Live = {
    planStarts: new Map(),
    planEnds: new Map(),
    planSeen: new Map(),
    readSinceMs: null,
    calls: new Map(),
    agents: new Map(),
    agentNames: new Map(),
    described: new Map(),
    phase: 'idle',
    phaseStartMs: 0,
    turnStartMs: null,
    turnActions: 0,
    isFirstRequest: false,
    resultsToReview: 0,
    thought: '',
    thoughtChars: 0,
    replyChars: 0,
    composing: null,
    lastAction: null,
    lastTurn: null,
    lastPublishMs: 0,
    trailing: null,
    isSweeping: false,
    ticker: null,
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    exchanges.ended = false

    live.phaseStartMs = await $.clock.now()
    await publish($, live)
    // The ticker starts on the first Desktop draw, so terminal and claude -p sessions never run it.

    return result
  })

  on('session.receive', async ($, e, next) => {
    try { return await next(e) }
    finally { void refresh($, exchanges) }
  })

  on('session.end', async ($, e, next) => {
    exchanges.ended = true
    exchanges.desktop = false
    exchanges.generation += 1
    exchanges.pending = false
    exchanges.snippets.clear()
    exchanges.peers = []
    exchanges.unknown = true
    exchanges.poller?.cancel()
    exchanges.poller = null
    live.ticker?.cancel()
    live.ticker = null
    live.trailing?.cancel()
    live.trailing = null
    live.calls.clear()
    live.agents.clear()
    live.agentNames.clear()
    live.described.clear()
    live.phase = 'idle'
    live.phaseStartMs = await $.clock.now()
    live.turnStartMs = null
    live.lastTurn = null
    live.lastAction = null
    live.thought = ''
    live.composing = null
    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    exchanges.ended = false
    keepTicking($, live)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (live.turnStartMs !== null) {
      return next(e)
    }

    live.turnStartMs = await $.clock.now()
    live.turnActions = 0
    live.isFirstRequest = true
    live.resultsToReview = 0
    live.lastAction = null
    live.calls.clear()

    const prompt = oneLine(e.text)

    if (prompt !== '') {
      await remember($, { kind: 'turn', label: clip(prompt, 60), durationMs: null, outcome: 'ok' })
    }
    live.readSinceMs = live.turnStartMs
    if (prompt !== '' && !prompt.startsWith('<')) {
      await update($, goal, () => printable(prompt, MAX_GOAL_CHARS))
      // A new request starts a new piece of work: a plan already finished belongs to the last one.
      await update($, plan, items => items.every(item => item.status === 'completed') ? [] : items)
    }

    await enter($, live, 'requesting')

    keepTicking($, live)
    await publish($, live)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    await enter($, live, 'requesting')
    await publish($, live)

    const stream = next(e)
    let done = false
    try {
      for (;;) {
        const step = await stream.next()
        if (step.done) { done = true; return step.value }
        await follow($, live, step.value)
        yield step.value
      }
    } finally {
      if (!done) await stream.return?.(undefined)
      live.isFirstRequest = false
      live.composing = null
      await enter($, live, 'requesting')
      await publish($, live)
    }
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Record<string, unknown>
    if (e.agentId === undefined && e.tool === 'mcp__seamless__send' && typeof args.id === 'string' && typeof args.text === 'string') {
      exchanges.snippets.set(args.id, Array.from(args.text).slice(0, 40).join(''))
    }
    const label = activityOf(e.tool, args)
    // The plan changes only when TodoWrite went through: a refused or failed call leaves it as it was.
    const plannedTodos = e.agentId === undefined && e.tool === 'TodoWrite' && Array.isArray(args.todos) ? args.todos as unknown[] : null
    const purpose = typeof args.description === 'string' ? printable(args.description, MAX_LABEL_CHARS) : ''

    if (e.agentId !== undefined) {
      const agent = await agentOf($, live, e.agentId)

      // Kept after the call: the agent's last action stands while it thinks.
      agent.label = label
      agent.activeMs = await $.clock.now()
      await publish($, live, false)

      try {
        return await next(e)
      } finally {
        agent.label = label
        if (e.tool.startsWith('mcp__seamless__')) void refresh($, exchanges)
        await publish($, live, false)
      }
    }

    const startMs = await $.clock.now()

    live.calls.set(e.tool_use_id, { tool: e.tool, label, purpose, startMs, isAwaitingApproval: false })
    live.lastAction = label
    live.turnActions += 1
    await publish($, live)

    let outcome: ActivityOutcome = 'interrupted'

    try {
      const result = await next(e)

      outcome = result.deny !== undefined ? 'denied' : result.isError ? 'error' : 'ok'

      if (plannedTodos !== null && outcome === 'ok') {
        const items = planOf(live, plannedTodos, await $.clock.now())
        await update($, plan, () => items)
      }

      if (isAgentTool(e.tool)) {
        const args = e as unknown as Record<string, unknown>
        const handle = args['name']
        const description = args['description']

        // A named agent runs as a teammate, which the engine lists by the
        // call's `name`; the call's `description` is what to show for it.
        if (typeof handle === 'string' && plainText(description) !== '') {
          live.described.set(handle, plainText(description))
          void sweep($, live)
        }

        await launched($, live, result.result, description)
      }

      return result
    } finally {
      if (e.tool.startsWith('mcp__seamless__')) void refresh($, exchanges)
      live.calls.delete(e.tool_use_id)
      live.resultsToReview += 1

      await remember($, {
        kind: 'tool',
        label,
        durationMs: (await $.clock.now()) - startMs,
        outcome,
      })

      await publish($, live)
    }
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id !== undefined) {
      const agent = await agentOf($, live, e.agent_id)

      agent.label = `承認待ち: ${agent.label}`
    } else {
      const waiting = [...live.calls.values()]
        .reverse()
        .find(call => call.tool === e.tool_name && !call.isAwaitingApproval)

      if (waiting) {
        waiting.isAwaitingApproval = true
      }
    }

    await publish($, live)

    return next(e)
  })

  // The run-in-background pill shows only under a call that is running, so
  // its drawing means the person has answered the approval it waited on.
  on('ui.render', { component: 'ToolProgress' }, ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const call = live.calls.get(e.props.tool_use_id)

    if (call?.isAwaitingApproval) {
      call.isAwaitingApproval = false
      $.clock.after(0, () => void publish($, live))
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.agentId !== undefined) {
      const startMs = await $.clock.now()
      const name = agentNameOf(e.description, e.name)

      live.agentNames.set(result.agentId, name)
      live.agents.set(result.agentId, {
        name,
        label: '開始している',
        startMs,
        activeMs: startMs,
        toolUseId: e.tool_use_id,
        isBackground: e.background,
      })
      keepTicking($, live)
      await publish($, live)
    }

    return result
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await finish($, live, e.agent_id, 'ok')

    return next(e)
  })

  on('classic.PreCompact', async ($, e, next) => {
    await enter($, live, 'compacting')
    await publish($, live)

    return next(e)
  })

  on('classic.PostCompact', async ($, e, next) => {
    const durationMs = (await $.clock.now()) - live.phaseStartMs

    live.phase = live.turnStartMs === null ? 'idle' : 'requesting'
    await remember($, { kind: 'compact', label: '会話を整理した', durationMs, outcome: 'ok' })
    await publish($, live)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await finish($, live, e.agentId, outcomeOf(e.reason))

      return next(e)
    }

    if (live.turnStartMs === null) {
      return next(e)
    }

    const durationMs = (await $.clock.now()) - live.turnStartMs
    const took = durationOf(durationMs)

    const [label, outcome]: [string, ActivityOutcome] =
      e.reason === 'aborted'
        ? [`${took}で中断`, 'interrupted']
        : e.reason === 'error'
          ? [`${took}でエラー停止`, 'error']
          : e.reason === 'refusal'
            ? ['依頼を拒否', 'denied']
            : [`${took}で完了、${live.turnActions}手順`, 'ok']

    await enter($, live, 'idle')
    await remember($, { kind: 'end', label: capitalized(label), durationMs, outcome })

    live.lastTurn = label
    live.turnStartMs = null
    live.calls.clear()

    keepTicking($, live)
    await publish($, live)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    if (!exchanges.desktop && !exchanges.ended) {
      exchanges.desktop = true
      desktopDrawn = true
      keepTicking($, live)
      keepPolling($, exchanges)
      void refresh($, exchanges)
    }
    if (e.props.hasSurvey) {
      return next(e)
    }

    // The band is one site for every plugin: what the plugins beneath draw
    // stays, under the box, so another mod's band is never hidden.
    const below = await next(e)

    const { Box, Text, Button, Svg } = $.ui.resolve(e)

    const headline = await read($, now)
    const entries = await read($, history)
    const working = await read($, team)
    const isOpen = await read($, isExpanded)
    const purpose = await read($, goal)
    const steps = await read($, plan)
    const nowMs = await $.clock.now()

    const elapsed = durationOf(nowMs - headline.sinceMs)
    // An Svg needs words of its own (an empty alt is not drawn), which also name the mark for a screen reader.
    const mark = (key: string, source: string) => <Svg key={key} alt={MARK_WORDS.get(source) ?? '印'} width={14} height={14} source={source} />

    // One line, three grains: the turn's purpose (bold, it holds still), the
    // plan's step with n/m, and the action of the moment (thin, it changes).
    const line = lineOf(headline, entries, steps, purpose, live.lastTurn)
    const isAsking = line.mark === 'attn' && headline.phase !== 'idle'
    const showsElapsed = headline.phase !== 'idle'

    // Right side, per company: ↑ sent and ↓ received, in parentheses those not
    // yet confirmed (not reached or not read; received after the last turn
    // began), and ! when something went wrong. Details are behind the triangle.
    const tallies = talliesOf(exchanges.peers, live.readSinceMs)
    const hasTrouble = exchanges.error !== null || tallies.some(t => t.problems.length > 0)
    const count = (key: string, arrow: string, total: number, open: number) => total === 0 ? [] : [
      <Text key={key} color={theme.meso}>{`${arrow}${total}`}</Text>,
      ...(open > 0 ? [<Text key={`${key}-open`} color={theme.subtle}>{`(${open})`}</Text>] : []),
    ]
    const right = [
      ...tallies.map(t => <Box key={`company-${t.provider}`} flexDirection="row" alignItems="center" columnGap={0.5}>
        <Svg key={`badge-logo-${t.provider}`} alt={companyName(t.provider)} width={14} height={14} source={brandSvg(t.provider)} />
        {count(`up-${t.provider}`, '↑', t.up, t.upPending)}
        {count(`down-${t.provider}`, '↓', t.down, t.downUnread)}
      </Box>),
      ...(hasTrouble ? [<Text key="trouble" color={theme.error} bold>!</Text>] : []),
    ]

    const section = (key: string, label: string, rows: JSX.Element[]) => rows.length === 0 ? null : (
      <Box key={key} flexDirection="row" alignItems="flex-start" columnGap={1.5} marginTop={0.5}>
        <Box key={`${key}-k`} width={8} flexShrink={0}><Text color={theme.subtle} wrap="truncate-end">{label}</Text></Box>
        <Box key={`${key}-v`} flexDirection="column" flexGrow={1} flexShrink={1}>{rows}</Box>
      </Box>
    )
    const item = (key: string, icon: string, text: string, tail: string, tone: { color: string; bold?: boolean }) => (
      <Box key={key} flexDirection="row" alignItems="center" columnGap={1}>
        {mark(`${key}-mark`, icon)}
        <Box key={`${key}-text`} flexGrow={1} flexShrink={1}><Text color={tone.color} bold={tone.bold === true} wrap="truncate-end">{text}</Text></Box>
        <Text key={`${key}-tail`} color={theme.subtle}>{tail}</Text>
      </Box>
    )

    // Six rows at most, always holding the step in progress (or the next one).
    const inProgress = steps.findIndex(step => step.status === 'in_progress')
    const focus = inProgress >= 0 ? inProgress : Math.max(0, steps.findIndex(step => step.status !== 'completed'))
    const first = Math.max(0, Math.min(focus - 2, steps.length - MAX_PLAN_ROWS))
    const shownSteps = steps.slice(first, first + MAX_PLAN_ROWS)
    const planRows = [
      ...(first > 0 ? [<Text key="plan-before" color={theme.subtle}>{steps.slice(0, first).every(step => step.status === 'completed') ? `済み ${first}件` : `前に ${first}件`}</Text>] : []),
      ...shownSteps.map((step, i) => step.status === 'completed'
        ? item(`plan-${first + i}`, marks.tick, step.label, step.durationMs === null ? '' : tookOf(step.durationMs), { color: theme.subtle })
        : step.status === 'in_progress'
          ? item(`plan-${first + i}`, marks.live, step.label, step.startMs === null ? '' : durationOf(nowMs - step.startMs), { color: theme.text, bold: true })
          : item(`plan-${first + i}`, marks.pending, step.label, '', { color: theme.subtle })),
      ...(steps.length > first + shownSteps.length ? [<Text key="plan-more" color={theme.subtle}>{`ほか ${steps.length - first - shownSteps.length}件`}</Text>] : []),
    ]

    const recent = entries.filter(entry => entry.kind === 'tool' || entry.kind === 'compact').slice(-MAX_STEP_ROWS)
    const stepRows = steps.length > 0 ? [] : recent.map((entry, i) => item(
      `step-${i}`,
      STEP_MARKS[entry.outcome],
      printable(entry.label.split(TOOL_PREFIX).join(''), MAX_LABEL_CHARS),
      tookOf(entry.durationMs),
      { color: entry.outcome === 'error' ? theme.error : theme.meso },
    ))

    // One agent the line already names; more, or one beside the main loop's work, get a row each.
    const isTeamListed = working.length > 1 || (working.length === 1 && headline.phase !== 'agent')
    const agentRows: JSX.Element[] = (isTeamListed ? working : []).slice(-MAX_AGENT_ROWS).map((agent, i) => item(
      `agent-${i}`, marks.live,
      `${printable(agent.name, MAX_AGENT_NAME_CHARS)} › ${printable(agent.label.split(TOOL_PREFIX).join(''), MAX_LABEL_CHARS)}`,
      durationOf(nowMs - agent.sinceMs), { color: theme.meso },
    ))

    if (isTeamListed && working.length > MAX_AGENT_ROWS) {
      agentRows.push(<Text key="agents-more" color={theme.subtle}>{`ほか ${working.length - MAX_AGENT_ROWS}個`}</Text>)
    }

    const peerRows = exchanges.peers.map((peer, i) => {
      const last = latest(peer.exchanges)
      const state = exchanges.unknown ? UNKNOWN : last
      const { key } = stateTone(state.color)
      const snippet = last.direction === 'outbound' ? exchanges.snippets.get(last.id) : undefined
      return <Box key={`peer-${i}`} flexDirection="row" alignItems="center" columnGap={1}>
        <Svg key={`peer-logo-${i}`} alt={companyName(peer.provider)} width={14} height={14} source={brandSvg(peer.provider)} />
        <Box key={`peer-text-${i}`} flexGrow={1} flexShrink={1}><Text color={theme.text} wrap="truncate-end">{printable(`${peerLabel(peer)}${snippet === undefined ? '' : `「${snippet}…」`}`, 240)}</Text></Box>
        <Box key={`peer-state-box-${i}`} flexShrink={0}><Text key={`peer-state-${i}`} color={key} wrap="truncate-end">{state.label}</Text></Box>
      </Box>
    })

    const problemRows = [
      ...exchanges.peers.flatMap((peer, i) => peer.exchanges.filter(x => x.direction === 'outbound' && tallies.some(t => t.problems.includes(x))).map((x, j) =>
        <Text key={`problem-${i}-${j}`} color={theme.error} wrap="truncate-end">{`${peerLabel(peer)} への依頼${x.at === null ? '' : `（${clockOf(x.at)}）`}が届かなかった。相手が受け付けなかった`}</Text>)),
      ...(exchanges.error === null ? [] : [<Text key="problem-query" color={theme.error} wrap="truncate-end">{`やりとりの状態を確かめられなかった（${exchanges.error}）。60秒ごとにやり直す`}</Text>]),
    ]
    const position = planPosition(steps)
    const body = isOpen
      ? <Box key="details" flexDirection="column" marginLeft={4} marginTop={0.5}>
          {section('problems', '問題', problemRows)}
          {purpose === '' ? null : section('goal', '目的', [<Text key="goal-text" color={theme.text} wrap="wrap">{clip(purpose, MAX_GOAL_SHOWN)}</Text>])}
          {section('plan', `計画 ${position}`, planRows)}
          {section('steps', '手順', stepRows)}
          {section('agents', '子エージェント', agentRows)}
          {section('exchanges', 'やりとり', peerRows)}
        </Box>
      : null

    return (
      <Box flexDirection="column">
        <Box key="band" flexDirection="column" width="100%">
          <Box key="activity" flexDirection="row" alignItems="center" columnGap={1}>
            <Button key="toggle" label={isOpen ? '▾' : '▸'} onPress={() => update($, isExpanded, open => !open)} />
            {mark('state-mark', marks[line.mark])}
            <Box key="line" flexGrow={1} flexShrink={1} flexDirection="row">
              <Text key="headline" bold color={theme.text} wrap="truncate-end">{line.lead}</Text>
              {line.meso === '' ? null : <Text key="meso" color={theme.meso} wrap="truncate-end">{`  ›  ${line.meso}`}</Text>}
              {line.micro === '' ? null : <Text key="micro" color={theme.meso} wrap="truncate-end">{`  ${line.joiner}  ${line.micro}`}</Text>}
            </Box>
            {showsElapsed ? <Text key="elapsed" color={isAsking ? theme.warning : theme.subtle}>{elapsed}</Text> : null}
            <Box key="companies" flexDirection="row" flexShrink={0} columnGap={1.5} marginLeft={1}>{right}</Box>
          </Box>
          {body}
        </Box>
        {below}
      </Box>
    )
  })
}

type LineMark = 'live' | 'idle' | 'ok' | 'attn' | 'fail' | 'stopped'

/**
 * The closed band's one line: what to lead with (bold), the plan's step,
 * the action of the moment, and the mark before them.
 */
function lineOf(headline: ActivityNow, entries: readonly ActivityEntry[], steps: readonly ActivityPlanItem[], purpose: string, lastTurn: string | null): { mark: LineMark; lead: string; meso: string; micro: string; joiner: string } {
  const macro = macroOf(purpose)
  const active = steps.find(step => step.status === 'in_progress')
  const meso = active ? `${active.label} ${planPosition(steps)}` : ''
  const action = printable(headline.label.split(TOOL_PREFIX).join(''), MAX_LABEL_CHARS)

  if (headline.phase === 'approval') {
    return { mark: 'attn', lead: '承認を待っています', meso: '', micro: action.replace(/^承認待ち: /, ''), joiner: '›' }
  }
  if (headline.phase === 'question') {
    return { mark: 'attn', lead: '回答を待っています', meso: '', micro: action, joiner: '›' }
  }
  if (headline.phase === 'idle') {
    const end = [...entries].reverse().find(entry => entry.kind === 'end')
    const summary = lastTurn ?? end?.label ?? ''
    if (end === undefined || summary === '') return { mark: 'idle', lead: macro || '待機中', meso: '', micro: '', joiner: '·' }
    const mark: LineMark = end.outcome === 'ok' ? 'ok' : end.outcome === 'interrupted' ? 'stopped' : end.outcome === 'denied' ? 'attn' : 'fail'
    return { mark, lead: macro || '前回の作業', meso: '', micro: summary, joiner: '·' }
  }
  return macro === ''
    ? { mark: 'live', lead: action, meso, micro: '', joiner: '›' }
    : { mark: 'live', lead: macro, meso, micro: action, joiner: '›' }
}

/**
 * Where the plan stands, the same on the line and behind the triangle: the
 * step in progress counted from the first (3/7), or the steps done (7/7).
 */
function planPosition(steps: readonly ActivityPlanItem[]): string {
  const index = steps.findIndex(step => step.status === 'in_progress')
  const done = steps.filter(step => step.status === 'completed').length
  return index >= 0 ? `${index + 1}/${steps.length}` : `${done}/${steps.length}`
}

/** The local time of day, as `14:05`. */
function clockOf(ms: number): string {
  const at = new Date(ms)
  return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** How long a step took, left out under a second, where it says nothing. */
function tookOf(ms: number | null): string {
  return ms === null || ms < 1000 ? '' : durationOf(ms)
}

const MARK_WORDS = new Map<string, string>([
  [marks.live, '作業中'], [marks.idle, '待機中'], [marks.ok, '完了'], [marks.attn, '要対応'], [marks.fail, 'エラー'],
  [marks.stopped, '中断'], [marks.tick, '済み'], [marks.cross, '失敗'], [marks.denied, '拒否'], [marks.halt, '中断'], [marks.pending, '未着手'],
])

const STEP_MARKS: Record<ActivityOutcome, string> = { ok: marks.tick, error: marks.cross, denied: marks.denied, interrupted: marks.halt }

/** The purpose as the line leads with it: its first sentence, short. */
function macroOf(purpose: string): string {
  const first = purpose.split(/[。！？!?\n]|\.\s/).find(part => part.trim() !== '') ?? ''
  return clip(first.trim(), MAX_MACRO_CHARS)
}

/** The headline as the live view has it. */
function current(live: Live): ActivityNow {
  if (live.phase === 'compacting') {
    return { phase: 'compacting', label: '会話を整理している', sinceMs: live.phaseStartMs }
  }

  const open = [...live.calls.entries()]
  const [newestId, newest] = open.at(-1) ?? []

  if (newestId !== undefined && newest !== undefined) {
    const more = open.length > 1 ? ` (+ほか${open.length - 1}件)` : ''

    if (newest.isAwaitingApproval) {
      return {
        phase: 'approval',
        label: `承認待ち: ${newest.label}${more}`,
        sinceMs: newest.startMs,
      }
    }

    if (newest.tool === 'AskUserQuestion') {
      return { phase: 'question', label: newest.label, sinceMs: newest.startMs }
    }

    const inner = isAgentTool(newest.tool) ? agentUnder(live, newestId)?.label : undefined

    return inner === undefined
      ? { phase: 'tool', label: `${newest.label}${more}`, sinceMs: newest.startMs }
      : { phase: 'agent', label: `${newest.label} › ${inner}${more}`, sinceMs: newest.startMs }
  }

  if (live.phase === 'idle' && live.agents.size > 0) {
    // Between turns, background agents may still be at work.
    const working = [...live.agents.values()]
    const sinceMs = Math.min(...working.map(agent => agent.startMs))
    const busiest = working.reduce((a, b) => (b.activeMs > a.activeMs ? b : a))

    return {
      phase: 'agent',
      label: working.length === 1
        ? `${busiest.name} › ${busiest.label}`
        : `${working.length}個の子エージェントが作業中`,
      sinceMs,
    }
  }

  const sinceMs = live.phaseStartMs

  switch (live.phase) {
    case 'requesting':
      return {
        phase: 'requesting',
        label: live.isFirstRequest
          ? '指示を読んでいる'
          : live.resultsToReview > 0
            ? `${live.resultsToReview}手順の結果を確認している`
            : '応答を待っている',
        sinceMs,
      }
    case 'thinking': {
      // With no thought text to quote, the last action stands, the dot
      // turned to thinking's color; before any, the prompt is what it reads.
      // The thought is quoted only when it is Japanese; English stays unsaid.
      const snippet = thoughtOf(live.thought, MAX_THOUGHT_CHARS)
      const label = snippet === '' ? standingLabel(live) : plainText(snippet) !== '' ? `考えている: ${snippet}` : '考えている'

      return { phase: 'thinking', label, sinceMs }
    }
    case 'writing':
      return {
        phase: 'writing',
        label: `返事を書いている / ${live.replyChars}字`,
        sinceMs,
      }
    case 'composing': {
      // A call is named once its input says what it does: a file tool by
      // its path, a command by its description, which streams after the
      // command itself. Until then the last action stands.
      const { composing } = live
      const args = composing ? partialArgsOf(composing.head) : {}
      const isDescribed = composing !== null && (isShellTool(composing.tool)
        ? typeof args['description'] === 'string'
        : Object.keys(args).length > 0)

      if (!composing || !isDescribed) {
        return { phase: 'composing', label: standingLabel(live), sinceMs }
      }

      const size = composing.chars >= LARGE_INPUT_CHARS ? ` / ${sizeOf(composing.chars)}` : ''

      return { phase: 'composing', label: `${activityOf(composing.tool, args)}${size}`, sinceMs }
    }
    case 'idle':
      return live.lastTurn === null
        ? { ...IDLE, sinceMs }
        : { ...IDLE, sinceMs, label: `待機中 / 前回 ${live.lastTurn}` }
  }
}

/**
 * Writes the headline. A streaming update (`isUrgent` false) lands at most
 * every STREAM_THROTTLE_MS, the last one held on a timer.
 */
async function publish($: EngineInterface, live: Live, isUrgent = true): Promise<void> {
  const nowMs = await $.clock.now()

  if (!isUrgent && nowMs - live.lastPublishMs < STREAM_THROTTLE_MS) {
    live.trailing ??= $.clock.after(STREAM_THROTTLE_MS, () => {
      live.trailing = null
      void publish($, live)
    })

    return
  }

  live.lastPublishMs = nowMs
  const headline = current(live)
  const working = [...live.agents.values()].map(agent => ({
    name: agent.name,
    label: agent.label,
    sinceMs: agent.startMs,
  }))

  await update($, now, () => headline)
  await update($, team, () => working)
}

/** The agent at work under `agentId`, taken up if its spawn came before a reload. */
async function agentOf($: EngineInterface, live: Live, agentId: string): Promise<Agent> {
  const known = live.agents.get(agentId)

  if (known) {
    return known
  }

  const startMs = await $.clock.now()
  const agent: Agent = {
    name: live.agentNames.get(agentId) ?? '子エージェント',
    label: '開始している',
    startMs,
    activeMs: startMs,
    toolUseId: null,
    isBackground: true,
  }

  live.agents.set(agentId, agent)
  keepTicking($, live)

  return agent
}

/**
 * Lets an agent go. A background agent's run is recorded in the history; a
 * foreground one's is its Agent call's row.
 */
async function finish(
  $: EngineInterface,
  live: Live,
  agentId: string,
  outcome: ActivityOutcome,
): Promise<void> {
  const agent = live.agents.get(agentId)

  if (!agent) {
    return
  }

  live.agents.delete(agentId)

  if (agent.isBackground) {
    await remember($, {
      kind: 'tool',
      label: `子エージェント: ${agent.name}`,
      durationMs: (await $.clock.now()) - agent.startMs,
      outcome,
    })
  }

  keepTicking($, live)
  await publish($, live)
}

/**
 * Names agents first met by their calls, and lets go of agents the engine
 * lists as no longer running, in case their stop never reached the box.
 */
async function sweep($: EngineInterface, live: Live): Promise<void> {
  if (live.agents.size === 0 || live.isSweeping) {
    return
  }

  live.isSweeping = true

  try {
    await sweepListed($, live, await $.agent.list())
  } catch {
    // The list is a backstop; the box keeps going without it.
  } finally {
    live.isSweeping = false
  }
}

async function sweepListed($: EngineInterface, live: Live, listed: readonly AgentInfo[]): Promise<void> {
  const statuses = new Map(listed.map(info => [info.id, info.status]))
  let isRenamed = false

  for (const [agentId, agent] of [...live.agents.entries()]) {
    const status = statuses.get(agentId)

    // An agent first met by its calls is named once the engine lists it.
    if (!live.agentNames.has(agentId)) {
      const handle = listed.find(info => info.id === agentId)?.name
      const described = handle === undefined ? undefined : live.described.get(handle)

      if (described !== undefined) {
        live.agentNames.set(agentId, described)
      }

      const name = described ?? handle

      if (name !== undefined && name !== agent.name) {
        agent.name = name
        isRenamed = true
      }
    }

    if (status !== undefined && status !== 'running') {
      await finish($, live, agentId, status === 'completed' ? 'ok' : status === 'failed' ? 'error' : 'interrupted')
    }
  }

  if (isRenamed) {
    await publish($, live)
  }
}

/**
 * Keeps the elapsed time ticking, including while idle. Session end stops it.
 */
let desktopDrawn = false

function keepTicking($: EngineInterface, live: Live): void {
  if (!desktopDrawn) return
  if (live.ticker === null) {
    live.ticker = $.clock.every(TICK_MS, () => {
      $.ui.invalidate('ui.render')
      void sweep($, live)
    })
  }
}

async function remember($: EngineInterface, entry: ActivityEntry): Promise<void> {
  await update($, history, entries => [...entries, entry].slice(-MAX_HISTORY))
}

/** Enters a model phase, recording the thinking or reply block it closes. */
async function enter($: EngineInterface, live: Live, next: ModelPhase): Promise<void> {
  if (next === live.phase) {
    return
  }

  const nowMs = await $.clock.now()
  const durationMs = nowMs - live.phaseStartMs

  if (live.phase === 'thinking') {
    const chars = live.thoughtChars

    await remember($, {
      kind: 'thought',
      label: chars > 0 ? `考えた (${chars}字)` : '考えた',
      durationMs,
      outcome: 'ok',
    })
  }

  if (live.phase === 'writing' && live.replyChars > 0) {
    await remember($, {
      kind: 'reply',
      label: `返事を書いた (${live.replyChars}字)`,
      durationMs,
      outcome: 'ok',
    })
  }

  if (next === 'thinking') {
    live.thought = ''
    live.thoughtChars = 0
  }

  if (next === 'writing') {
    live.replyChars = 0
  }

  live.phase = next
  live.phaseStartMs = nowMs
}

/** Follows one chunk of the main loop's response. */
async function follow($: EngineInterface, live: Live, chunk: TurnStepChunk): Promise<void> {
  switch (chunk.kind) {
    case 'thinking': {
      const isNew = live.phase !== 'thinking'

      await enter($, live, 'thinking')
      live.resultsToReview = 0
      live.thought = (live.thought + chunk.text).slice(-MAX_THOUGHT_BUFFER)
      live.thoughtChars += charsIn(chunk.text)
      await publish($, live, isNew)

      return
    }
    case 'text': {
      const isNew = live.phase !== 'writing'

      await enter($, live, 'writing')
      live.resultsToReview = 0
      live.replyChars += charsIn(chunk.text)
      await publish($, live, isNew)

      return
    }
    case 'tool':
      await enter($, live, 'composing')
      live.resultsToReview = 0
      live.composing = { tool: chunk.name, head: '', chars: 0 }
      await publish($, live)

      return
    case 'input': {
      const { composing } = live

      if (composing) {
        composing.chars += chunk.json.length

        if (composing.head.length < MAX_INPUT_HEAD) {
          composing.head += chunk.json
        }

        await publish($, live, false)
      }

      return
    }
  }
}

/**
 * What the box keeps saying while Claude thinks or writes a call it cannot
 * name yet: the turn's last action, or the prompt before there is one.
 */
function standingLabel(live: Live): string {
  return live.lastAction ?? '指示を読んでいる'
}

/**
 * Names a background agent by the Agent call that launched it: the call's
 * short `description`, keyed by the id its result carries (the result's own
 * `description` can hold the whole prompt). Its own calls may already have
 * shown it.
 */
async function launched(
  $: EngineInterface,
  live: Live,
  result: unknown,
  asked: unknown,
): Promise<void> {
  if (typeof result !== 'object' || result === null) {
    return
  }

  const { agentId, description, status } = result as Record<string, unknown>

  if (typeof agentId !== 'string' || status !== 'async_launched') {
    return
  }

  // The launching call's description, or the result's; either only as plain Japanese.
  const name = plainText(asked) || plainText(description) || '子エージェント'

  const agent = await agentOf($, live, agentId)

  live.agentNames.set(agentId, name)
  agent.name = name
  await publish($, live)
}

/** The agent an Agent call started, or the one that last did something. */
function agentUnder(live: Live, toolUseId: string): Agent | undefined {
  const working = [...live.agents.values()]

  return working.find(agent => agent.toolUseId === toolUseId)
    ?? working.reduce<Agent | undefined>((a, b) => (a === undefined || b.activeMs > a.activeMs ? b : a), undefined)
}

function outcomeOf(reason: TurnCompleteReason): ActivityOutcome {
  return reason === 'aborted' ? 'interrupted' : reason === 'error' ? 'error' : reason === 'refusal' ? 'denied' : 'ok'
}

function isShellTool(tool: string): boolean {
  return tool === 'Bash' || tool === 'PowerShell'
}

function isAgentTool(tool: string): boolean {
  return tool === 'Agent' || tool === 'Task'
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
const DEFAULT_NODE = '/Users/tachibanashuuta/.local/share/mise/installs/node/24/bin/node'
const DEFAULT_REPOSITORY = '/Users/tachibanashuuta/LocalWork/Code/seamless'
type ExchangeLive = {
  desktop: boolean
  ended: boolean
  peers: Peer[]
  unknown: boolean
  error: string | null
  busy: boolean
  pending: boolean
  generation: number
  snippets: Map<string, string>
  poller: Timer | null
  node: string
  repository: string
}

function keepPolling($: EngineInterface, state: ExchangeLive): void {
  state.poller ??= $.clock.every(60_000, () => { void refresh($, state) })
}

async function refresh($: EngineInterface, state: ExchangeLive): Promise<void> {
  if (!state.desktop) return
  if (state.busy) { state.pending = true; return }
  state.pending = false
  state.busy = true
  const generation = state.generation
  try {
    const root = state.repository || DEFAULT_REPOSITORY
    const result = await $.process.run([state.node, `${root}/src/cli.ts`, 'band'], { timeoutMs: 20_000 })
    if (generation !== state.generation) return
    if (result.exitCode !== 0) throw new Error(`終了コード ${result.exitCode}${result.stderr.trim() === '' ? '' : `: ${result.stderr.trim().split('\n')[0]}`}`)
    state.peers = peersOf(result.stdout)
    state.unknown = false
    state.error = null
  } catch (error) {
    if (generation === state.generation) {
      state.unknown = true
      state.error = printable(error instanceof Error ? error.message : String(error), MAX_LABEL_CHARS)
    }
  } finally {
    state.busy = false
    $.ui.invalidate('ui.render')
    if (state.pending) void refresh($, state)
  }
}

/**
 * The plan TodoWrite set, each item with how long it took: an item's clock
 * starts when it is first seen in progress and stops when it is completed.
 */
function planOf(live: Live, todos: readonly unknown[], nowMs: number): readonly ActivityPlanItem[] {
  const seen = new Map<string, ActivityPlanItem['status']>()
  const items = todos.slice(0, MAX_PLAN_ITEMS).flatMap(todo => {
    if (!todo || typeof todo !== 'object') return []
    const { content, activeForm, status } = todo as Record<string, unknown>
    if (typeof content !== 'string' || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) return []
    const key = content
    const before = live.planSeen.get(key)
    seen.set(key, status)
    // The clock starts each time the step goes into progress, from any other
    // state or from outside the list, and stops once when it is completed.
    if (status === 'in_progress' && before !== 'in_progress') {
      live.planStarts.set(key, nowMs)
      live.planEnds.delete(key)
    }
    if (status === 'completed' && before === 'in_progress') live.planEnds.set(key, nowMs)
    if (status === 'pending') {
      live.planStarts.delete(key)
      live.planEnds.delete(key)
    }
    const startMs = live.planStarts.get(key)
    const endMs = live.planEnds.get(key)
    const label = printable(status === 'in_progress' && typeof activeForm === 'string' ? activeForm : content, MAX_LABEL_CHARS)
    return [{
      label,
      status,
      startMs: status === 'in_progress' ? startMs ?? nowMs : null,
      durationMs: status === 'completed' && startMs !== undefined && endMs !== undefined ? endMs - startMs : null,
    }]
  })
  for (const key of live.planStarts.keys()) if (!seen.has(key)) { live.planStarts.delete(key); live.planEnds.delete(key) }
  live.planSeen = seen
  return items
}
