#!/usr/bin/env bash
# Hermetic checks: no Keychain, no network, no installed AI product. `HOME=$(mktemp -d) bash scripts/verify.sh` proves it.
# scripts/verify-live.sh runs these and then the checks that belong to this Mac (Keychain values, Claude plugin).
set -euo pipefail
cd "$(dirname "$0")/.."
# A version manager's shim can refuse to run when HOME is not the one it was installed under, and a hermetic run has an empty
# HOME. Fall back to the first plain node on PATH that runs.
if ! node --version >/dev/null 2>&1; then
  rest="$PATH"
  while [ -n "$rest" ]; do
    dir="${rest%%:*}"
    case "$rest" in *:*) rest="${rest#*:}" ;; *) rest="" ;; esac
    if [ -n "$dir" ] && [ -x "$dir/node" ] && "$dir/node" --version >/dev/null 2>&1; then PATH="$dir:$PATH"; export PATH; break; fi
  done
fi
# Node 24.14 and earlier print an ExperimentalWarning for node:sqlite on standard error, and a check reads the CLI's
# standard error as JSON. 24.19 stopped; this keeps the result the same for whichever node was picked above.
node_options="--disable-warning=ExperimentalWarning${NODE_OPTIONS:+ $NODE_OPTIONS}"
verify_exit=0
typecheck_exit=0
echo "typecheck: start"
tsc --noEmit --strict --allowImportingTsExtensions --target es2022 --module nodenext --moduleResolution nodenext --types node src/*.ts src/adapters/*.ts tests/*.ts tests/support/*.ts scripts/*.ts || typecheck_exit=$?
echo "typecheck: exit=$typecheck_exit"
if [ "$typecheck_exit" -ne 0 ]; then verify_exit=$typecheck_exit; fi
NODE_OPTIONS="$node_options" node --test tests/*.test.ts || verify_exit=$?
echo "verify: exit=$verify_exit"
exit "$verify_exit"
