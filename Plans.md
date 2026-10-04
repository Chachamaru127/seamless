# claudex

> 2026-10-04 に claudex から seamless へ改名した（独立リポジトリ）。本文の claudex、`~/.claudex`、実行したコマンドは記録当時の旧名のまま残す。

元のCodex会話とClaude会話を、共通のsessions/read/sendでつなぐ。
共有SQLiteなし。agmsgのforkなし。既存の会話と実行体を維持する。

- [実装計画](specs/202610-session-interop/Plans.md)
- [実測と合否](specs/202610-session-interop/evidence.md)
- [作業単位と依存](specs/202610-session-interop/tasks.md)
- [独立判定](specs/202610-session-interop/plan-review.md)

方式検証はCLI実会話17項目、境界の追加観測7項目、抽出と履歴判定の回帰6項目、既存Desktopの相互読取りと両方向配送まで完了。独立判定APPROVE。
完成版の共通MCPをDesktopへ組み込む作業は、実装計画の工程4–5。

2026-10-02: 対称な相手探索の追加仕様を承認範囲として、[探索実装計画](specs/202610-session-discovery/Plans.md)へ進む。今回の完成単位は既存計画P1の登録と探索。通信本体のP2〜P6は別に検収する。

P1の最新状態: 66試験PASS、verify実終了0。最終66試験版のHaiku / Opus独立判定PASS。P1共通核完了。当時のP1単独起動はnative観測器未接続。下記の追加承認でnativeモードを接続。

2026-10-02 追加承認: 起動済み「接続確認」のClaudeと現Codex会話を連携し、P2以降の製品接続を進める。担当とパスは機能tasks.mdのP2-live〜P6-liveに記録。実会話の初回往復は確認済み。製品窓口からの往復と独立判定は作業中。

2026-10-02 製品接続の最新検収: [既存会話ペアの証拠](specs/202610-session-interop/product-evidence.md)。起動済みの双方の元会話でread/send/replyを観測。最終配送再判定と機械検証を実施中。過去の方式検証と、今回の製品実装の証拠を分けて記録する。

最終更新: 既存ペアの5操作を実会話で検収完了。100試験PASS/実終了0、strict終了0、source hash前後一致。read APPROVE、配送Opus PASS（重大0/中0）、図面Haiku PASS。[製品検証](specs/202610-session-interop/product-evidence.md)が現行状態。常用MCP設定導入は未実施で今回範囲外。
