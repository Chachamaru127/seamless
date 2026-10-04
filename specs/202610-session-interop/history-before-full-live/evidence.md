# セッション互換通信の証拠

Status: 小型検証コードと接続試験を実施済み。実会話の相互通信は未実証。
最新の証拠は末尾「最新依頼に基づく小型検証」。
Observed: 2026-10-01 JST

## 旧計画時点の承認記録（最新の小型検証依頼が優先）

| 対象 | 状態 | 出典 |
|---|---|---|
| 当初の調査と互換パイプラインの確立 | 依頼あり | この会話のユーザー依頼。team-researchとteam-routeを指定 |
| 機能仕様 | 承認待ち | 非同期質問を提示。回答はまだない |
| 実装計画 | 未承認 | 仕様承認後に具体案を提示する |
| 実会話試験と設定配送 | 未承認 | 対象、文、設定差分が確定した時に示す |

## 実行した読取り確認

| コマンド | 実exit code | 結果 |
|---|---|---|
| `codex --version` | 0 | codex-cli 0.159.3 |
| `codex queue --help` | 0 | thread、message、remote入口あり |
| `codex app-server --help` | 0 | daemon、proxy、schema生成、listen入口あり |
| `codex app-server daemon version` | 1 | control socketが見つからず接続失敗。daemonを開始していない |
| `codex daemon version --help` | 2 | コマンド階層の誤り。正しくはapp-serverを含む |
| `claude --version` | 0 | 2.1.286 |
| 公開Codex tagの`git ls-remote` | 0 | tag objectとpeeled commitを区別して照合 |
| `node --version` | 0 | v22.22.3 |
| `node:sqlite`のDatabaseSync存在確認 | 0 | function。experimental警告あり |

これは機能試験のexit codeではない。CLI helpの成功を相互通信の成功に数えない。
Desktopの版と内部処理の位置はresearch.mdを参照。

## 独立調査

Codex native応援、Grok 4.7、ChatGPT 6 Proの回答を回収した。
Claudeは利用枠停止。別Codex CLIはaccount fingerprint mismatchで使わなかった。
公開API、native機能、Desktop固有のIPCを区別する点が一致した。
Grokの「送り主もClaudeでなければならない」は、公式script投稿の説明と静的実装から断定できず保留した。
独立調査の回答を、実装のPASS判定へ読み替えない。

計画の図面検査はGrok 4.7 highがFAILを返した。詳細はplan-review.md。
最初の7件を修正した案はGrokの再判定PASS。実終了コード0。
その後、Ask Proの10指摘を反映した版をGrok 4.7 highが再検査した。
現在版の計画準備はPASS。CLI実終了コード0。実装完成の判定ではない。
補足1件はT09とT10のDone whenが追加必須ケースを省略している点。該当ケースを追記した。
Ask Proの敵対回答を回収済み。合格判定は依頼していない。
全ACと検証表のID照合は、14/14、コマンドの実exit 0。
これは文書の対応確認であり、AC達成の機能試験ではない。

## AC証拠

AC-01〜14は全て実装検証前。
AC-02〜06、08、13のlive証拠はまだない。
機械試験、実会話試験、完成判定を取得するまで依頼全体は途中である。

## 作業先の版と境界

この作業先は現時点で空から文書を作成した。
Gitの親rootは`/Users/tachibanashuuta/LocalWork/Code`。
claudexの独立repo化、parentへのcommit、pushはしていない。
親の既存未追跡ファイルは変更しない。
既存アプリ設定、秘密値、既存会話本文は収集していない。

route-jobのclean commit一致による検証済み状態は、現時点で付けない。
記録の状態と、この会話における調査結果を分ける。


## 2026-10-01 最新依頼に基づく小型検証

以前の計画準備PASSは旧案の判定。以下の版へは流用しない。
ユーザーが小型検証セット作成を明示。実験はその範囲で実行した。

- `python3 experiments/native-interop/probe.py`: exit 0。3項目PASS。専用の一時会話だけ。本文の読取りではない。
- `python3 experiments/native-interop/claude_probe.py`: 初回runner exit 0。socket_exported=true、socket_exists=true、native_socket_connect=PASS。子processは意図した終了143。空本文であり配送確認ではない。
- `.local/native-interop/venv/bin/python experiments/native-interop/test_contract.py`: exit 0。3件PASS。公式SDKの固定fixture2件と生成schema1件。
- 使用版: Codex 0.159.3、Claude Code 2.1.286、claude-agent-sdk 0.2.163。
- `route-cli --check cc_max:claude-opus-5-5`: quota_exhausted。`--check codex:gpt-6.1-sol`: unverified。モデル往復は実施しなかった。
- Ask Pro gpt-6-proは送信後Unknown error。1回再試行も再生成失敗。今回の回答は回収できなかった。
- Grok grok-4.7 mediumは独立調査と別の読み取り専用レビューを依頼。回収判定は追記する。

固定結果: experiments/native-interop/results/。

Claude probe最終版再実行: runner exit 0、socket接続PASS、子process 143。結果JSONを更新。未確認時はrunner exit 2へ修正済み。


### Codex実モデル配送の追加実験

app-serverのaccount/rateLimits/readでordinaryUsageAllowed=true、利用量35%を確認。認証値やアカウントIDは証拠ファイルへ保存しない。
model/listでgpt-6.1-solを確認。実験だけeffort low。対話中のリーダー設定は変更しない。

1. `python3 experiments/native-interop/codex_delivery_probe.py`: 実exit 1。期待BASE17 PONG17に対しBASE17。接続だけで意図通りに動く仮説への反例。
2. `python3 experiments/native-interop/codex_delivery_probe.py --authorize-peer`: 実exit 0。初期user指示で固定文の外部依頼への応答を許可。BASE17 → BASE17 PONG17。同じthread IDと実行PID。

それぞれ1試行。Claude本人の送信、native著者表示、権限境界、busy、既存Desktopは未検証。
実結果はexperiments/native-interop/results/codex-delivery-*.json。基準条件の失敗は保持した。

### レビュー修正後の再検証

check-exits.jsonに各試験コマンドの実returncodeを保存。Codex接続、Claude隔離接続、3件の固定試験は各exit 0。
Codex応答ephemeral=true/path=nullを確認。Claudeは専用configで接続のみ、本文送信なし。
`python3 experiments/native-interop/codex_delivery_probe.py --authorize-peer` 再実行exit 0。同一ID/PIDで再びBASE17 PONG17。応答ルールあり条件は計2試行PASS。
固定結果はexperiments/native-interop/results/。

最終独立判定: Grok 4.7 medium、実exit 0、APPROVE（実験記録と計画案のみ）。機能全体は未実証。
