<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/seamless/main/docs/brand/hero.svg" alt="seamless" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/seamless"><img src="https://img.shields.io/npm/v/%40chachamaru127%2Fseamless?color=2f8f5b&label=npm" alt="npm"></a>
  <a href="https://github.com/Chachamaru127/seamless/actions/workflows/verify.yml"><img src="https://github.com/Chachamaru127/seamless/actions/workflows/verify.yml/badge.svg" alt="verify"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.22-8d8b85" alt="node 22.22 or later">
  <img src="https://img.shields.io/badge/platform-macOS-8d8b85" alt="macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8d8b85" alt="MIT"></a>
</p>

<p align="center">
  <b>Claude Code · Codex · opencode · Cursor CLI · Antigravity CLI · Grok CLI · Grok Bot</b><br>
  <sub>English · <a href="README.ja.md">日本語</a></sub>
</p>

You have Claude Code open in one terminal and Codex in the next. One of them needs a line from the other.
Today you copy, switch, paste, wait, and copy back. **seamless** turns that into one command, delivered through
the path each product already ships, and tells you what happened on the other side.

```sh
npx @chachamaru127/seamless setup
npx @chachamaru127/seamless "run the failing test and tell me what you see"
```

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/seamless/main/docs/brand/terminal.svg" alt="seamless status output: accepted, reached, processing, replied, each observed with its evidence" width="100%">
</p>

## What changes for you

- **No more copy and paste between AI conversations.** The conversation you are in sends to the one next to it. Your AI can do it too, through the `seamless` MCP tool that `setup` registers.
- **You know it arrived.** Delivery is reported in five stages, each one observed from the receiving product's own record, never from the sender's claim.
- **Nothing runs in the background.** No daemon, no history database, no message bodies on disk. Each request leaves one small record of its id and status.
- **One setup for seven products.** `setup` finds what is installed on this Mac and wires each product it finds. `setup --remove` undoes it.
- **Replies come back to the right place.** A reply carries the id it answers, so a thread stays a thread across products.

## Quick start

```sh
# 1. Wire the products installed on this Mac (preview first, then apply)
npx @chachamaru127/seamless setup --dry-run
npx @chachamaru127/seamless setup

# 2. Send one line to the conversation in the same workspace
npx @chachamaru127/seamless "check the follow-up in this workspace"

# 3. Follow it until a reply is observed (up to 60 s)
npx @chachamaru127/seamless status REQUEST_ID --wait 60
```

`npm i -g @chachamaru127/seamless` gives you the plain `seamless` command. Node.js 22.22 or later. macOS is the
tested platform.

## Works with

| Product | How seamless reaches it | Direction |
|---|---|---|
| Claude Code | the session's own inbox socket (cross-session messaging) | send and receive |
| Codex | `codex queue` into the existing thread | send and receive |
| opencode | the official plugin API (`session.prompt`) | send and receive |
| Cursor CLI | hooks in `~/.cursor/hooks.json` | send and receive |
| Antigravity CLI | detected by `doctor`; delivery is phase 2 and unverified | preview |
| Grok CLI | hooks and an inbox file | send and receive |
| Grok Bot | a webhook to an executor you register yourself | send and reply |

Every row uses the path the maker publishes. seamless invents no protocol of its own. The documents each row rests
on are listed under [Official paths](#official-paths).

## Why not just a hook

| | Copy and paste | Hook-only relays | seamless |
|---|---|---|---|
| Reaches the conversation that is already open | you do it | sometimes a new process | yes, the existing one |
| Tells you it was read | no | no | yes, from the peer's record |
| Tells you it was answered | you look | no | yes, with the reply id |
| Runs a background process | no | often | never |
| Stores your messages | no | often | never |
| Removes itself | n/a | varies | `setup --remove` |

The comparison with Reason Network, measured on one Mac, is in
[docs/reports/2026-10-19-seamless-beyond-reason.html](docs/reports/2026-10-19-seamless-beyond-reason.html).

## See who can take a request

```sh
seamless who --json
```

Each peer is `ready`, `next_turn`, `wake_needed`, or `unreachable`, with a reason such as `no_inbox_socket`.
The default destination of a one-line send is the single sendable peer in your workspace. With two or more,
seamless prints `ambiguous` and the candidates and writes nothing. It never picks by display name and never
crosses into another workspace.

## Optional: the band for Claude Code

`mods/seamless-band` draws what your conversation is doing and the latest exchange with each peer above the
input of Claude Desktop's Code tab. Load it for one session with `claude --plugin-dir mods/seamless-band`
(Claude Code 2.1.287 or later).

---

## Reference

### setup

`setup` detects Claude Code, Codex, opencode, Cursor CLI, Antigravity CLI, Grok CLI, and registered Grok Bot
peers, then wires each product it finds: the `seamless` MCP server in `~/.claude.json`, the opencode plugin,
and the Cursor and Grok hooks. Antigravity is detected only.

- `--dry-run` prints the same detection and every change it would make, and writes nothing.
- `--remove` takes each registration out again.
- Every file it changes is copied first to `~/.seamless/backups/`.
- Running it twice leaves an identical registration untouched and writes no new backup.
- An unreadable or malformed settings file is reported as `config_unusable`, never overwritten.
- It reads no Keychain value, starts no product, and sends nothing off the machine.

`doctor --json` reports the same machine read-only: Node, each product and binary, Claude inbox sockets,
compatibility counts, whether Reason Network hooks are present in any product's hooks table, and where Antigravity
lives.

### One command

A lone argument that is not a command is the text to deliver. The answer is one JSON line with the request id and
the delivery status. A reply is a second send that carries `replyTo`.

### status

```sh
seamless status REQUEST_ID
seamless status REQUEST_ID --wait 60
```

`--wait` polls until a reply is observed or the seconds (0 to 600) run out. The five stages are `accepted`,
`reached`, `processing`, `replied`, `unknown`. Each is `observed` or `unobserved` with the evidence that showed
it. `reached` is written only by a reader of the peer's own record. Beside the stages sits a state: `held` (the
peer record was readable and stayed silent past `heldAfterSec`, default 20 s), `read_failed` (the record could not
be opened), or `refused` (the official path rejected the write).

### What it stores

| Path | Content | Mode |
|---|---|---|
| `~/.seamless/reservations/` | one file per request: hash, status, time, ids. No message body | 0600, directory 0700 |
| `~/.seamless/limits.json` | optional limits: exclusions, scope, read/send, `markUnapproved`, `strictVersions`, `codexMessageMaxChars`, `heldAfterSec` | 0600 |
| `~/.seamless/backups/` | copies of every settings file `setup` changed | 0600, directory 0700 |
| `~/.seamless/peers.json` | outside executors you registered, such as a Grok Bot | 0600 |
| product settings | `mcpServers.seamless` in `~/.claude.json`, the opencode plugin entry, the Cursor and Grok hook entries | your existing mode |

A reservation is written before the native write, so a crash leaves `unknown` and the same request id is never
delivered twice automatically.

### Official paths

| Product | Public document | The line read there |
|---|---|---|
| Claude Code | https://code.claude.com/docs/en/cross-session-messaging | "The session's inbox socket" (section heading, read 2026-10-19). The socket path arrives as `CLAUDE_CODE_MESSAGING_SOCKET` |
| Codex | https://github.com/openai/codex | "Queue a message for an existing session" (`codex queue --help`, codex-cli 0.163.0, run 2026-10-20) |
| opencode | https://opencode.ai/docs/plugins/ | `session.prompt` on the plugin context (`@opencode-ai/plugin` 1.19.0 types) |
| Cursor | https://cursor.com/docs/hooks | "Hooks are scripts or prompt-based checks that exchange JSON over stdin/stdout and can observe, block, modify, or follow up on behavior." (Cursor's shipped hook guide, read 2026-10-20) |

Where the line was read from the product's shipped help or types, the page is still the document to open before
relying on the path. `docs/release.md` 4.3 records the terms check for the Grok Bot webhook, Cursor hooks, and
Antigravity hooks as open.

### Compatibility

Observed products and versions are listed in [the compatibility table](specs/202610-everyday-use/compat.md).
A version not in the table is still used and shown as `unverified`. A version marked `fix_required` stops.
To accept only verified versions, add `"strictVersions": true` to `~/.seamless/limits.json`.

### Running alongside Reason Network

Reason Network delivers into the same products through their hook tables, and some seamless adapters (Cursor CLI,
Antigravity CLI, Grok CLI) also use hooks and inbox files. Two layers can coexist, but not by accident:

- `doctor --json` reports `reason_network_hooks: true` when any product's hooks table mentions Reason. That is a
  detection, not a claim that Reason is running now.
- `setup` adds and removes only its own entries. It does not remove, reorder, or rewrite Reason's hooks.
- Do not point both layers at the same inbox file or the same hook slot. While measuring delivery, keep one layer
  per product; a second writer makes "reached" and "replied" ambiguous.
- Keep the backups `setup` writes and your own copy of every hook file you edit.

### Unofficial

This is an unofficial project. It is not affiliated with, endorsed by, or supported by Anthropic, OpenAI, xAI,
Anysphere (Cursor), Google, Orca, or Reason Network. Product names are used only to describe interoperability and
belong to their owners.

Several adapters use interfaces that are not a public stable SDK: Claude session sockets, Codex `queue` and
Desktop IPC, Grok session files. A product update can break them without notice. The compatibility table records
what was observed and when. Use this at your own risk, and keep the products' own approvals and sandboxes in
place: a message that arrives through seamless never counts as a human approval.

### Develop

```sh
git clone https://github.com/Chachamaru127/seamless.git && cd seamless
bash scripts/verify.sh          # hermetic checks, changes no file
node src/cli.ts setup --dry-run
```

### Documents and licence

- [Product spec](spec.md), [wiring spec](specs/2026-10-universal-wiring/spec.md), [plans](specs/2026-10-universal-wiring/Plans.md)
- [Brand](specs/202610-brand/design.md)
- Licence: [MIT](LICENSE). Third-party and trademark notes: [NOTICE](NOTICE). Reporting: [SECURITY.md](SECURITY.md).
