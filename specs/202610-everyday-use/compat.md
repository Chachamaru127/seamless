# 対応の組

生成元: `src/compat.ts`。更新: `node src/cli.ts compat-md`。

表にない版も既定で使い、未確認と表示します。checking と版が読めない場合も同様です。Desktop の接続が通らないときは未確認（Desktop、`unverified_desktop`）と表示します。strictVersions:true のときだけ verified に限ります（compat-check は checking も試験できます）。fix_required と未知の状態は常に止めます。更新後の動作は保証しません。

| product | version | connection | status | checkedAt | checks |
|---|---|---|---|---|---|
| claude-code | 2.1.284 | desktop | verified | 2026-10-02 | identity, read, send, reply |
| claude-code | 2.1.286 | desktop | verified | 2026-10-03 | identity, read, send, reply |
| claude-code | 2.1.287 | desktop | checking | 未確認 | 未確認 |
| codex | 26.928.31416+12553 | desktop | verified | 2026-10-01 | owner, read, send, reply |
| codex | 26.928.40906+12694 | desktop | verified | 2026-10-02 | owner, read, send, reply |
| codex | 26.930.31730+12947 | desktop | verified | 2026-10-04 | owner, read, full-history, send |
| grok | 1.0.46 | cli | checking | 未確認 | 未確認 |
| claude-code | 2.1.303 | desktop | checking | 2026-10-19 | 未確認 |
| codex | 0.163.0 | cli | checking | 2026-10-19 | 未確認 |
| codex | 26.1013.40934+20770 | desktop | checking | 2026-10-19 | 未確認 |
| opencode | 2.0.32 | cli | checking | 2026-10-19 | 未確認 |
| cursor | 2026.10.17 | cli | checking | 2026-10-19 | 未確認 |
| antigravity | 1.1.1 | cli | checking | 2026-10-19 | 未確認 |
| grok | 1.0.62 | cli | checking | 2026-10-19 | 未確認 |
