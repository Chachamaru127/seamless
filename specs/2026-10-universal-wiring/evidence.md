# universal-wiring: 終わった証拠

状態: 2026-10-19 起草。空。各 AC の証拠は、検証コマンドの実出力と終了コード、日付、版を付けてここに足す。自己申告は書かない。

## 計画の判定

| 日付 | 対象 | 役 | モデル | 判定 | 記録 |
|---|---|---|---|---|---|
| 2026-10-19 | spec.md、Plans.md、tasks.md（改訂 1） | 図面検査 | claude-haiku-5-5 | FAIL（37 件。改訂 2 で反映） | drafts/review-haiku-v3.md |
| 2026-10-19 | 同上（改訂 1） | 敵対 | gpt-6-astra（xhigh） | 指摘あり（下の「敵対の指摘」） | drafts/review-astra-v3.md |

## AC の証拠

| AC | 日付 | コマンド | 終了コード | 観測値 | 版 |
|---|---|---|---|---|---|
| （未） | | | | | |

## 実機の事実（計画の根拠。2026-10-19）

- Claude Desktop の対話セッション 11 件が `~/.claude/sessions/<pid>.json` に `messagingSocketPath: /tmp/cc-socks/<pid>.sock`、`kind: interactive`、`entrypoint: claude-desktop`、`peerProtocol: 1` を持つ。`lsof -U` で同じ socket が開いている。
- T3 Code が起動した `claude --output-format stream-json`（pid 10142、88557）には sessions JSON も socket も無い。
- `codex queue --help`（codex-cli 0.163.0）: `--thread <UUID|名前> --message <TEXT>`、`--remote`。
- `cursor-agent` 2026.10.17-1b98cdc。`~/.cursor/hooks.json` に sessionStart、stop、afterAgentResponse などの hooks。`~/.cursor/chats/<ws>/<session>/meta.json`。
- Antigravity CLI: 実行ファイルは T3 Code が管理する `~/.t3-ja/tools/antigravity-acp/` 配下（ACP 版 1.1.1、2026-10-19 本人確認「T3 Code 経由で入っている」）。会話と設定は `~/.t3-ja/userdata/providers/antigravity/<hash>/`。PATH には無い。データは `~/.gemini/antigravity-cli/`。
- 承認: 2026-10-19 立花さん「承認」（spec.md と Plans.md の 2 回分）。
- opencode v2.0.32。`~/.config/opencode/opencode.json`。

## 敵対の指摘（Codex Astra xhigh、2026-10-19、改訂 1 に対して 16 件）の扱い

採用（改訂 3 で AC / S / H を変えた）: AC8（滞留は配達まで、標本観測）、AC12（内部依存を 2 種に分け H6 を公開条件に）、AC14 / AC15（未実測と明記）、S8（90 分超、休止の印）、S9（外部接続の観測）、H7（別家系の判定後に閉じる、依存先が閉じるまで取らない、統合ブランチ）、Plans 1 章 2（渡ったの生成元、読取り失敗と拒否の区別）、Plans 6 章（排他ロック、依存、T12 先行）、AC9 の基準（親 commit との差分）、AC13 の分母。
採用（文言のみ）: AC1 の実導入、T19 の経路横断の重複、T10 の受信箱の削除、T15 の compare、T17 の依存。
見送り: 「`ps` と `lsof` の瞬間観測では否定できない」→ 1 秒標本に変えた上で、完全な否定は目標にしない（AC8 は観測値の記録であり証明ではない）。
要確認（本人）: Antigravity の実行ファイル（未決 3）。

## 30 分ループの登録（H7）

- 2026-10-19 19:16 JST: T3 のスケジュール `seamless 30分ループ（Issue を1件ずつ施工）`、30 分ごと、この会話に紐づけ。次回 19:46 JST。
- GitHub Issues #1〜#20（T12 が #1、T16 は loop:human）。統合ブランチ `loop/integration` = main c1d582d。
| 2026-10-19 | 改訂 3（a8065c8） | 図面検査 2 回目 | claude-haiku-5-5 | FAIL（20 件。改訂 4 で反映。AC の意味は変えず、文言、対応、不変条件 8 のルート改訂 2） | drafts/review-haiku-v3-r2.md |

承認した版: spec.md と Plans.md の承認（2026-10-19「1. 承認」）は改訂 3（commit a8065c8）に対するもの。改訂 4 は文言の整合と、ルート spec.md の不変条件 8 の改訂 2（同じ Mac の対象製品に opencode、Cursor CLI、Antigravity CLI を追加）。不変条件 8 の改訂 2 は、本人の「opencode / Cursor CLI / Antigravity CLI を入れて」の指示を製品の不変条件に反映したもので、承認済みの範囲内と扱う。

## 実装ループの判定

| 日付 | Issue | 版 | 施工 | verify | 図面検査（Haiku 5.5） | 判定（Codex gpt-6-astra） | 結果 |
|---|---|---|---|---|---|---|---|
| 2026-10-19 19:52 | #1 T12 hermetic CI | d61cb9b | opencode deepseek-v4.1-flash:1017（2 回。2 回目で CI に @types/node） | 0（720 pass） | 項目 2、3 Yes。1 はリーダーの実行証拠で判定 | PASS（3 項目 Yes） | 閉じて loop/integration へ merge（45b790d）。残件: GitHub Actions 上の実走は未確認（push 後） |
| 2026-10-19 20:33 | #2 T01 対応表 | 8b39ec7 | opencode deepseek-v4.1-flash:1017（1 回目は出力 0 バイトで打ち切り、見張りを付けて再実行、210 秒） | 0（723 pass） | 1 回目 FAIL（Done when「5 列」の文言。6 列は既存の checks 列）→ 文言を直して 2 回目 PASS | PASS（3 項目 Yes） | 閉じて merge（b7a7199）。残件: fix_required より先に Desktop 失敗の分岐があり、fix_required でも unverified_desktop になる → #21 を起こした。desktopConnection の配線は #9 へ |
| 2026-10-19 20:40 | #3 T02 Claude アダプタ | 97e921b | opencode deepseek-v4.1-flash:1017（110 秒） | 0（728 pass） | 食い違いなし | PASS（3 項目 Yes） | 閉じて merge（d4fc8f7）。残件: reachable は JSON の欄の判定で、socket の実在と生存は native-runtime 側の照合（既存）に任せる |
| 2026-10-19 20:48 | #4 T03 codex queue | a6c88b3 | opencode deepseek-v4.1-flash:1017（180 秒） | 0（734 pass） | 食い違いなし | PASS（3 項目 Yes） | 閉じて merge。残件 2 件を Issue に: writeCodexMessage が製品の送信経路に接続されていない（#22）、数値の終了コードを一律に送信前失敗として IPC へ退避する（#23） |
| 2026-10-19 20:52 | #5 T19 不明と二重送信 | bbe7216 | opencode deepseek-v4.1-flash:1017（90 秒） | 0（736 pass） | 食い違いなし | PASS（5 項目 Yes） | 閉じて merge。残件: 実プロセスの強制終了で pending が残る場合は試験外（予約の仕組みは既存の挙動のまま） |
| 2026-10-19 21:03 | #6 T04 段階と保留中 | 7d9d72f | opencode deepseek-v4.1-flash:1017（510 秒、10 ファイル） | 0（739 pass） | PASS（残件: 検索語の引用符、定数の重複） | PASS（3 項目 Yes） | 閉じて merge。残件: 保留理由を製品名だけで決めていて観測していない → #24 を起こした |
| 2026-10-19 21:14 | #7 T15 計測スクリプト（1 回目） | 687ddcf | opencode deepseek-v4.1-flash:1017（490 秒） | 0（739 pass） | （記録なし） | FAIL（項目 5 No: footprint の対象選別が部分一致） | 直し方を Issue に追記して再施工へ |
| 2026-10-19 21:20 | #8 T05 1 コマンド | 909e1cc | opencode deepseek-v4.1-flash:1017（150 秒） | 0（744 pass） | 食い違いなし | PASS（3 項目 Yes） | 閉じて merge。残件: 実作業場所から候補抽出→短縮コマンドまでの一連は未検証（AC3 の実相手の計測で確かめる） |
| 2026-10-19 21:27 | #7 T15（2 回目） | 6747c89 | opencode deepseek-v4.1-flash:1017（170 秒） | 0（745 pass） | （記録なし） | FAIL（項目 5 No: 今度は厳しすぎて node のオプション付き起動と grok-hook を除外） | 対象の定義を Issue に書いて 3 回目へ。3 回目も FAIL なら人の確認 |
| 2026-10-19 21:35 | #7 T15（3 回目） | 930d211 | opencode deepseek-v4.1-flash:1017（170 秒） | 0（746 pass） | （記録なし） | FAIL（項目 5 No。ただし反例はリーダーの定義の穴で、施工は定義どおり） | 定義を「node のオプションを読み飛ばした最初の引数の realpath」に確定して 4 回目 |
| 2026-10-19 21:43 | #7 T15 計測スクリプト（4 回目） | fe54a77 | opencode deepseek-v4.1-flash:1017（130 秒） | 0（747 pass） | （記録なし） | PASS（6 項目 Yes） | 閉じて merge。残件: `batch --out` で既存ファイルを指定すると上書き（Done when 外。README の注意で足りる） |
| 2026-10-19 21:52 | #9 T20 who --json 3 状態 | 24d2bf9 | opencode deepseek-v4.1-flash:1017（440 秒） | 0（756 pass） | 食い違いなし | PASS（5 項目 Yes） | 閉じて merge。残件: ready は記録の socket 欄と idle の判定で、接続成功は native-runtime の照合に任せる |
| 2026-10-19 22:00 | #10 T06 setup / doctor | 5a2ed2b | opencode deepseek-v4.1-flash:1017（300 秒） | 0（764 pass） | 食い違いなし | PASS（4 項目 Yes） | 閉じて merge。残件: socket パスの文字列だけで online と判定（接続は native-runtime が照合）、登録比較が type を見ない（軽微。T11 の manifest 移行で一緒に直す） |
| 2026-10-19 22:10 | #11 T11 manifest 基盤 | bdd193c | opencode deepseek-v4.1-flash:1017（330 秒） | 0（798 pass） | 食い違いなし | PASS（4 項目 Yes） | 閉じて merge。残件: 登録簿が実際の一覧と送信から呼ばれていない → #25 を起こした |
| 2026-10-19 22:22 | #12 T07 opencode plugin | f20ac2c | opencode deepseek-v4.1-flash:1017（600 秒、813 行） | 0（801 pass） | 食い違いなし | PASS（3 項目 Yes） | 閉じて merge。残件: `src/manifests/opencode.json` が無い（Done when 外）、エラー応答を成功扱い、並行保存の重複 → #26 を起こした。実 opencode との適合は AC10（人の作業） |
| 2026-10-19 22:33 | #13 T08 Cursor CLI | 30e8ac4 | opencode deepseek-v4.1-flash:1017（420 秒、806 行） | 0（813 pass） | 食い違いなし | PASS（3 項目 Yes） | 閉じて merge。残件: `src/manifests/cursor.json` が無い → #27 を起こした。実 Cursor での取り込みは AC2 / AC3 の実相手の計測で |
| 2026-10-19 22:45 | #14 T10 Grok CLI manifest | 0acdeae | opencode deepseek-v4.1-flash:1017（330 秒） | 0（816 pass） | 食い違いなし | PASS（4 項目 Yes） | 閉じて merge。残件: 配達記録の保存と封筒削除が別操作で、間の異常終了で本文が残る → #28 を起こした |
| 2026-10-19 22:56 | #15 T09 Antigravity | cb3084b | opencode deepseek-v4.1-flash:1017（380 秒） | 0（820 pass） | 食い違いなし | PASS（3 項目 Yes） | 閉じて merge。残件: listAntigravity が who の一覧に接続されていない（#25 の登録簿の配線で一緒に扱う） |
| 2026-10-19 23:05 | #16 T17 T3 相性 | 5efa151 | opencode deepseek-v4.1-flash:1017（270 秒） | 0（827 pass） | 食い違いなし | PASS（3 項目 Yes） | 閉じて merge。残件: T3 実画面での html_render と実 Claude の検出は AC14 / AC15 の人の作業 |
| 2026-10-19 23:15 | 並列 wave 1（#17 #18 #21 #22 #26 #28） | 各 worktree | opencode deepseek-v4.1-flash:1017（6 並列、各 verify 0） | 0 | — | 1 回目の判定は無効（判定 script の worktree 対応版が main に無く、本線の古い verify.sh で実行検査が落ちた） | script を直して再判定 |
| 2026-10-19 23:35 | #18 T14 README / LICENSE | 402256a | 並列 wave 1 | 0 | — | PASS（3 項目 Yes。1 は静的判定） | 閉じて merge（a1d0f11） |
| 2026-10-19 23:35 | #21 T01b fix_required 優先 | 8d234fb | 並列 wave 1 | 0 | — | PASS（3 項目 Yes） | 閉じて merge（6013ce0） |
| 2026-10-19 23:35 | #17 T13、#26 T07b | d5061a6、dba1b47 | 並列 wave 1 | 0 | — | FAIL（Done when の文言: #17 は grep が定義ファイル自身に当たる、#26 は「4 製品」が grok-cli 追加で 5 製品） | 文言を直して再判定 |
| 2026-10-19 23:35 | #22 T03b、#28 T10b | a7a3790、0c82cbb | 並列 wave 1 | 判定時 1（並列 verify の不安定。順番に走らせると 0） | — | FAIL（#22: limits 未渡し。#28: 偽の fs 試験なし、全ファイル検査なし） | 直し方を追記して再施工。判定時の verify は順番に走らせる形に変更 |
| 2026-10-19 23:50 | #26 T07b opencode manifest 他 | dba1b47 | 並列 wave 1 | 0（822 pass） | — | PASS（4 項目 Yes。1 は「5 製品」に文言を直して 3 回目） | 閉じて merge（7003cc8）。残件: 保存と取り出しが重なる隙間は #25 で |
| 2026-10-19 23:55 | #17 T13 公開面（3 回目） | d5061a6 | 並列 wave 1 | 0 | — | FAIL（項目 3: grep が docs/ specs/ の説明文に当たる。残件に実害: 同梱物の src/mcp.ts が除外した status-panel.ts を参照） | Done when を公開物に限定し、依存の検査（pack-check）を足して再施工 |
| 2026-10-20 00:05 | #22 T03b queue を送信経路へ | fdadc22 | 再施工（worktree、190 秒） | 0（824 pass） | — | PASS（5 項目 Yes） | 閉じて merge（2f683b3） |
| 2026-10-20 00:05 | #28 T10b 受信箱の原子性 | 47937cb | 再施工（worktree、340 秒） | 0（823 pass） | — | PASS（3 項目 Yes） | 閉じて merge（f8bb818） |
| 2026-10-20 00:20 | #23 T03c 終了コードの扱い | ea23efe | 並列 wave 2a（worktree） | 0（838 pass） | — | PASS（3 項目 Yes） | 閉じて merge（b784edc）。残件: stderr の「usage」判定は実 CLI で未検証 |
| 2026-10-20 00:20 | #25 T11b 登録簿の配線（1 回目） | dee523b | 並列 wave 2a（worktree、440 秒） | 0（841 pass） | — | FAIL（項目 1: 試験が外すのは既存の codex manifest で、偽の manifest ではない） | Done when を「既存または偽の manifest」に直して再判定 |
| 2026-10-20 00:40 | #25 T11b 登録簿の配線（2 回目） | dee523b | 並列 wave 2a | 0（841 pass） | — | PASS（4 項目 Yes。1 は「既存または偽の manifest」に文言を直した） | 閉じて merge（0d46ea5）。残件 3 件 → #29 |
| 2026-10-20 00:40 | #17 T13 公開面（4 回目） | dba25a3 | 再施工（worktree） | 0 | — | FAIL（項目 2: peer-secrets.sh の 0 件は判定役の環境では確かめられない） | リーダーが worktree で peer-secrets.sh を実行して証拠に添え、再判定 |
| 2026-10-20 01:00 | #17 T13 公開面（5 回目） | dba25a3 | 再施工（worktree） | 0（820 pass） | — | PASS（6 項目 Yes。2 はリーダーが worktree で peer-secrets.sh を実行した ok を採用） | 閉じて merge（c5d1e76）。残件: pack-check の .js→.ts の許容、docs/release.md:136 の検索例 |
| 2026-10-20 01:00 | #24 T04b 保留理由の観測（1 回目） | a850cce | 並列 wave 2b（worktree） | 0 | — | FAIL（項目 1: 受信側 bypassPermissions だけで claude_hold にする。ただし公式文書どおりの hold 条件で、Done when の文言が狭すぎた） | 文言を直して再判定 |
| 2026-10-20 01:12 | #24 T04b（2 回目） | a850cce | 並列 wave 2b | 0 | — | FAIL（項目 2: Codex の goal 観測が activeTurnId だけで真を返す。通常ターンでも codex_goal になる） | 観測を goal 固有の情報に限る指示を Done when に書いて再施工 |
| 2026-10-20 01:12 | #27 T08b Cursor manifest（1 回目） | d9671b5 | 並列 wave 2c | 0（843 pass） | — | FAIL（項目 1: 「5 製品」の文言。cursor を足して 6 製品が正） | 文言を直して再判定 |
| 2026-10-20 01:25 | #27 T08b Cursor manifest（2 回目） | d9671b5 | 並列 wave 2c | 0（843 pass） | — | PASS（3 項目 Yes。1 は「6 製品」に文言を直した） | 閉じて merge（fbbfa27） |
| 2026-10-20 01:40 | #19 T18 npm pack と公開手順 | 5bd5d83 | 並列 wave 3 | 0（842 pass） | — | PASS | 閉じて merge（3f8e7f1）。残件: docs/release.md:190 の「queue 未接続」の記述が古い（#22 で接続済み）、`private: true` と `bin` 未設定は H5 の後に外す |
| 2026-10-20 00:20 | #24 T04b 保留理由の観測（3 回目） | 18ff101 | 再施工（worktree） | 0 | — | PASS（4 項目 Yes。通常ターンは unknown_reason） | 閉じて merge |
| 2026-10-20 00:35 | #29 T11c 登録簿の配線の残り | 2fa609a | 並列 wave 3（worktree、580 秒） | 0（844 pass） | — | PASS（4 項目 Yes） | 閉じて merge。これで open は #20（人の作業）だけ |

## ループの集計（2026-10-19 19:30 〜 2026-10-20 00:35）

- Issue 29 件（計画 19 + 判定役の残件から派生 10）。判定 PASS 28 件、人の作業 1 件（#20）。
- 判定 FAIL 10 回: 実装の欠陥 5 回（#7 ×2、#17、#24、#28）、リーダーの完了条件の文言 5 回（#2、#7、#17、#26、#27）。すべて直して PASS。
- 判定の無効回 1 回（並列 wave 1。判定 script の worktree 対応版が main に無かった）。
- 施工役: opencode（Ollama Cloud deepseek-v4.1-flash:1017）。1 件 90〜600 秒。出力 0 バイトで固まった回が 1 回（見張り 20 分で対処）。
- 統合ブランチ loop/integration は main に対し 79 ファイル以上、約 6,400 行の追加。main には書類と script だけ。push、PR、公開は H5、H6 の後。
