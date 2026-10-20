#!/usr/bin/env bash
# Grok CLI Stop hook: the one file Grok's hook table names (src/manifests/grok-cli.json, install.hook).
#
# Grok runs this command at the end of each turn with the Stop event's JSON on standard input and reads the JSON answer
# from standard output (~/.grok/config.toml, measured on Grok CLI 1.0.46). The work is in src/grok-hook.ts, and in
# dist/grok-hook.js when seamless is installed from the published package:
#
#   pending/   an envelope seamless wrote for this conversation's generation
#   handed/    the envelope this run took (its pid is in the name)
#   delivered/ the receipt: the request's metadata without its body
#
# One Stop hands over at most one envelope, as additionalContext. Every failure ends with no output and exit 0; the hook
# never blocks the turn.
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
# The published package carries no src/: there the compiled hook is dist/grok-hook.js. A checkout without a build runs the
# TypeScript directly (issue #42).
if [ -f "$here/../../dist/grok-hook.js" ]; then
  hook_work="$here/../../dist/grok-hook.js"
else
  hook_work="$here/../../src/grok-hook.ts"
fi
exec "$node_bin" "$hook_work" 2>/dev/null
