#!/usr/bin/env bash
# Cursor CLI hook for sessionStart, stop and afterAgentResponse.
#
# Cursor runs this command with the event's JSON on standard input and reads the JSON answer from standard output
# (~/.cursor/hooks.json, measured on cursor-agent 2026.10.17). The work is in src/adapters/cursor.ts:
#
#   sessionStart        writes ~/.seamless/peers/cursor-<session>.json and may add pending inbox text as additional_context
#   afterAgentResponse  writes the peers file only
#   stop                writes the peers file and hands one pending envelope over as followup_message
#
# The hook is an edge of Cursor's turn, not a place to fail a turn: every error ends with no output and exit 0.
set -u

# Resolve a symlink to this script, so an installed link still finds the repository next to it.
source_path="${BASH_SOURCE[0]}"
while [ -L "$source_path" ]; do
  source_dir="$(cd -P "$(dirname "$source_path")" && pwd)"
  source_path="$(readlink "$source_path")"
  case "$source_path" in
    /*) ;;
    *) source_path="$source_dir/$source_path" ;;
  esac
done
here="$(cd -P "$(dirname "$source_path")" && pwd)"

node_bin="${SEAMLESS_NODE:-}"
if [ -z "$node_bin" ]; then
  node_bin="$(command -v node 2>/dev/null || true)"
fi
[ -n "$node_bin" ] || exit 0

# Node 24 prints an experimental warning for TypeScript on stderr; standard output must stay the hook's JSON only.
exec "$node_bin" "$here/../../src/adapters/cursor.ts" 2>/dev/null
