#!/usr/bin/env bash
# Checks that need this Mac: the Keychain values behind the peer roster, and the Claude plugin tool.
# The hermetic checks live in scripts/verify.sh (the GitHub workflow runs only that one).
set -euo pipefail
cd "$(dirname "$0")/.."
live_exit=0
bash scripts/verify.sh || live_exit=$?
bash scripts/peer-secrets.sh || live_exit=$?
claude plugin validate --strict mods/seamless-band || live_exit=$?
(cd mods/seamless-band && claude plugin test .) || live_exit=$?
echo "verify-live: exit=$live_exit"
exit "$live_exit"
