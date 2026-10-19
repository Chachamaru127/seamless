# 調査依頼（読み取り専用。コードを書かない。ファイルを変更しない）

## 目的
seamless（1台のMacの中で、Claude Code、Codex、Grok CLI、Grok Bot の「いま開いている会話」へ一言を届ける OSS の配線）を、競合 Reason Network（reasonmachines.com/network、github.com/reason-machines/reason-network）より上の製品にするための判断材料を集める。

## 対象の版
- seamless 現行: /Users/tachibanashuuta/LocalWork/Code/seamless main 87a4162。spec.md、README.md、specs/2026-10-universal-wiring/drafts/consolidated-plan.md（統合プラン v2、承認前）を読んでよい。
- Reason Network: 公開資料（公式サイト、docs.reasonmachines.com/docs/network、GitHub の README と DESIGN.md、issues、2026-10-19 時点）。

## 既に分かっていること（前提。再調査しなくてよい）
- Reason: 端末ごとに1デーモン、iroh（ed25519 鍵、QUIC、LAN 直結 → ホールパンチ → n0 中継）、署名つき名簿（team→person→machine→session）、push/turn/pull の3段配送、accept/hold/refuse、loop guard、ask_user、outbox と1日の郵便箱、SQLite。エンジンは MIT OR Apache-2.0、`reason` CLI は非公開。Claude Code への push は Claude の内部 inbox socket 経由。アカウントなしの team link モードあり。M4（ファイル衝突警告、web dashboard）は未着手。
- seamless 現行: 常駐なし、本文を保存しない、予約ファイルで二重送信を防ぐ、4段階の証拠（受理、到達、処理開始、返答完了）、同じMac限定、Claude の内部 socket と Codex Desktop の IPC に依存、Grok Bot は webhook で往復済み。
- 前回の採点（公開資料ベース）: セキュリティとオンラインの総合で Reason 4.15、seamless 現行 3.37、統合プラン v1 予測 3.84。

## 問い（この3つに答える。推測は「推測」と書く）
1. Reason が持っていて seamless が持たない価値のうち、個人と2〜5人の小チームに実際に効くものはどれか。逆に、Reason の設計上変えにくい弱点（たとえば Claude の内部 socket 依存、1日で消える郵便箱、人ごとの権限がない、承認署名が「speed bump」、50台上限、CLI 非公開）は何か。
2. 公式の押し込み経路（Claude Code Channels [code.claude.com/docs/en/channels と channels-reference]、Codex app-server / `codex queue`、opencode plugin、A2A v1.0）を使えば、Reason より壊れにくく、同等以上に速い配線が作れるか。各経路の公式性、制約（research preview、allowlist、認証条件）、配送段階を出典つきで書く。
3. 利用者が Reason から乗り換える、または併用する決め手は何か。GitHub issues、X、ブログ、Hacker News、Reddit などで、Reason Network や類似ツール（agmsg、claude-swarm、tincan など）への不満と要望を集める。出典 URL と日付を付ける。

## 書き方
- 事実、仮説、未確認を分ける。事実には出典（URL、日付）を付ける。
- 「Reason を超える」ための具体案を、最大5つ、優先順に。各案に「本質」「何が変わるか（前→後）」「根拠」「危険」を1〜2行ずつ。
- 日本語。3000字以内。先頭に結論3行。
