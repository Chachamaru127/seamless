# Process contract verification

Owned files: tests/process.test.ts and tests/support/serve-fixture.ts.

Tests launch real child processes. The fixture alone injects online observations; product CLI/MCP is expected to remain unknown without a native observer. No external communication or business session calls.

Red execution: node --test tests/process.test.ts, exit 1 while product CLI/serve modules absent. Raw output: red-process.txt. Green execution: node --test tests/process.test.ts, actual exit 0. All 13 tests PASS, no cancelled/skipped tests. Raw output: green-process.txt.

An intermediate green run detected transport inconsistency: registry_unavailable was returned as result.status while the process contract required error.code. Main fixed the source; the test expectation was retained.

Covered contracts: sessions CLI/MCP parity; MCP sessions-only surface; sender/operation rejection; binding consumption and cross-process refusal; next-request file reload after grant revocation, malformed bootstrap, and caller generation replacement; malformed/oversized stdin sanitization and continuation; fake online, self-grant, duplicates, file mode and symlink rejection.
