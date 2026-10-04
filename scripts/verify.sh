#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "typecheck: start"
tsc --noEmit --strict --allowImportingTsExtensions --target es2022 --module nodenext --moduleResolution nodenext --types node src/*.ts src/adapters/*.ts tests/*.ts tests/support/*.ts
echo "typecheck: exit=0"
node --test tests/*.test.ts
echo "verify: exit=0"
