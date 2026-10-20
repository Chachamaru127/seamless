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
# The published entry is the build: src/ does not travel in the tarball (issue #42). A minimal copy of this repository
# (tests/peers.test.ts) carries no tsconfig.build.json, so the build steps are skipped there.
build_exit=0
if [ -f tsconfig.build.json ]; then
  echo "build: start"
  npm run build >/dev/null || build_exit=$?
  echo "build: exit=$build_exit"
  if [ "$build_exit" -ne 0 ] && [ "$verify_exit" -eq 0 ]; then verify_exit=$build_exit; fi
fi
# The published set must run without the files npm leaves out; a shipped import of an excluded file fails here (T13).
# With a build in the set, the check reads dist/*.js instead of src/*.ts (issue #42).
pack_check_exit=0
NODE_OPTIONS="$node_options" node scripts/pack-check.ts || pack_check_exit=$?
echo "pack-check: exit=$pack_check_exit"
if [ "$pack_check_exit" -ne 0 ]; then verify_exit=$pack_check_exit; fi
NODE_OPTIONS="$node_options" node --test tests/*.test.ts || verify_exit=$?
# Node refuses to strip types for files under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and npx keeps the
# package there too. So the tarball itself is opened and setup is started from it, with an empty HOME (issue #42).
if [ -f tsconfig.build.json ]; then
  publish_exit=0
  # A version manager's shim can refuse to start under the empty HOME the check needs, so the binary behind it is used.
  publish_node="$(node -p 'process.execPath')"
  publish_dir="$(mktemp -d)"
  publish_home="$(mktemp -d)"
  npm pack --ignore-scripts --pack-destination "$publish_dir" >/dev/null 2>&1 || publish_exit=$?
  if [ "$publish_exit" -eq 0 ]; then
    tar -xzf "$publish_dir"/*.tgz -C "$publish_dir" || publish_exit=$?
  fi
  if [ "$publish_exit" -eq 0 ]; then
    publish_out="$(HOME="$publish_home" NODE_OPTIONS="$node_options" "$publish_node" "$publish_dir/package/dist/cli.js" setup --dry-run 2>"$publish_dir/stderr")" || publish_exit=$?
  fi
  if [ "$publish_exit" -ne 0 ]; then
    echo "publish: 失敗（tarball の dist/cli.js setup --dry-run が終了 ${publish_exit}）"
  elif grep -aq "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING" "$publish_dir/stderr"; then
    echo "publish: 失敗（公開物の中で型剥がしが拒否された）"
    publish_exit=1
  elif ! printf '%s' "$publish_out" | grep -q '"dryRun":true'; then
    echo "publish: 失敗（setup --dry-run が結果を返さない）"
    publish_exit=1
  fi
  rm -rf "$publish_dir" "$publish_home"
  echo "publish: exit=$publish_exit"
  if [ "$publish_exit" -ne 0 ] && [ "$verify_exit" -eq 0 ]; then verify_exit=$publish_exit; fi
fi
echo "verify: exit=$verify_exit"
exit "$verify_exit"
