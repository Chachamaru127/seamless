# seamless

Unofficial local wiring between the AI conversations you already have on one Mac:
Claude Code, Codex, opencode, Cursor CLI, Antigravity CLI, Grok CLI, and a Grok Bot you register yourself.

One conversation asks another in the same workspace. seamless carries the request through the product's own
path, then reports what it could observe: accepted, reached the other side, being processed, replied, or
unknown. It adds no judgement of its own. It keeps no message bodies, no history database, and no daemon, and
it opens no network connection except a webhook to an outside executor you registered yourself.

Node.js 22.22 or later.

## Unofficial notice (非公式の但し書き)

This is an unofficial project. It is not affiliated with, endorsed by, or supported by Anthropic, OpenAI, xAI,
Anysphere (Cursor), Google, Orca, or Reason Network. Product names are used only to describe interoperability and
belong to their owners.

Several adapters use interfaces that are not a public stable SDK: Claude session sockets, Codex `queue` and
Desktop IPC, Grok session files. A product update can break them without notice. The compatibility table records
what was observed and when, and an unseen version is shown as `versionStatus: unverified` rather than assumed to
work. Use this at your own risk, and keep the products' own approvals and sandboxes in place: a message that
arrives through seamless never counts as a human approval.

## Supported counterparts (対応している相手)

seamless carries a request through the path each maker publishes, not through a protocol it invented. These are
the four paths that carry a message, with the public document each one rests on:

| Product | Official path seamless uses | Public document | The line read there |
|---|---|---|---|
| Claude Code | cross-session messaging over the session socket; the socket path arrives as `CLAUDE_CODE_MESSAGING_SOCKET` | https://code.claude.com/docs/en/cross-session-messaging | "The session's inbox socket" (section heading, read 2026-10-19) |
| Codex | `codex queue --thread <ID> --message <TEXT>` | https://github.com/openai/codex | "Queue a message for an existing session" (`codex queue --help`, codex-cli 0.163.0, run 2026-10-20) |
| opencode | the plugin API; the plugin calls `session.prompt` | https://opencode.ai/docs/plugins/ | `session.prompt` on the plugin context (official types, `@opencode-ai/plugin` 1.19.0); the page's own wording is not quoted here |
| Cursor | hooks `sessionStart`, `afterAgentResponse`, `stop` in `~/.cursor/hooks.json` | https://cursor.com/docs/hooks | "Hooks are scripts or prompt-based checks that exchange JSON over stdin/stdout and can observe, block, modify, or follow up on behavior." (Cursor's shipped hook guide, read 2026-10-20) |

Each row names where its line was read. Where that is the product's own shipped help or type file rather than the
page itself, the page is still the document to open before relying on the path. `docs/release.md` 4.3 records the
terms check for the Grok Bot webhook, Cursor hooks and Antigravity hooks as open.

## Install

```sh
npx @chachamaru127/seamless setup
```

`bin` maps `seamless` to `src/cli.ts`, and the package ships its TypeScript sources with no build step. As
measured on 2026-10-20, that entry does not run once installed: Node refuses to strip type annotations for a
file under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and both `npx` and
`npm i -g @chachamaru127/seamless` put the package there. Until a built entry replaces it (docs/release.md
section 6, item 1), use the checkout form below.

## Try it (from a checkout)

Nothing here needs an account or a running AI product, and no install is needed. `verify.sh` changes no file,
and `setup --dry-run` writes nothing. A version manager's Node shim can refuse a home it was not installed
under. The `PATH` prefix below puts a Homebrew Node first on macOS; with any other plain Node, drop the prefix.

```sh
bash scripts/verify.sh
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts setup --dry-run
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts setup
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts "check the follow-up in this workspace"
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts status REQUEST_ID
```

`setup` makes one change, the MCP registration in `~/.claude.json`. `REQUEST_ID` is the id of a request you
sent; on a fresh home no request is known yet, and `status` says so instead of failing.

## setup

`setup` detects the products on this Mac (Claude Code, Codex, opencode, Cursor CLI, Antigravity CLI, Grok CLI,
and Grok Bot peers), lists the Claude conversations that currently name an inbox socket, and registers one MCP
server named `seamless` in `~/.claude.json`.

- It runs on Windows, Linux, or macOS only as far as the products themselves do; this v1 targets one Mac, and
  other platforms are untested.
- It reads no Keychain value, starts no product, and sends nothing off the machine.
- An existing `~/.claude.json` is copied to `~/.seamless/backups/` before it is changed.
- Running it again leaves an identical registration untouched and writes no new backup.
- An unreadable or malformed settings file is refused as `config_unusable` rather than overwritten.
- `--dry-run` reports the same list and the single change it would make, without writing.

`doctor` explains the same machine read-only:

```sh
node src/cli.ts doctor --json
```

It reports Node, each product and binary, Claude inbox sockets, compatibility counts, whether Reason Network
hooks are present in any product's hooks table, and where Antigravity lives.

## One command (1 コマンド)

A lone argument that is not a command is the text to deliver:

```sh
node src/cli.ts "check the follow-up in this workspace"
```

The default destination is the peer in the caller's workspace. Exactly one sendable peer receives it. With
none it prints `target_unavailable`; with two or more it prints `ambiguous` and the candidates and stops
before any write. It never picks a destination by display name and never crosses into another workspace to
find one.

The answer is one JSON line with the delivery status. A reply is a second call that carries `replyTo`; the
one-word entry is for the first request. `status` follows the request id you set in the `send` call.

## status

Follow one request by id:

```sh
node src/cli.ts status REQUEST_ID
node src/cli.ts status REQUEST_ID --wait 60
```

`--wait` polls until a reply is observed or the given seconds (0 to 600) run out. The output separates five
stages: `accepted`, `reached`, `processing`, `replied`, `unknown`. Each stage is `observed` or `unobserved`,
with the evidence that showed it. `reached` is written only by a reader of the peer's own record, never by
the sender. A state sits beside the stages: `held` (the peer record was readable and stayed silent past
`heldAfterSec`, default 20 seconds), `read_failed` (the record could not be opened), `refused` (the official
path rejected the write).

To see who can take a request right now:

```sh
node src/cli.ts who --json
```

Each peer is `ready`, `next_turn`, `wake_needed`, or `unreachable` with a reason such as `no_inbox_socket`.

## Running alongside Reason (併用の注意)

Reason Network delivers into the same products through their hook tables, and some seamless adapters (Cursor
CLI, Antigravity CLI, Grok CLI) also use hooks and inbox files. Two layers can coexist, but not by accident:

- `doctor --json` reports `reason_network_hooks: true` when any product's hooks table mentions Reason. That is
  a detection, not a claim that Reason is running now.
- `setup` touches only `mcpServers.seamless` in `~/.claude.json`. It does not remove, reorder, or rewrite
  Reason's hooks. Do that removal in the product's own settings, with a copy kept first.
- Do not point both layers at the same inbox file or the same hook slot. While measuring delivery, keep one
  layer per product; a second writer makes "reached" and "replied" ambiguous.
- Keep the backup that `setup` writes and your own copy of every hook file you edit. seamless has no
  uninstaller that restores Reason.

## What it stores

| Path | Content | Mode |
|---|---|---|
| `~/.seamless/reservations/` | one file per request: hash, status, time, ids. No message body | 0600, directory 0700 |
| `~/.seamless/limits.json` | optional limits: exclusions, scope, read/send, `markUnapproved`, `strictVersions`, `codexMessageMaxChars`, `heldAfterSec` | 0600 |
| `~/.seamless/backups/` | copy of `~/.claude.json` taken before `setup` changes it | 0600, directory 0700 |
| `~/.seamless/peers.json` | outside executors you registered, such as a Grok Bot | 0600 |
| `~/.claude.json` | the one write `setup` makes: `mcpServers.seamless` | your existing mode |

A reservation is written before the native write, so a crash leaves `unknown` and the same request id is never
delivered twice automatically.

## Compatibility

The observed products and versions are listed in [the compatibility table](specs/202610-everyday-use/compat.md).
A version that is not in the table is still used by default and listed as `unverified`. A version marked
`fix_required` stops. To accept only verified versions, add `"strictVersions": true` to
`~/.seamless/limits.json`; the limits tool stays usable from an unverified version so the setting can be
removed again.

## Documents and licence

- [Product spec](spec.md), [wiring spec](specs/2026-10-universal-wiring/spec.md), [plans](specs/2026-10-universal-wiring/Plans.md)
- [Why seamless, compared with Reason](docs/reports/2026-10-19-seamless-beyond-reason.html)
- Licence: [MIT](LICENSE). Third-party and trademark notes: [NOTICE](NOTICE). Reporting: [SECURITY.md](SECURITY.md).
- 日本語: [README.ja.md](README.ja.md)
