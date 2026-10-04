# 状態の帯のタスク

| ID | 段 | 中身 | 依存 | 担当 | Done when |
|---|---|---|---|---|---|
| U1 | 土台 | `mods/seamless-band/` の雛形と whats-agent-doing（1efd306、MIT）の取り込み。出典と LICENSE を残す | なし | Codex Astra（第13便） | `claude plugin validate` がエラー0 |
| U2 | 左半分 | 6つの状態の日本語と秒の経過時間 | U1 | 同上 | 状態ごとの試験が通る |
| U3 | 右半分 | seamless の照会、会社ごとの回数と色、失敗時の灰色 | U1 | 同上 | 色の表の各行と失敗時の試験が通る |
| U4 | 開いた状態 | 手順の履歴と相手ごとの一覧 | U2、U3 | 同上 | 開いた状態の描画の試験が通る |
| U5 | 安全 | 制御文字と不可視文字の除去、表示だけ | U2、U3 | 同上 | 除去の試験が通り、validate の calls が ui、clock、state、agent.list、process.run だけ |
| U6 | 試験 | `claude plugin test` と validate を verify.sh に組み込む | U1〜U5 | 同上 | verify.sh 終了 0 |
| U7 | 実地 | ターミナルの1セッションで撮影 | U6 | リーダーと立花さん | evidence.md に撮影と観測 |
| U8 | 導入 | 普段のセッションへ（G5） | U7 | リーダー（承認後） | 新しいセッションの `/plugin` に `seamless-band` |
| U9 | Code タブ | Desktop の Claude Code が 2.1.287 以上になってから確認 | U8 | 外部条件待ち | Code タブの撮影 |
