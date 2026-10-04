# Git observer worker verification

2026-10-02 JST. Owned paths: src/git-context.ts, tests/git-context.test.ts, this evidence.

- Before implementation: node --test tests/git-context.test.ts exit 1, ERR_MODULE_NOT_FOUND (expected red phase).
- First implementation run: exit 1. Fixture passed full ref to worktree add, yielding detached HEAD; corrected fixture to short branch. Redaction assertion matched /private in legitimate workspace path; changed assertion to exact injected secret marker.
- Final node --test tests/git-context.test.ts: exit 0, 3 tests PASS, 0 FAIL. Actual temporary repos cover attached/linked different branch/forced same branch/separate repo/separate clone/detached/unborn/no Git/symlink/untracked/GIT_DIR immunity/index mtime/filter and fsmonitor nonexecution. Injected runner covers timeout and failure.

GitContext is exported directly; no dependency on protocol.ts. git argv: --no-optional-locks, core.fsmonitor=false, inherited GIT_* stripped, timeout 5000ms and maxBuffer 1048576 bytes. Configured filter names only are read, their values are not read or returned; clean/process are disabled and required=false before status. Submodule contents are ignored. Errors expose fixed reason codes only.

Limitations: multi-command Git observation is best-effort, not an atomic snapshot. Timeout path is covered using injected error, not a deliberately slow executable. No actual native session health is inferred. Parent repository was not committed or modified. Temporary fixture repositories remain in OS temporary directory; no product files were deleted. Node warns about ancestor package module type; no ancestor package was changed.

## Follow-up tightening

Latest node --test tests/git-context.test.ts exit 0, 4 PASS, 0 FAIL. Actual default runner timeout fixture supplies temporary executable via PATH which execs /bin/sleep 30; observer killed it at approximately 5004ms and returned timeout. Earlier injected-only limitation is superseded.

LC_ALL=C stabilizes Git error recognition; inherited GIT_* removed then GIT_OPTIONAL_LOCKS=0 explicitly added. Workspace must be a directory. no_git requires exit128 and known fatal not-a-git-repository stderr. HEAD^{commit} verified quietly; absent attached HEAD is unborn only when show-ref --exists returns2 (observed Git2.50.1). Other head failures remain unknown. Untracked discovery uses normal mode, sufficient for dirty boolean including untracked directories.
