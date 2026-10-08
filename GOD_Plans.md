# claudex の進行台帳

> 2026-10-04 に claudex から seamless へ改名した（独立リポジトリ）。本文の claudex、`~/.claudex`、実行したコマンドは記録当時の旧名のまま残す。

更新: 2026-10-02 JST

| 機能 | 状態 | 仕様 | 計画 | 証拠 |
|---|---|---|---|---|
| CodexとClaudeの元会話をつなぐ | 実会話とDesktop方式検証完了。実装計画の独立判定APPROVE | [仕様](specs/202610-session-interop/spec.md) | [計画](specs/202610-session-interop/Plans.md) | [証拠](specs/202610-session-interop/evidence.md) |
| Grok CLI、Grok Bot、ChatGPT Dot へ広げる | 2026-10-08 承認 2 回目。P1 の一覧、読む、呼び手、認可を実装（verify exit 0、図面検査 PASS、実地検査 一致）。Grok へ送る部分は H0 待ち、P2 は茶々丸の答え待ち、P3 は Dot の受け入れ条件の承認待ち | [仕様](specs/202610-more-peers/spec.md) | [計画](specs/202610-more-peers/Plans.md) | [証拠](specs/202610-more-peers/evidence.md) |

| 両方向のセッション探索 P1 | 66試験PASS、verify実終了0。最終66試験版のHaiku / Opus独立判定PASS。P1共通核完了。当時のP1単独起動。nativeモードの最新検収は製品検証を参照 | [仕様](specs/202610-session-discovery/spec.md) | [計画](specs/202610-session-discovery/Plans.md) | [証拠](specs/202610-session-discovery/evidence.md) |

製品完成は実装後の受入試験と独立判定がそろった時点。今回の方式検証とは別に扱う。

2026-10-02 製品接続の最新検収: [既存会話ペアの証拠](specs/202610-session-interop/product-evidence.md)。起動済みの双方の元会話でread/send/replyを観測。最終配送再判定と機械検証を実施中。過去の方式検証と、今回の製品実装の証拠を分けて記録する。

最終更新: 既存ペアの5操作を実会話で検収完了。100試験PASS/実終了0、strict終了0、source hash前後一致。read APPROVE、配送Opus PASS（重大0/中0）、図面Haiku PASS。[製品検証](specs/202610-session-interop/product-evidence.md)が現行状態。常用MCP設定導入は未実施で今回範囲外。
