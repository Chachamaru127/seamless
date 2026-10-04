import { printable } from './text'

export type Exchange = {
  id: string
  direction: 'outbound' | 'inbound'
  at: number | null
  color: string
  label: string
}
export type Peer = {
  provider: 'claude' | 'codex'
  nativeId: string
  generation: string
  cwd: string
  exchanges: Exchange[]
}
export const UNKNOWN = { color: 'gray', label: '未確認' }
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
  const observed = new Set(array(r.stages ?? []).flatMap(value => {
    const s = object(value)
    string(s.stage); string(s.status)
    return s.status === 'observed' ? [s.stage as string] : []
  }))
  let state = UNKNOWN
  if (observed.has('processing') || observed.has('replied')) state = { color: 'green', label: '既読' }
  else if (observed.has('reached')) state = { color: '#f59e0b', label: '届いたが未読' }
  else if (r.delivery === 'rejected') state = { color: 'red', label: '届かなかった' }
  return { id: string(r.id), direction: 'outbound', at: timestamp(r.at), ...state }
}

/** Parse only status metadata; do not retain the response's tickets or other fields. */
export function peersOf(json: string): Peer[] {
  const data = object(JSON.parse(json))
  if (data.status !== 'ok') throw new Error('Query failed')
  const peers: Peer[] = []
  const candidates = array(data.candidates).map(object)
  for (const c of candidates) {
    if (c.provider !== 'claude' && c.provider !== 'codex') continue
    peers.push({ provider: c.provider, nativeId: string(c.nativeId), generation: string(c.generation), cwd: string(c.cwd), exchanges: array(c.requests).map(outbound) })
  }
  for (const value of array(data.inbound)) {
    const r = object(value), from = object(r.from)
    const id = string(from.id), nativeId = string(from.nativeId)
    const provider = id.startsWith('claude:') ? 'claude' : id.startsWith('codex:') ? 'codex' : null
    if (!provider) continue
    const matching = candidates.find(c => c.id === id && c.nativeId === nativeId)
    let peer = peers.find(p => p.provider === provider && p.nativeId === nativeId)
    if (!peer) {
      peer = { provider, nativeId, generation: string(from.generation), cwd: matching ? string(matching.cwd) : '', exchanges: [] }
      peers.push(peer)
    }
    if (r.sender !== 'verified' && r.sender !== 'declared') throw new Error('Invalid sender status')
    peer.exchanges.push({ id: string(r.id), direction: 'inbound', at: timestamp(r.at),
      ...(r.sender === 'verified' ? { color: 'green', label: '受け取って会話に入った' } : UNKNOWN) })
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
  return (['claude', 'codex'] as const).flatMap(provider => {
    const exchanges = peers.filter(p => p.provider === provider).flatMap(p => p.exchanges)
    return exchanges.length ? [{ provider, count: exchanges.length, ...latest(exchanges) }] : []
  })
}

export function peerLabel(peer: Peer): string {
  const folder = printable(peer.cwd, 1000).split(/[\\/]/).filter(Boolean).pop() || '作業場所は未確認'
  return `${companyName(peer.provider)} ${printable(peer.nativeId, 1000).slice(0, 8)} / ${folder}`
}
