# Security policy

## Reporting

Report a suspected vulnerability privately through this repository's GitHub Security Advisory form. If that
form is unavailable, contact the maintainer through a private channel you already use. Do not open a public
issue with a working exploit, a message body, a session id, a socket path, or any other personal data.

Include the version or commit, the product and version involved, the command you ran, and what you expected
and saw. A minimal reproduction without real conversation text is enough.

This is an unofficial project with no service level agreement. Reports are read on a best-effort basis, and a
fix is not promised for interfaces that the products themselves can change without notice.

## What seamless does with your data

- It reads local session files, sockets, and hook tables of the AI products on the same Mac. It opens no
  network connection, except a webhook to an outside executor you registered yourself, such as a Grok Bot.
- It stores no message bodies. `~/.seamless/reservations/` keeps a hash, a status, a time, and ids only, in
  files of mode 0600 inside a directory of mode 0700.
- `setup` makes exactly one write: `mcpServers.seamless` in `~/.claude.json`, after copying the old file to
  `~/.seamless/backups/`.
- A message that arrives through seamless is never a human approval. It does not widen the receiving
  conversation's sandbox, permissions, or approval settings, and it carries no `humanApproval: true`.

## In scope

- A write that escapes the intended product path, the reservation directory, or the file modes above.
- A message body or secret that ends up in `~/.seamless/reservations/`, in a log, or in an error message.
- A network connection that seamless makes without a registered outside executor.
- A way for one OS user's registration to act as another user's conversation, beyond the documented fact that
  the same OS user can edit the roster.
- A delivery reported as `reached` or `replied` without that evidence in the peer's own record.

## Out of scope

- The AI products' own vulnerabilities and their private interface changes. Report those to their vendors.
- Anyone who can already read or write your home directory as your OS user.
- Prompt injection inside a delivered message. Handling the text is the receiving AI's decision, by design.
- Denial of service from a local process that is already running as you.
