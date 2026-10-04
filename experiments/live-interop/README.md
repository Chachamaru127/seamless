# Real session interoperability experiment

This is a bounded test set, not an installed product. It uses original native sessions and no shared SQLite inbox.

- `run.py`: two real model sessions, common MCP read/send/reply, fresh receipt nonces, busy delivery, native identities, and peer-history projection.
- `mcp_stdio.py`: test-only common tools. Sender identity comes from a per-child capability, not a model argument.
- `read_projection.py`: visible user/assistant/peer records, preserving original IDs and excluding thinking/signatures.
- `verify_evidence.py`: independently checks the original native Claude records against live results, including peer origin and reply correlation.
- `edge_cases.py`: bounded observations of duplicate IDs, stopped receiver, and the meaning of peer authority. A NO_AUTH answer is not a universal security guarantee.
- `test_projection.py`: regression checks against the actual synthetic native records.
- `results/`: projected evidence from the final runs, with no credentials or native thinking blocks.

Latest CLI run: `12faa30c-467d-4619-8662-30c444c18edb`, 17 assertions, process exit 0.
Edge run: `8bcd3513-328f-4573-b085-f71e43fdd482`, 7 observations, process exit 0.
Read-projection and Desktop history checks: 6 tests, exit 0. Independent review: APPROVE for feasibility evidence and implementation plan.

The final implementation plan is `../../specs/202610-session-interop/Plans.md`.
Desktop evidence uses the real existing Codex research conversation and a dedicated Claude Desktop fixture. It proves adapter behavior; the product's common MCP has not been installed globally into Desktop.

The coordinator and test MCP retain only in-flight state in memory. The result artifacts contain synthetic test text for inspection. Native histories remain where the vendors store them. Test runs use a fresh Claude config and an already available profile; they do not change the normal login.
