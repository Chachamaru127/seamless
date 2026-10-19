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
