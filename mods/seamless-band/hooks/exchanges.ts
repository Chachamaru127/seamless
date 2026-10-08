import { palette } from './appearance'
import { durationOf, printable } from './text'

export type Exchange = {
  id: string
  direction: 'outbound' | 'inbound'
  at: number | null
  color: string
  label: string
  /** When the request was seen to reach the peer, to be taken up, and answered; null while not seen. */
  times: { reached: number | null; processing: number | null; replied: number | null }
  rejected: boolean
  /** Grok CLI only: the envelope waits in the inbox (pending) or its handing over is unknown; idle when the peer has not moved for 5 minutes. */
  inbox?: 'pending' | 'unknown' | 'orphaned'
  idle?: boolean
}
export type Peer = {
  provider: 'claude' | 'codex' | 'grok'
  nativeId: string
  generation: string
  cwd: string
  /** Whether the peer's conversation is running, as the query saw it; null when it did not say. */
  online: boolean | null
  exchanges: Exchange[]
}
export const UNKNOWN = { color: palette.muted, label: '未確認' }
export const GROK_WAITING = '受理・未配信'
export const GROK_IDLE = '相手は 5 分以上動いていない。次の 1 手の後に届く'
export const GROK_UNKNOWN = '成否不明。立花さんの確認が要る'
export const GROK_ORPHANED = '宛先の会話は台帳から消えている。このままでは届かない'
export const companyName = (provider: Peer['provider']) => provider === 'claude' ? 'Claude' : provider === 'grok' ? 'Grok' : 'Codex'
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid object')
  return v as Record<string, unknown>
}
const string = (v: unknown): string => {
  if (typeof v !== 'string') throw new Error('Invalid string')
  return v
}
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error('Invalid array')
  return v
}
const timestamp = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const ms = Date.parse(string(v))
  return Number.isFinite(ms) ? ms : null
}

function outbound(value: unknown, now?: number): Exchange {
  const r = object(value)
  const seenAt = new Map<string, number | null>()
  for (const value of array(r.stages ?? [])) {
    const s = object(value)
    string(s.stage); string(s.status)
    if (s.status === 'observed') seenAt.set(s.stage as string, timestamp(s.at))
  }
  const observed = new Set(seenAt.keys())
  const when = (stage: string) => seenAt.get(stage) ?? null
  let state = UNKNOWN
  if (observed.has('processing') || observed.has('replied')) state = { color: palette.green, label: observed.has('replied') ? '既読 · 返信あり' : '既読' }
  else if (observed.has('reached')) state = { color: palette.orange, label: '届いた · 未読' }
  else if (r.delivery === 'rejected') state = { color: palette.red, label: '届かなかった' }
  // A Grok CLI envelope is handed over only at the end of the peer's next turn: until then it waits, and is not said to be on its way.
  const inbox = r.inbox === 'pending' || r.inbox === 'delivering' ? 'pending' as const : r.inbox === 'handed' || r.inbox === 'unknown' ? 'unknown' as const : r.inbox === 'orphaned' ? 'orphaned' as const : undefined
  const activeAt = timestamp(r.peerActiveAt)
  const idle = inbox === 'pending' && now !== undefined && activeAt !== null && now - activeAt >= 5 * 60_000
  if (!observed.has('reached') && !observed.has('processing') && !observed.has('replied') && r.delivery !== 'rejected') {
    if (inbox === 'unknown') state = { color: palette.orange, label: GROK_UNKNOWN }
    else if (inbox === 'orphaned') state = { color: palette.orange, label: GROK_ORPHANED }
    else if (inbox === 'pending') state = { color: palette.muted, label: idle ? `${GROK_WAITING} · ${GROK_IDLE}` : GROK_WAITING }
  }
  return { id: string(r.id), direction: 'outbound', at: timestamp(r.at), ...state,
    times: { reached: when('reached'), processing: when('processing'), replied: when('replied') }, rejected: state.color === palette.red,
    ...(inbox ? { inbox } : {}), ...(idle ? { idle } : {}) }
}

/** Whether a peer runs: online, or a status that says it does not; unknown and missing say nothing. */
const onlineOf = (status: unknown): boolean | null =>
  status === 'online' ? true : typeof status === 'string' && status !== 'unknown' ? false : null

/** Parse only status metadata; do not retain the response's tickets or other fields. */
export function peersOf(json: string, now?: number): Peer[] {
  const data = object(JSON.parse(json))
  if (data.status !== 'ok') throw new Error('Query failed')
  const peers: Peer[] = []
  const candidates = array(data.candidates).map(object)
  for (const c of candidates) {
    if (c.provider !== 'claude' && c.provider !== 'codex' && c.provider !== 'grok') continue
    peers.push({ provider: c.provider, nativeId: string(c.nativeId), generation: string(c.generation), cwd: string(c.cwd),
      online: onlineOf(c.status), exchanges: array(c.requests).map(r => outbound(r, now)) })
  }
  for (const value of array(data.inbound)) {
    const r = object(value), from = object(r.from)
    const id = string(from.id), nativeId = string(from.nativeId)
    const provider = id.startsWith('claude:') ? 'claude' : id.startsWith('codex:') ? 'codex' : id.startsWith('grok:') ? 'grok' : null
    if (!provider) continue
    const matching = candidates.find(c => c.id === id && c.nativeId === nativeId)
    let peer = peers.find(p => p.provider === provider && p.nativeId === nativeId)
    if (!peer) {
      peer = { provider, nativeId, generation: string(from.generation), cwd: matching ? string(matching.cwd) : '',
        online: matching ? onlineOf(matching.status) : null, exchanges: [] }
      peers.push(peer)
    }
    if (r.sender !== 'verified' && r.sender !== 'declared') throw new Error('Invalid sender status')
    peer.exchanges.push({ id: string(r.id), direction: 'inbound', at: timestamp(r.at),
      ...(r.sender === 'verified' ? { color: palette.green, label: '受け取った' } : UNKNOWN),
      times: { reached: null, processing: null, replied: null }, rejected: false })
  }
  return peers.filter(p => p.exchanges.length > 0)
}

export function latest(exchanges: Exchange[]): Exchange {
  // Without a timestamp we cannot establish which exchange is newest.
  const missing = exchanges.find(e => e.at === null)
  if (missing) return { ...missing, ...UNKNOWN }
  return exchanges.reduce((a, b) => b.at! > a.at! ? b : a)
}

export function companiesOf(peers: Peer[]) {
  return (['codex', 'claude', 'grok'] as const).flatMap(provider => {
    const exchanges = peers.filter(p => p.provider === provider).flatMap(p => p.exchanges)
    return exchanges.length ? [{ provider, count: exchanges.length, ...latest(exchanges) }] : []
  })
}

export function peerLabel(peer: Peer): string {
  const folder = printable(peer.cwd, 1000).split(/[\\/]/).filter(Boolean).pop() || '作業場所は未確認'
  return `${companyName(peer.provider)} · ${folder}`
}

/**
 * The peer as the fourth band names it: its conversation, not its company.
 * The repository folder, and the worktree when the conversation sits in one
 * (`seamless · hello-6d7bef`); the company and the short id are its badge.
 */
export function peerName(peer: Peer): string {
  const parts = printable(peer.cwd, 1000).split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return '作業場所は未確認'
  const worktree = parts.indexOf('.claude')
  if (worktree > 0 && parts[worktree + 1] === 'worktrees' && parts[worktree + 2] !== undefined) return `${parts[worktree - 1]} · ${parts[worktree + 2]}`
  return parts[parts.length - 1]
}

/** The company and the conversation's short id, in small print beside the name. */
export function peerBadge(peer: Peer): string {
  return `${companyName(peer.provider)} ${peer.nativeId.slice(0, 8)}`
}

/** The whole session's tally for the team pane: sent, received, and received but not yet read. */
export function summaryOf(peers: Peer[], readSinceMs: number | null): { sent: number; received: number; unread: number; problems: number } {
  const all = peers.flatMap(p => p.exchanges)
  const received = all.filter(e => e.direction === 'inbound')
  return {
    sent: all.filter(e => e.direction === 'outbound').length,
    received: received.length,
    unread: received.filter(e => e.at === null || readSinceMs === null || e.at > readSinceMs).length,
    problems: all.filter(e => e.direction === 'outbound' && e.color === palette.red).length,
  }
}

/** One company's tally for the band's right side: sent, received, and what is not yet confirmed. */
export type Tally = {
  provider: Peer['provider']
  up: number
  upPending: number
  down: number
  downUnread: number
  problems: Exchange[]
}

/**
 * Counts per company: `up` the requests this session sent, `upPending` those
 * whose arrival or reading is not confirmed, `down` the requests it received,
 * `downUnread` those that came after the last turn began (not yet read), and
 * `problems` the requests that did not arrive.
 */
export function talliesOf(peers: Peer[], readSinceMs: number | null): Tally[] {
  return (['codex', 'claude', 'grok'] as const).flatMap(provider => {
    const exchanges = peers.filter(p => p.provider === provider).flatMap(p => p.exchanges)
    if (exchanges.length === 0) return []
    const sent = exchanges.filter(e => e.direction === 'outbound')
    const received = exchanges.filter(e => e.direction === 'inbound')
    return [{
      provider,
      up: sent.length,
      upPending: sent.filter(e => e.color !== palette.green && e.color !== palette.red).length,
      down: received.length,
      downUnread: received.filter(e => e.at === null || readSinceMs === null || e.at > readSinceMs).length,
      problems: sent.filter(e => e.color === palette.red),
    }]
  })
}

/**
 * The requests as far as they have been seen to go: a stage once observed
 * happened, so a later look that misses it (the peer's history could not be
 * read that time) does not take it back. `memory` keeps the furthest times
 * seen, by peer and request, across looks.
 */
export function settle(peers: Peer[], memory: Map<string, Exchange['times']>): Peer[] {
  return peers.map(peer => ({ ...peer, exchanges: peer.exchanges.map(x => {
    if (x.direction !== 'outbound') return x
    const key = `${peer.provider}:${peer.nativeId}:${x.id}`
    const seen = memory.get(key)
    const times = {
      reached: x.times.reached ?? seen?.reached ?? null,
      processing: x.times.processing ?? seen?.processing ?? null,
      replied: x.times.replied ?? seen?.replied ?? null,
    }
    memory.set(key, times)
    const state = times.processing !== null || times.replied !== null ? { color: palette.green, label: times.replied !== null ? '既読 · 返信あり' : '既読' }
      : times.reached !== null && x.color !== palette.green ? { color: palette.orange, label: '届いた · 未読' }
      : { color: x.color, label: x.label }
    return { ...x, ...state, times, rejected: state.color === palette.red }
  }) }))
}

/** A received message that answers one of this session's requests: it came when that request's reply was seen. */
export function isReply(peer: Peer, exchange: Exchange): boolean {
  return exchange.direction === 'inbound' && exchange.at !== null
    && peer.exchanges.some(x => x.direction === 'outbound' && x.times.replied === exchange.at)
}

/** A request's way so far, as the open band draws it: each step, when it was seen, and how it stands. */
export type Step = { word: string; at: number | null; state: 'done' | 'now' | 'todo' | 'bad' }

export function stepsOf(peer: Peer, exchange: Exchange, readSinceMs: number | null): Step[] {
  if (exchange.direction === 'inbound') {
    const isRead = exchange.at !== null && readSinceMs !== null && exchange.at <= readSinceMs
    const sender = exchange.color === UNKNOWN.color ? '（送り主は未確認）' : ''
    return [
      { word: `${isReply(peer, exchange) ? '返信を受け取った' : '受け取った'}${sender}`, at: exchange.at, state: 'done' },
      isRead ? { word: '読んだ', at: null, state: 'done' } : { word: 'まだ読んでいない', at: null, state: 'now' },
    ]
  }
  const { reached, processing, replied } = exchange.times
  if (exchange.rejected) return [{ word: '送った', at: exchange.at, state: 'done' }, { word: '届かなかった', at: null, state: 'bad' }]
  const isRead = processing !== null || replied !== null
  const step = (word: string, at: number | null, isSeen: boolean, isNext: boolean): Step =>
    ({ word, at, state: isSeen ? 'done' : isNext ? 'now' : 'todo' })
  return [
    step('送った', exchange.at, true, false),
    reached !== null || isRead ? step('届いた', reached, true, false)
      : exchange.inbox === 'unknown' ? { word: GROK_UNKNOWN, at: null, state: 'bad' }
      : exchange.inbox === 'orphaned' ? { word: GROK_ORPHANED, at: null, state: 'bad' }
      : exchange.inbox === 'pending' ? { word: exchange.idle ? `${GROK_WAITING}（${GROK_IDLE}）` : GROK_WAITING, at: null, state: 'now' }
      : { word: exchange.color === UNKNOWN.color ? '届いたかは未確認' : '届く', at: null, state: 'now' },
    replied !== null ? step('読んだ', processing, true, false) : processing !== null ? { word: '読んでいる', at: processing, state: 'now' } : step('読む', null, false, reached !== null && !isRead),
    step('返信', replied, replied !== null, false),
  ]
}

/**
 * The open band's line for one exchange: how it stands now, in words (design v5). The dots of each step stay in the
 * team pane; here the reader sees at a glance what is happening — being read for 12 seconds, answered at 19:15.
 */
export function stateLineOf(peer: Peer, exchange: Exchange, readSinceMs: number | null, nowMs: number, clock: (ms: number) => string): string {
  const at = (ms: number | null) => ms === null ? '' : ` ${clock(ms)}`
  if (exchange.direction === 'inbound') {
    const what = isReply(peer, exchange) ? '返信を受け取った' : '依頼を受け取った'
    const isRead = exchange.at !== null && readSinceMs !== null && exchange.at <= readSinceMs
    return `${what}${at(exchange.at)}${exchange.color === UNKNOWN.color ? '（送り主は未確認）' : ''}${isRead ? '' : '・まだ読んでいない'}`
  }
  const { reached, processing, replied } = exchange.times
  if (replied !== null) return `返信あり${at(replied)}`
  if (processing !== null) return `読んでいる（${durationOf(nowMs - processing)}）`
  if (exchange.rejected) return '届かなかった'
  if (reached !== null) return `届いた・未読${at(reached)}`
  if (exchange.inbox === 'unknown') return GROK_UNKNOWN
  if (exchange.inbox === 'orphaned') return GROK_ORPHANED
  if (exchange.inbox === 'pending') return exchange.idle ? `${GROK_WAITING}（${GROK_IDLE}）` : GROK_WAITING
  return exchange.color === UNKNOWN.color ? '届いたかは未確認' : '送った・届くのを待っている'
}

/** What the closed band says of the exchanges in a few words, and how strongly. */
export type Focus = { provider: Peer['provider']; peer: Peer; exchange: Exchange; word: string; tone: 'ok' | 'attn' | 'fail'; sinceMs: number | null }

const RECENT_REPLY_MS = 30 * 60 * 1000

/**
 * The exchange the closed band names: a message received and not yet read
 * first, then the newest request this session sent (not arrived, on its way,
 * being read, or answered in the last half hour).
 */
export function focusOf(peers: Peer[], readSinceMs: number | null, nowMs: number): Focus | null {
  const all = peers.flatMap(peer => peer.exchanges.map(exchange => ({ peer, exchange })))
  const newest = <T extends { exchange: Exchange }>(list: T[]) => list.reduce<T | null>((a, b) => a === null || (b.exchange.at ?? 0) > (a.exchange.at ?? 0) ? b : a, null)
  const unread = newest(all.filter(({ exchange }) => exchange.direction === 'inbound' && (exchange.at === null || readSinceMs === null || exchange.at > readSinceMs)))
  if (unread !== null) return { provider: unread.peer.provider, peer: unread.peer, exchange: unread.exchange, word: isReply(unread.peer, unread.exchange) ? '返信が届いた' : '依頼が届いた', tone: 'ok', sinceMs: null }
  const sent = newest(all.filter(({ exchange }) => exchange.direction === 'outbound'))
  if (sent === null) return null
  const { provider } = sent.peer
  const { times, rejected, at } = sent.exchange
  const who = { provider, peer: sent.peer, exchange: sent.exchange }
  if (rejected) return { ...who, word: '届かなかった', tone: 'fail', sinceMs: null }
  if (times.replied !== null) return nowMs - times.replied <= RECENT_REPLY_MS ? { ...who, word: '返信あり', tone: 'ok', sinceMs: null } : null
  if (times.processing !== null) return { ...who, word: '読んでいる', tone: 'attn', sinceMs: times.processing }
  if (times.reached !== null) return { ...who, word: '届いた・未読', tone: 'attn', sinceMs: times.reached }
  return { ...who, word: '送った', tone: 'attn', sinceMs: at }
}

/**
 * What happened to the exchanges since this session began to look, as
 * notices for a toast: a request taken up, answered, or not delivered, and a
 * message received. Each event is told once: `told` keeps the events already
 * told (or seen on the first look, `isTelling` false), so a stage that drops
 * out of one look and comes back is not told again, and one reply, seen as
 * an answer or as a message, is told once.
 */
export function noticesOf(peers: Peer[], told: Set<string>, isTelling: boolean): string[] {
  const once = (key: string, notice: string): string[] => {
    if (told.has(key)) return []
    told.add(key)
    return isTelling ? [notice] : []
  }
  // The answers seen so far, by peer and time: a message that came then is that answer.
  for (const peer of peers) for (const x of peer.exchanges) {
    if (x.direction === 'outbound' && x.times.replied !== null) told.add(`answer-at:${peer.provider}:${peer.nativeId}:${x.times.replied}`)
  }
  return peers.flatMap(peer => peer.exchanges.flatMap(x => {
    const name = peerName(peer)
    const event = (what: string) => `${peer.provider}:${peer.nativeId}:${x.direction}:${x.id}:${what}`
    if (x.direction === 'inbound') {
      if (told.has(event('received'))) return []
      const isAnswer = isReply(peer, x) || (x.at !== null && told.has(`answer-at:${peer.provider}:${peer.nativeId}:${x.at}`))
      told.add(event('received'))
      // Kept by time: an answer seen later at this time was told as this message.
      if (x.at !== null) told.add(`message-at:${peer.provider}:${peer.nativeId}:${x.at}`)
      return isAnswer ? once(`reply:${peer.provider}:${peer.nativeId}:${x.at}`, `${name} から返信が届きました`) : isTelling ? [`${name} から依頼が届きました`] : []
    }
    if (x.rejected) return once(event('rejected'), `${name} に依頼が届きませんでした`)
    if (x.times.replied !== null) {
      // An answered request has nothing earlier left to tell.
      told.add(event('processing'))
      if (told.has(event('replied'))) return []
      // A reply also received here as a message is told as that message,
      // now or before (the message may have left the list since).
      if (isReplyReceived(peer, x)) return []
      told.add(event('replied'))
      if (told.has(`message-at:${peer.provider}:${peer.nativeId}:${x.times.replied}`)) return []
      return once(`reply:${peer.provider}:${peer.nativeId}:${x.times.replied}`, `${name} が依頼に返信しました`)
    }
    if (x.times.processing !== null) return once(event('processing'), `${name} が依頼を読み始めました`)
    return []
  }))
}

/** A reply this session also received: the received message is the notice. */
function isReplyReceived(peer: Peer, request: Exchange): boolean {
  return peer.exchanges.some(x => x.direction === 'inbound' && x.at !== null && x.at === request.times.replied)
}
