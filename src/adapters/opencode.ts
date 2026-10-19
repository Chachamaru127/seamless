import { homedir } from 'node:os';
import type { Receipt } from '../delivery.ts';
import type { StructureItem } from '../status.ts';
import {
  MAX_TEXT,
  keyOf,
  putEnvelope,
  readPeer,
  readPeers,
  readReceipts,
  type Envelope,
  type PeerRecord,
} from '../../packages/opencode-plugin/index.ts';

// opencode has no socket or command seamless can write to: its server process loads the plugin in
// packages/opencode-plugin/index.ts, and the plugin is the side that calls the official `session.prompt`. seamless and
// the plugin meet on two files (Plans.md 3 章):
//
//   ~/.seamless/peers/opencode-<session>.json     the plugin writes the session and its idle/busy state
//   ~/.seamless/opencode-inbox/<session>/...      seamless puts a request in pending/; the plugin injects it
//
// This adapter only reads the peer records and puts envelopes in that inbox. It never claims a request reached the
// session: the plugin's receipt in delivered/ is the evidence the status reader uses.
export type OpencodePeer = PeerRecord;
export type OpencodeEnvelope = Envelope;
// What the listing shows: idle = hand it over now, busy = hand it over at the next turn (Plans.md 3 章).
export type OpencodeState = 'ready' | 'next_turn';
export type OpencodeOptions = { home?: string };

export const opencodeState = (peer: Pick<PeerRecord, 'state'>): OpencodeState => peer.state === 'busy' ? 'next_turn' : 'ready';

export async function listOpencodePeers(options: OpencodeOptions = {}): Promise<{ peers: OpencodePeer[]; unreadable: boolean }> {
  return readPeers(options.home ?? homedir());
}
export async function findOpencodePeer(sessionId: string, options: OpencodeOptions = {}): Promise<OpencodePeer | null> {
  return readPeer(sessionId, options.home ?? homedir());
}

// An envelope whose recipient generation is not the one in the peers file belongs to another incarnation of the same
// session: the running plugin would never inject it, so it is refused rather than left pending forever.
export async function sendOpencodeEnvelope(envelope: Envelope, options: OpencodeOptions = {}): Promise<Receipt> {
  if (![...envelope.text].length || [...envelope.text].length > MAX_TEXT) return { status: 'rejected', reason: 'too_long' };
  const home = options.home ?? homedir();
  const peer = await findOpencodePeer(envelope.recipient.nativeId, options);
  if (!peer) return { status: 'rejected', reason: 'no_session' };
  if (envelope.recipient.generation !== peer.generation) return { status: 'rejected', reason: 'generation_mismatch' };
  let put;
  try {
    put = await putEnvelope(envelope, home);
  } catch {
    return { status: 'unknown' };
  }
  if (put.status === 'invalid') return { status: 'rejected', reason: 'invalid_envelope' };
  if (put.status === 'exists') return put.state === 'unknown' ? { status: 'unknown' } : { status: 'submitted', nativeMessageId: envelope.id };
  return { status: 'submitted', nativeMessageId: envelope.id };
}

// The plugin's own receipt: the request was handed to `session.prompt` for this session and generation.
export async function readOpencodeStructure(peer: Pick<PeerRecord, 'sessionId' | 'generation'>, options: OpencodeOptions = {}): Promise<StructureItem[]> {
  const receipts = await readReceipts(peer.sessionId, options.home ?? homedir());
  return receipts
    .filter((receipt) => receipt.generation === peer.generation)
    .map((receipt) => ({
      id: `opencode-receipt:${keyOf(receipt.envelope.sender, receipt.envelope.id)}`,
      type: 'opencode-receipt',
      at: new Date(receipt.at).toISOString(),
      generation: receipt.generation,
      peer: {
        id: receipt.envelope.id,
        sender: {
          provider: receipt.envelope.sender.id.split(':')[0] ?? 'unknown',
          nativeId: receipt.envelope.sender.nativeId,
        },
        ...(receipt.envelope.replyTo ? { replyTo: receipt.envelope.replyTo } : {}),
      },
    }));
}

// The plugin's install step: a plugin that is present but has never run leaves no peers file, so a caller can tell
// "opencode is not running with seamless" from "opencode is running and idle".
