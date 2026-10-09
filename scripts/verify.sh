#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
verify_exit=0
typecheck_exit=0
echo "typecheck: start"
tsc --noEmit --strict --allowImportingTsExtensions --target es2022 --module nodenext --moduleResolution nodenext --types node src/*.ts src/adapters/*.ts tests/*.ts tests/support/*.ts scripts/*.ts || typecheck_exit=$?
echo "typecheck: exit=$typecheck_exit"
if [ "$typecheck_exit" -ne 0 ]; then verify_exit=$typecheck_exit; fi
node --test tests/*.test.ts || verify_exit=$?
bash scripts/peer-secrets.sh || verify_exit=$?
claude plugin validate --strict mods/seamless-band || verify_exit=$?
(cd mods/seamless-band && claude plugin test .) || verify_exit=$?
echo "verify: exit=$verify_exit"
exit "$verify_exit"
