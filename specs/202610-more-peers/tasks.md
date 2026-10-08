# 作業単位（1 タスク = 1 ターン。Done when は Yes か No で判定できる 1 行）

Status: 起草（承認 2 回目待ち）
Updated: 2026-10-08 JST

## P0 調査の残り

| # | 作業 | Done when |
|---|---|---|
| T0-1 | Grok の TUI を 1 つ起動し、`~/.grok/active_sessions.json` に行が増え、終了で消えることを見る。項目名と時刻の形を evidence.md に写す | evidence.md に登録と削除の 2 回分の中身がある |
| T0-2 | `[[hooks.Stop]]` に小さな command 型の hook を試験用の作業場所だけに登録し、`additionalContext` を返して、Grok の次の round にその文が読まれることを実測する | Grok の記録（updates.jsonl）に hook_execution の行と、文脈に足した内容に反応した発話がある |
| T0-3 | `~/.grok/bin/grok` の署名を `codesign --verify` で確かめ、開発元の識別子を evidence.md に写す。確かめられなければ「署名で確かめない代わりに何で確かめるか」を Open question に戻す | 識別子が載る、または Open question が更新されている |
| T0-4 | Grok Bot の webhook の事実（1 回の POST の上限、応答の形、順序、再送）を `.local/grok-consult/questions.md` に書き、立花さんに「Grok に聞いて」と頼む | questions.md に 4 問がある |
| T0-5 | MCP Events の一次仕様（2026-07-28 版）を読み、発見、購読、callback、署名の形を evidence.md に写す | evidence.md に 4 項目の引用と出典がある |

## P1 Grok CLI

| # | 作業 | Done when |
|---|---|---|
| T1-1 | 製品の種類に `grok` を足す（型、名簿、席の記録、帯の集計）。既存の試験が全部通る | `bash scripts/verify.sh` が exit 0 |
| T1-2 | Grok の動いている会話の観測（active_sessions.json の読み取り、pid の生存と開始時刻の照合、作業場所の範囲判定）と単体試験 | 偽の名簿で、生きている行だけが一覧に出る試験が通る |
| T1-3 | Grok の本文の読み取り（updates.jsonl の発話の連結と道具の呼び出し。思考と生の履歴は読まない）と単体試験 | 見本の記録から、可視の発話だけが順に出る試験が通る |
| T1-4 | Grok の受信箱と Stop hook のスクリプト（封筒を 1 件 additionalContext にして配達済みへ移す）と単体試験 | 封筒 1 件が JSON で出て、配達済みへ移る試験が通る |
| T1-5 | 送る経路（受信箱へ置く = 受理）と段の観測（hook_execution と受信箱の移動 = 配信確認、次の発話 = 処理開始、replyTo の返信 = 返答完了）と単体試験 | 4 段がそれぞれ Yes になる見本と、待機中で配信確認が立たない見本の試験が通る |
| T1-6 | 帯とパネルに「相手は待機中。次の 1 手の後に届く」を出す | 帯の試験で、配信確認が無い Grok の相手にその言葉が出る |
| T1-7 | 呼び手の特定に Grok CLI の道を足す（祖先の grok の pid と名簿の行の一致、作業場所の一致、署名）。名乗りだけの呼び出しが拒否される試験 | 偽の名簿と偽の祖先で通り、pid が合わない名乗りは `caller_unobserved` になる試験が通る |
| T1-8 | H1 と H5 の差分と手順を立花さんに提示する（config.toml の hook の行、wire.sh の `--mcp-grok`） | 提示した差分に立花さんの可否の返事がある |
| T1-9 | 実会話: Claude → Grok CLI、Codex → Grok CLI、Grok CLI → Claude、Grok CLI → Codex を各 1 回。時刻と段を evidence.md に記録 | 4 本の記録があり、未確認の段が明示されている |
| T1-10 | 判定役（Codex Astra、読み取り専用）に P1 を判定させ、指摘を直す | 判定 PASS が evidence.md にある |

## P2 Grok Bot

| # | 作業 | Done when |
|---|---|---|
| T2-1 | 名簿（`~/.seamless/peers.json`、環境変数の名前だけ）の読み取りと検証（mode 0600、形、失効）と単体試験 | 壊れた名簿と失効した登録が拒否される試験が通る |
| T2-2 | 送る経路（webhook へ POST、受理を HTTP の応答で記録、他の段は未確認）と再送禁止の試験 | 2xx で受理、切断で成否不明、実行回数 1 のままの試験が通る |
| T2-3 | 受ける経路（`send --as <登録名>` の HMAC 検証、nonce の記録）と 5 種の拒否の試験 | 鍵なし、別の鍵、失効、再提示、範囲外がそれぞれ拒否される試験が通る |
| T2-4 | 認可の範囲（未設定、壊れた設定、範囲外の名指しの拒否）と、受信後に承認設定と sandbox が変わらない比較の試験 | 3 条件の拒否と、設定の前後比較の試験が通る |
| T2-5 | 返信の対応と循環の試験（replyTo の結び付け、返信の受信後 10 分で依頼が増えない） | 試験が通る |
| T2-6 | H2〜H4 の手順と名簿の雛形を提示する（鍵の値は書かない） | 提示に立花さんの可否の返事がある |
| T2-7 | 実送信: Claude → 茶々丸、Codex → 茶々丸、茶々丸 → Claude、茶々丸 → Codex を各 1 回。時刻と段を evidence.md に記録 | 4 本の記録があり、未確認の段が明示されている |
| T2-8 | 判定役（Codex Astra、読み取り専用）に P2 を判定させ、指摘を直す | 判定 PASS が evidence.md にある |

## P3 Dot

| # | 作業 | Done when |
|---|---|---|
| T3-1 | T0-5 の結果から、spec に Dot の AC（購読の保持、署名つき配送、Dot の宛先と呼び手の鍵）を追記する | spec の AC に Dot の行が 3 つ以上ある |
| T3-2 | 敵対（Astra）に Dot の AC の穴探しをさせ、直す | 指摘の反映が evidence.md にある |
| T3-3 | 立花さんに別途の承認を求める | 承認の記録が spec にある |

## 共通

| # | 作業 | Done when |
|---|---|---|
| TC-1 | 既存の Claude⇄Codex の実往復を各工程の後に 1 回行い、壊れていないことを記録（AC10） | evidence.md に往復の記録がある |
| TC-2 | GOD_Plans.md と Plans.md（ルート）の状態を今の状態に直す | 2 つのファイルの状態の行が最新のコミットを指す |
