/**
 * What the box says Claude is doing: `idle` between turns, a model phase
 * (`requesting`, `thinking`, `writing`, `composing`), a tool phase (`tool`,
 * `agent`, `approval`, `question`), or `compacting`.
 */
export type ActivityPhase =
  | 'idle'
  | 'requesting'
  | 'thinking'
  | 'writing'
  | 'composing'
  | 'tool'
  | 'agent'
  | 'approval'
  | 'question'
  | 'compacting'

/** The box's headline: the phase, its words, and when it began. */
export type ActivityNow = {
  phase: ActivityPhase
  label: string
  sinceMs: number
}

/**
 * A subagent at work: what it was asked to do, its latest action, and when
 * it started.
 */
export type ActivityAgent = {
  name: string
  label: string
  sinceMs: number
}

export type ActivityOutcome = 'ok' | 'error' | 'denied' | 'interrupted'

/**
 * One row of the expanded box: a prompt that started a turn, a stretch of
 * thinking, a reply, a tool call, a compaction, or how a turn ended.
 */
export type ActivityEntry = {
  kind: 'turn' | 'thought' | 'reply' | 'tool' | 'compact' | 'end'
  label: string
  durationMs: number | null
  outcome: ActivityOutcome
}

/** One item of the turn's plan, as TodoWrite last set it. */
export type ActivityPlanItem = {
  label: string
  status: 'pending' | 'in_progress' | 'completed'
  /** When the item went in progress, while it is; null otherwise. */
  startMs: number | null
  /** How long it took, once completed; null otherwise. */
  durationMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'seamless-band': {
      now: ActivityNow
      history: readonly ActivityEntry[]
      agents: readonly ActivityAgent[]
      isExpanded: boolean
      goal: string
      plan: readonly ActivityPlanItem[]
    }
  }
}
