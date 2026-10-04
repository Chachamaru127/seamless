# Desktop IPC probe contract

Scope: Codex Desktop 26.928.31416 build 12553, bundled Codex 0.159.2.
probe.py performs initialize/owner discovery. deliver.py additionally sent one fixed message to the existing root owner and received success; the root model observed claudex_test.external_message with DESKTOP_RX_73. This is a live receipt, not completion of the current research turn. read_marker.py subscribes only to root, projects the actual functionCallOutput ID from the owner snapshot, sends following=false, and closes. It never prints or saves the snapshot body. The delivery frame uses namespace claudex_test/name external_message.

## Commands

```sh
python3 .local/desktop-probe/probe.py owner
python3 .local/desktop-probe/probe.py dry-run
```

The root conversation is fixed to `01a0f59d-d3d1-79a2-948c-4a1f12a0a1a5`.
No CLI/server resume, daemon start, authentication setting read, or history
method is used. The clientType is honestly `claudex-desktop-probe`.
Delivery frames require IDs from initialization and owner discovery on the same
live connection; saved IDs alone are not a session capability.

## Actual shape

Start version 2 takes `params.conversationId` and `params.turnStart`.
The latter has `request` (app-server TurnStartParams) and optional `context`.
Custom tool output uses `request.input=[]`, `request.toolOutput` with
`{namespace:"claudex_test",name:"external_message",output:string}`.
`context.inheritThreadSettings=true` and omitted model/effort/collaboration,
permission, environment, cwd and plugin overrides inherit owner state.

Steer version 1 takes `conversationId`, `input`, `restoreMessage`, optional
`serviceTier`, `attachments`, `clientUserMessageId`, `additionalContext`, and
`toolOutput`. `restoreMessage.context` is read even for tool output. The owner
requires an active turn. With toolOutput it forwards `input=[]` to app-server
`turn/start`; it does not use public `turn/steer` with an external call ID.

Neither IPC entry has an authenticated native peer-author field. The custom
namespace preserves function-call-output classification. `declaredAuthor` and
`humanApproval:false` in output are bridge data and are not host-validated
identity or authorization. No `codex_app`, `codex_tui`, `mcp_app`, `visualization`,
`desktop` clientType, or native peer identity is impersonated.

## Different app-context path

The local untrusted app input schema has version 1 and optional message:
`{source:"mcp_app"|"visualization",sourceId:nonempty string,text:string,
imageUrls?:supported base64 image URLs[],structuredContent?:object}`.
Optional sender requires accountUserId/email/name/profilePictureUrl.
That path is for those app origins; it is not used for external AI messages.
It constructs `untrusted_input` function_call/function_call_output items and
passes them through `context.responseItems` to `thread/inject_items` before
start. Nonempty responseItems are rejected while the conversation is busy:
`App context must wait until the current turn finishes`.

## Root-only observation limits

Owner discovery returns only owner and capability metadata. It is safe to
project those fields. No root history is requested.
The internal stream protocol can target one conversation and selected clients,
but following that conversation sends its complete current snapshot first.
No host-side metadata-only subscription was established. read_marker.py now uses an explicitly root-scoped follower subscription and immediately projects marker IDs in memory. Unrelated broadcasts are discarded. Snapshot bodies are neither printed nor saved. Older probe.py remains discovery-only.

## Static evidence

All local positions are inside:
`/Applications/ChatGPT.app/Contents/Resources/app.asar`.
Offsets are character offsets into the UTF-8-decoded named file, zero based.
Lines are one based.

| File | Line / offset | Evidence |
|---|---|---|
| .vite/build/src-ghAWefM3.js | 1 / 14178 | owner-discovery v1, start v2, steer v1; remote host increments follower version |
| .vite/build/bootstrap-B7ariqxX.js | 585 / 739500, 742323 | asserts owner; maps follower start and steer to owner methods |
| same | 693 / 1025989 | Ule resolves model/effort/collaboration from latest owner state and carries toolOutput |
| same | 693 / 1041709 onward | forwards request/context, requires owner and streaming, verifies request.threadId == conversationId |
| same | 693 / 1043000 onward | nonempty responseItems wait until idle, then thread/inject_items |
| same | 693 / 1050480, 1054210 | active-turn steer checks; toolOutput maps to input=[] turn/start |
| same | 8 / 33900-37600 | strict app-origin schema and untrusted_input item generation |
| same | 1108 / 1714321, 1717542, 1726887 | initialization, honest client registration, owner capability check |
| same | 567 / 260545-261999 | root-targeted follower registration triggers full conversation snapshot |
| .vite/build/application-network-startup-D74LEWDz.js | 32 / 273551 onward | socket ownership/mode and 4-byte little-endian JSON framing |

Public app-server payload schema at fixed upstream commit
`01fc69f4026735edfdf6789820549727a4867b11`:

- `codex-rs/app-server-protocol/src/protocol/v2/turn.rs:153-181`:
  TurnToolOutput has name, nullable namespace, output; TurnStartParams has input
  and nullable toolOutput. No author/source/callId in TurnToolOutput.
- `codex-rs/app-server/src/request_processors/turn_processor.rs:541-550,597-610`:
  toolOutput requires empty input and nonempty name; maps to FunctionCallOutput
  with call_id=None. This is classification evidence, not external peer auth.
- `codex-rs/protocol/src/models.rs:2185-2190`: FunctionCallOutputBody is an
  untagged union of a string or FunctionCallOutputContentItem array.

The Desktop IPC wrapper itself has no verified public stable SDK/schema.
Do not confuse it with App Server Unix WebSocket transport.

## Busy behavior of native Codex (fixed public 0.159.3 source)

- `app-server/src/request_processors/turn_processor.rs:651-665` uses
  start_or_steer_turn for the standalone output. Lines 672-715 return the same
  accepted turn ID for Started or Steered; the response turn contains no items.
- `core/src/session/turn_input.rs:280-317` accepts standalone FunctionCallOutput
  with call_id=None, tries the active turn first, and returns Steered on success.
  NoActiveTurn is the idle-start branch at lines 319 onward.
- Same file, lines 640-683: Regular is steerable. Review and Compact are not.
  If a required output schema is supplied, it must equal the active turn schema.
- Same file, lines 694-718: input is enqueued into the existing active turn and
  the active turn ID is returned. This is not a durable next-idle user queue.
- Same file, lines 3-9: acceptance precedes hooks, context update, rollout
  persistence and sampling. ACK does not prove model consumption or completion.
- `core/src/session/turn.rs:424-444`: the turn loop drains pending input when
  permitted by the model/step; lines 874-889 retain the standard persistence
  barrier for tool outputs, even when they steer the active turn.

The Desktop IPC steer wrapper first requires an active turn and then translates
toolOutput to public turn/start with empty input. It does not forward an
expectedTurnId into that toolOutput turn/start. A future bridge must re-check
owner/runtime state, and treat raced turn completion according to observed ACK;
it must not silently substitute the user queue or another writer's resume.

IPC ACK projection: start was delivery-tested; steer remains a static-only candidate and is not the adopted sender.
start: `response.result.result.turn.id/status`; steer: `response.result.result.turnId`.
Only matched requestId response fields should be projected. Completion cannot be
inferred from either. A metadata-only completion subscription has not been
established, so the read-only probe does not implement completion observation.

## Complete history predicate, verified 2026-10-01

bootstrap-B7ariqxX.js line567: Sl offset204032 selects canonical turns; jl offset205258 tests every turn with itemsPagination?.hasLoadedOldest !== false; Al offset205068 and El offset204537 also require complete canonical history and one island. Line585, ose offset745338 uses those predicates for getCompleteConversationTurns. Missing item-pagination fields are therefore permitted by the native canonical path, not a legacy-only fallback.

Final live revision1444 matched response and owner snapshot. Explicit canonical and turn-level complete flags were true; per-item pagination counts were true=0, false=0, missing=8. read_full_marker.py preserves those counts separately and applies the verified predicate only for Desktop26.928.31416/build12553, canonical shape and observed source=null. An explicit false or version mismatch fails. The custom stricter all-explicit-true test exited1 and is retained as negative evidence; it does not refute native complete-history success.

supportsUntrustedAppInput describes a different app-origin path. It is not authorization for custom toolOutput delivery.
