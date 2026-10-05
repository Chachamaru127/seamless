import { palette } from './appearance'
import { printable } from './text'

export type Exchange = {
  id: string
  direction: 'outbound' | 'inbound'
  at: number | null
  color: string
  label: string
  /** When the request was seen to reach the peer, to be taken up, and answered; null while not seen. */
  times: { reached: number | null; processing: number | null; replied: number | null }
  rejected: boolean
}
export type Peer = {
  provider: 'claude' | 'codex'
  nativeId: string
  generation: string
  cwd: string
  /** Whether the peer's conversation is running, as the query saw it; null when it did not say. */
  online: boolean | null
  exchanges: Exchange[]
}
export const UNKNOWN = { color: palette.muted, label: '未確認' }
export const companyName = (provider: Peer['provider']) => provider === 'claude' ? 'Claude' : 'Codex'
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

function outbound(value: unknown): Exchange {
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
  return { id: string(r.id), direction: 'outbound', at: timestamp(r.at), ...state,
    times: { reached: when('reached'), processing: when('processing'), replied: when('replied') }, rejected: state.color === palette.red }
}

/** Whether a peer runs: online, or a status that says it does not; unknown and missing say nothing. */
const onlineOf = (status: unknown): boolean | null =>
  status === 'online' ? true : typeof status === 'string' && status !== 'unknown' ? false : null

/** Parse only status metadata; do not retain the response's tickets or other fields. */
export function peersOf(json: string): Peer[] {
  const data = object(JSON.parse(json))
  if (data.status !== 'ok') throw new Error('Query failed')
  const peers: Peer[] = []
  const candidates = array(data.candidates).map(object)
  for (const c of candidates) {
    if (c.provider !== 'claude' && c.provider !== 'codex') continue
    peers.push({ provider: c.provider, nativeId: string(c.nativeId), generation: string(c.generation), cwd: string(c.cwd),
      online: onlineOf(c.status), exchanges: array(c.requests).map(outbound) })
  }
  for (const value of array(data.inbound)) {
    const r = object(value), from = object(r.from)
    const id = string(from.id), nativeId = string(from.nativeId)
    const provider = id.startsWith('claude:') ? 'claude' : id.startsWith('codex:') ? 'codex' : null
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
  return (['codex', 'claude'] as const).flatMap(provider => {
    const exchanges = peers.filter(p => p.provider === provider).flatMap(p => p.exchanges)
    return exchanges.length ? [{ provider, count: exchanges.length, ...latest(exchanges) }] : []
  })
}

export function peerLabel(peer: Peer): string {
  const folder = printable(peer.cwd, 1000).split(/[\\/]/).filter(Boolean).pop() || '作業場所は未確認'
  return `${companyName(peer.provider)} · ${folder}`
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
  return (['codex', 'claude'] as const).flatMap(provider => {
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
      : { word: exchange.color === UNKNOWN.color ? '届いたかは未確認' : '届く', at: null, state: 'now' },
    replied !== null ? step('読んだ', processing, true, false) : processing !== null ? { word: '読んでいる', at: processing, state: 'now' } : step('読む', null, false, reached !== null && !isRead),
    step('返信', replied, replied !== null, false),
  ]
}

/** What the closed band says of the exchanges in a few words, and how strongly. */
export type Focus = { provider: Peer['provider']; word: string; tone: 'ok' | 'attn' | 'fail'; sinceMs: number | null }

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
  if (unread !== null) return { provider: unread.peer.provider, word: isReply(unread.peer, unread.exchange) ? '返信が届いた' : '依頼が届いた', tone: 'ok', sinceMs: null }
  const sent = newest(all.filter(({ exchange }) => exchange.direction === 'outbound'))
  if (sent === null) return null
  const { provider } = sent.peer
  const { times, rejected, at } = sent.exchange
  if (rejected) return { provider, word: '届かなかった', tone: 'fail', sinceMs: null }
  if (times.replied !== null) return nowMs - times.replied <= RECENT_REPLY_MS ? { provider, word: '返信あり', tone: 'ok', sinceMs: null } : null
  if (times.processing !== null) return { provider, word: '読んでいる', tone: 'attn', sinceMs: times.processing }
  if (times.reached !== null) return { provider, word: '届いた・未読', tone: 'attn', sinceMs: times.reached }
  return { provider, word: '送った', tone: 'attn', sinceMs: at }
}

/**
 * What changed between two looks at the exchanges, as notices for a toast:
 * a request taken up, answered, or not delivered, and a message received.
 * A request first met by the later look is told by where it stands. A reply
 * is told once, whether seen first as an answer or as a message: `told`
 * keeps the replies already told, across looks.
 */
export function noticesOf(before: Peer[], after: Peer[], told: Set<string>): string[] {
  const keyOf = (peer: Peer, x: Exchange) => `${peer.provider}:${peer.nativeId}:${x.direction}:${x.id}`
  const known = new Map(before.flatMap(peer => peer.exchanges.map(x => [keyOf(peer, x), x] as const)))
  const once = (peer: Peer, at: number | null, notice: string): string[] => {
    const key = `${peer.provider}:${peer.nativeId}:reply:${at}`
    if (at !== null && told.has(key)) return []
    if (at !== null) told.add(key)
    return [notice]
  }
  return after.flatMap(peer => peer.exchanges.flatMap(x => {
    const name = companyName(peer.provider)
    const old = known.get(keyOf(peer, x))
    if (x.direction === 'inbound') {
      if (old !== undefined) return []
      return isReply(peer, x) ? once(peer, x.at, `${name} から返信が届きました`) : [`${name} から依頼が届きました`]
    }
    if (x.rejected) return old?.rejected === true ? [] : [`${name} に依頼が届きませんでした`]
    if (x.times.replied !== null && (old === undefined || old.times.replied === null)) {
      // A reply also received here as a message is told as that message.
      return isReplyReceived(peer, x) ? [] : once(peer, x.times.replied, `${name} が依頼に返信しました`)
    }
    if (x.times.processing !== null && (old === undefined || old.times.processing === null)) return [`${name} が依頼を読み始めました`]
    return []
  }))
}

/** A reply this session also received: the received message is the notice. */
function isReplyReceived(peer: Peer, request: Exchange): boolean {
  return peer.exchanges.some(x => x.direction === 'inbound' && x.at !== null && x.at === request.times.replied)
}
