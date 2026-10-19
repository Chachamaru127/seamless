あなたは図面検査役です。合意した計画や書類と食い違う所を、行間を読まずに差し戻してください。推測で補わないでください。

# 計画の判定依頼（読み取り専用。ファイルを変更しない。コードを書かない）

対象: /Users/tachibanashuuta/LocalWork/Code/seamless の specs/2026-10-universal-wiring/{spec.md, Plans.md, tasks.md, evidence.md}。
根拠資料: 同フォルダの drafts/research-v3-beyond-reason.md と drafts/consolidated-plan-v3-beyond-reason.md。ルートの spec.md（製品の不変条件 1〜8）。
版: git main 87a4162 + 未コミットの上記ファイル（2026-10-19）。

## 判定の線（この番号に結び付けて指摘する）
- AC1〜AC16（spec.md）、停止条件 S1〜S7、Human gates H1〜H7、Open decisions 1〜3（Plans.md 7 章）。
- FAIL は「どの AC / S / H が、どう判定不能か、または抜けているか」を番号で書く。番号に結び付かない指摘は「その他」に分ける。
- 合格は出さない（敵対）。図面検査は「食い違い」だけを返し、行間を読まない。

## 確かめること（Yes / No で答える）
1. すべての AC に、Plans.md 8 章の検証コマンドと tasks.md のタスクが対応しているか。対応の無い AC を番号で挙げる。
2. tasks.md の各 Done when は Yes / No で判定できるか。「いい感じ」「ちゃんと」に当たる表現を挙げる。
3. 停止条件 S1〜S7 は、どの AC が落ちたときに発動するか明確か。
4. Human gates のうち「決定済み」としたものは、本人の指示（2026-10-19: オンライン機能なし、opencode / Cursor CLI / Antigravity CLI を v1 に、Codex Desktop IPC 継続、Reason は同じ OS ユーザー、Issue + 30 分ループ、施工は DeepSeek 1017）と食い違っていないか。
5. 製品の不変条件（ルート spec.md 1〜8）を Plans.md が定義し直していないか。
6. spec.md にスタック、ライブラリ、ファイルパスが混ざっていないか（spec.md は「何を、なぜ」だけ）。
7. T3 Code との相性（spec AC14〜AC16、Plans 4 章）に、実機の事実（evidence.md）と矛盾する主張が無いか。

## 返し方
- 先頭に判定（図面検査: PASS / FAIL / 判定不能。敵対: 指摘の件数と重大度）。
- 指摘は「番号 / 何が / どう直すか（1 行）」。日本語、2,500 字以内。
- 判定の後に、確かめること 1〜7 の Yes / No を並べる。
