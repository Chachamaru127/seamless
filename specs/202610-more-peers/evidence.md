# 証拠（seamless を Grok CLI、Grok Bot、ChatGPT Dot へ広げる）

## 2026-10-08 計画（team-plan、大きさ L）

- リーダー: この会話（Claude Fable 5.1、立花さんの選択のまま。route-shift は L のため Opus 5.5／high を示したが、Desktop では本人が選ぶ）。
- 手元で確認した事実（Grok CLI 1.0.46）: 会話は `~/.grok/sessions/<作業場所>/<会話 ID>/` に要約、更新の流れ、生の履歴の別ファイルで保存。稼働中の会話の名簿 `~/.grok/active_sessions.json`（今は空、ロックつき）。hooks（SessionStart、UserPromptSubmit、Stop、PreToolUse ほか）。ACP（`grok agent stdio`）。leader は既定で切（`grok leader list` は候補なし）。
- seamless 側で検証したハンドオフの主張: Grok Bot の Mac コマンドからの `sessions` が `caller_unobserved`（native_ancestor_missing）になるのは、呼び手の特定が Claude の祖先か Codex の metadata を求める設計のとおり（src/caller.ts）。
- 敵対 1 回目（Codex Astra、読み取り専用、spec 草案）: 重大 6、中 4、軽微 0。すべて spec の記載不足。反映した内容: 不変条件 2・5・6 を検証する AC（AC2 の別プロセス否定、AC6 の返信の対応と循環、AC7 の再送禁止）、鍵の結び付け方と 5 種の拒否（AC5）、Mac 内と外の分類の基準、認可の範囲と受信側の権限の維持（AC8）、配信確認を独立項目に（AC4）、段の言葉の定義と実証の単位（8 本）、読む・一覧の範囲（AC9）、外部公開と常駐の止まる条件。
- Grok Build CLI 4.7 への照会（動いている会話へ外から文を入れる口、名簿の項目、hooks の出力、記録の構造、pid と会話 ID の対応）: 回答あり（確信度: 口が無い high、名簿 medium、hooks high、記録 high、pid の対応 medium）。要点は spec.md の「確認済みの事実」に写した。全文は `.local/grok-consult/grok-cli-answer-2026-10-08.md`。
- 承認 1 回目（2026-10-08 立花さん「承認。B は推奨で」。C は茶々丸）。ルートの spec.md の不変条件 8 を改訂（コミット 0a68ae4）。
- 図面検査 1 回目（Haiku 5.5、画面なしの Claude、読み取り専用）: FAIL。AC の抜け 8（AC2 の別プロセス否定と世代一致、AC5 の差し替えと鍵の grep、AC7 の Grok 側、AC9 の実測、AC11 の版の引き上げ、AC8 の Grok 側、不変条件 3 の封筒の印）、判定できない Done when 5、未反映の決定 3（D2〜D4）、止まる条件に当たる設計 3（Q3 の gate、茶々丸への外部送信の承認 H7、Bot → Mac の経路 T0-6）。
- 敵対 2 回目（Codex Astra、読み取り専用、Plans と tasks）: 重大 8、中 8、軽微 1。反映した内容: 封筒を会話の世代（pid と開始時刻）に宛て hook 側で再照合、配信確認は hook の受領記録と hook_execution の両方、HMAC の正規化した対象と ±5 分の有効期限と原子的な nonce、Bot の側で署名し鍵と封筒を引数に書かない、送信鍵と受信鍵の分離、既存の予約による再送禁止を全経路に、`--as` の経路を既定の「制限なしなら許す」に合流させない、返信の既存の検証を外の送り手にも、未配信を待機中と断定しない、複数封筒の順と競合、hook の固定の道と入力、8,000 字超は切らずに拒否、名簿の信頼の境界と配送直前の失効確認、P0 の未解決を後続の着手禁止に、H0 と H2 の確認カード、1 ターン単位の割り直し（実会話は方向ごと、判定と修正を分ける）、後戻りはコミット単位。
- 図面検査 2 回目（Haiku 5.5）: FAIL（細部 20 件）→ 反映。図面検査 3 回目: FAIL（反映 7、一部 6、未反映 1）。反映した内容: 止まっている会話は Codex と同じく既定で隠し includeOffline で「止まっている」と出す（AC1 と D3 の整合）、hook が文脈に返した後に死んだ封筒は `handed` → `unknown` に移して戻さず帯で「成否不明」と上げる（成否不明の再送をしない）、H0 は本人の「可」の記録を前提に、Q3 の既定への依存の試験、P1 と P2 の独立（TC-3 を経路ごとに分割）、AC4 の返答完了だけが埋まる記録（T2-8f）、同じ内容の別 ID の duplicate を Grok と受ける経路にも、Done when の曖昧な 5 行、Plans の封筒の印をルートの定義に従う形に、範囲外の「seamless Bot」の残り。
- 図面検査（Haiku 5.5）3〜15 回目: 毎回 FAIL だが指摘は回を追って細部へ（3 回目: 止まっている会話の扱いと handed の封筒、4 回目: 未登録の送り手と verify の exit 0、5 回目: AC7 の経路の定義と台帳と名簿の呼び分け、6 回目: Grok の範囲の未設定、7 回目: printenv が値を出す、8 回目: P0 の T0-6 と登録名の指定は名乗りではない、9 回目: 受信箱の内容の重複判定と Grok の設定の前後比較、10 回目: 鍵の値をファイルに書かない、11 回目: 送信鍵と受信鍵の取り違え、12 回目: 状態の言葉とパネルの定義と D7、13 回目: 裏の編集が途中で止まり古い版を検査（編集の結果を表示して確認する手順に変更）、14 回目: T0-3a が No のときの分岐 H8 と headless の会話、15 回目: T1-7 の前提の統一、T0-6 の分岐 H9、H1 と H5 の適用完了）。すべて反映済み（コミット 0546666 まで）。16 回目（H8 が否でも P1 が進む前提、H9 のときの T2-7 と T2-9、T1-11 と T2-9 の前提に AC の作業）、17 回目（TC-1 の前提の除外、T2-8f は受ける経路に依存、T0-6 のファイル、T0-3b の扱い）、18 回目（AC6 の自動試験が Bot 側と Claude⇄Codex 側に無い、T0-4a と T0-6 の Done の衝突、T0-4b と T2-9 と T2-2 の判定できない Done、Plans の範囲判定の文言、T1-6b と H8 が T1-11 と T1-9 の前提に無い）、19 回目（AC5 の「会話」の grep に 3 製品の会話の保存先、T0-4b の Done の判定基準、任意: T2-8c の前提から H7 を外す、TC-2 の行の特定）、20 回目（配信確認の hook_execution を「受領記録から次の利用者の発話まで」の 1 件に結ぶ規則と T1-6 の 6 場面目、T0-6 の「分からない」の扱い、T2-6 のリポジトリの実パス、名簿の send の既定は不可、旧草案 multi-vendor を superseded に）、21 回目（T2-6 の前提を T2-1 に。受ける経路に依存しないので H9 で外しても行う。任意: 識別で結ぶときの 7 場面目）も反映済み。22 回目（コミット d29fa67 の文面）: PASS。5 区分とも「なし」。任意 2 件（T0-2 の Done に hook の識別、T2-3 に過去時刻 −6 分）は反映した。21 回目は AC の抜け、判定できない Done when、不変条件の再定義、止まる条件に当たる設計の 4 区分が「なし」で、残りは決定の未反映 1 件だった。approval-1-easy.html の「seamless Bot」の文言は承認 1 回目の記録（本人が C で茶々丸を選んだ）なので書き換えない。
- 立花さんの判断が要るとして図面検査が挙げた項目: H0（/hooks-trust は止まる条件 3 に当たるか）、H8（署名が確かめられないときの代わりの確かめ方を採るか）、H9（茶々丸が Mac に入るのに新しい口が要るとき受ける経路を範囲から外すか）。いずれも Plans.md の Human gates に置き、判断が出るまで止まる形。18 回目が足した 2 点: (a) H0（`/hooks-trust`）と H1（`~/.grok/config.toml` への Stop hook の登録）は受信側の実行許可を変える操作で、spec の止まる条件 3 は sandbox と承認設定だけを挙げている。hook の信頼付与を止まる条件に書き足すかは spec の変更なので本人判断（書き足さなくても H0 と H1 で止まる形は変わらない）。(b) T0-3b が Open question Q2 を更新するのは「承認済みの本文の変更に当たらない」とした扱いの可否。20 回目が足した (c): H8 が否のとき AC3 を「未達」のまま P1 を完了とする扱いを spec に書くか（spec の Evidence は 8 本すべてを 1 回以上求めている）。書かない場合は、P1 の判定の記録に「AC3 未達、H8 否による」と残す形で進める。

## 承認 2 回目（2026-10-08）

- 立花さん「全部対応させよう。今日決めることは推奨で実行し完了させて」。Plans.md と tasks.md の承認 2 回目として扱う。
- 「今日決めること」の推奨: P1（Grok CLI）を先に完了させ、P2（茶々丸）は T0-4b と T0-6 の答えが揃ってから着手する。
- 本人判断の確認事項 (a)(b)(c) は返事が無いので、判断材料に書いた「今の形」で進める。(a) hook の信頼付与は止まる条件に書き足さず H0 と H1 で止まる。(b) T0-3b の Open question の更新は承認済み本文の変更に当たらない扱い。(c) H8 が否なら AC3 未達を P1 の判定の記録に書く。
- 実装の担当: リーダー Claude Opus 5.5（立花さんが 2026-10-08 にモデルを Fable 5.1 から切り替え）。チームは team-build（大きさ L）。

## P0 の記録（2026-10-08 JST）

### T0-1 台帳の実例（16:30〜16:31 JST、Grok CLI 1.0.46 (2765805b9442)）

擬似端末（Python の pty）で `~/.grok/bin/grok` を画面ありで起動し、12 秒後に台帳を読み、`/exit` で終えてから再び読んだ。作業場所は試験用のフォルダ（scratchpad の grok-t01）。

- 登録時（起動 12 秒後）の `~/.grok/active_sessions.json`:
  ```
  [{"session_id": "01a11a6c-23b4-7af0-b5c4-c9893437b306", "pid": 9454, "cwd": "/private/tmp/claude-502/.../scratchpad/grok-t01", "opened_at": "2026-10-08T07:30:57.414144Z"}]
  ```
- 削除時（`/exit` の後）: `[]`
- 値の形: 会話 ID `session_id` は UUID（版 7。先頭が時刻）。`pid` は整数で、起動した子プロセスの pid そのもの（9454 = pty.fork の子）。`cwd` は絶対パスで、`/private/tmp` のように実体の道（realpath）で書かれる。`opened_at` は ISO 8601 の UTC、マイクロ秒つき、末尾 `Z`。
- 会話の保存先: `~/.grok/sessions/<作業場所の URL エンコード>/<会話 ID>/`。中身は summary.json、updates.jsonl、chat_history.jsonl、events.jsonl、prompt_context.json、system_prompt.txt ほか。
- 要約（summary.json）の `info.id` と `info.cwd`、`created_at`（07:30:57.163224Z。台帳の opened_at より 0.25 秒早い）、`updated_at`、`last_active_at`。
- 計画と違った点: 画面ありの会話の要約には `session_kind` が無い。手元の 511 件の要約のうち 452 件が `headless`、24 件が `subagent`、1 件が `subagent_resume`、残り 34 件は項目なし（画面あり）。Plans.md の「止まっている会話」の判定を「`session_kind` が無い = 画面あり」に直した（同じコミット）。
- updates.jsonl の hook_execution の行（T0-2 の先取り。H0 の試験ではなく、既存の全体の hook の記録）: `{"timestamp": 秒, "method": "_x.ai/session/update", "params": {"sessionId", "update": {"sessionUpdate": "hook_execution", "event_name": "stop", "runs": [{"name": "global/settings:stop[1].hooks[0]", "status": {"status": "success", "elapsed_ms": 数}}]}, "_meta": {"eventId": "<会話 ID>-<連番>", "agentTimestampMs": ミリ秒}}}`。hook の識別（`runs[].name`）は入る。依頼 ID が入るかは T0-2 の実測で確かめる。
- 既存の全体の hook（`global/settings` と `plugin/codex/hooks`）が session_start、stop、session_end で既に動いている。seamless の hook はこれと並ぶ 1 本になる。

### T0-3a 署名（16:29 JST）

- `codesign --verify --verbose=2 ~/.grok/bin/grok`: `valid on disk`、`satisfies its Designated Requirement`。
- `codesign -dv`: `Identifier=xai-grok-pager`、`Authority=Developer ID Application: X.AI Corporation (5Y6N3AJ54S)`、`TeamIdentifier=5Y6N3AJ54S`。
- `~/.grok/bin/grok` は `~/.grok/downloads/grok-1.0.46-macos-aarch64` への symlink。
- 結果: Yes。T0-3b と H8 は不要。T1-7 は TeamIdentifier `5Y6N3AJ54S` の確認で進める。
- コードが使う照合の書式でも通ることを確かめた（2026-10-08 16:41 JST）: `codesign --verify --strict '-R=anchor apple generic and certificate leaf[subject.OU] = "5Y6N3AJ54S"' ~/.grok/downloads/grok-1.0.46-macos-aarch64` が exit 0。
- 動いている Grok の画面の `ps -o comm=` は `grok`（2026-10-08 17:05 JST、擬似端末で起動して確認）。

### T0-4a と T0-6 茶々丸への質問（16:33 JST）

- `.local/grok-consult/questions.md`（本線の checkout）に、webhook の 4 問（Q1 上限、Q2 応答の形、Q3 順序、Q4 再送）と、逆向きの経路の 1 問（Q5）を書いた。立花さんに「Grok に聞いて」と頼む（ハンドオフの手順）。答えは `.local/grok-consult/answers.md` に来る。

### T0-5 MCP Events の一次仕様（2026-10-08 17:00 JST、調査役 Claude Sonnet、読み取りのみ）

結論: Events は 2026-07-28 版の本体仕様に無い（changelog と `schema/2026-07-28/schema.ts` の grep が 0 件。確信度 high）。実体は拡張の草稿 SEP-3415「Events Extension」（Draft、2026-10-05 起票、PR #3415 は open でレビュー 0 件）。ChatGPT の実装ガイドは「MCP 2.0（2026-07-28）が要る」と書き、webhook の配送だけに対応する。以下は草稿の記述で、最終形の確信度は low。全文（引用 40 件、出典つき）は本線の checkout の `.local/grok-consult/mcp-events-research-2026-10-08.md`。

| 項目 | 草稿の形 | 引用（SEP-3415） |
|---|---|---|
| 発見 | `server/discover` の `capabilities.extensions["io.modelcontextprotocol/events"]`（設定は `listChanged` だけ）と `events/list`。ChatGPT のガイドと前身の design sketch は top-level の `events` を使う（置き場所が 3 通りに割れている） | "A server advertises event support in the capabilities it returns from `server/discover`" |
| 購読 | webhook は `events/subscribe`（`delivery: {mode: "webhook", url, secret}`、`ttlMs`）。鍵は（principal、url、name、arguments）。server が `refreshBefore` で期限を与え、client が期限の前に呼び直して延ばす。長い期限を与えた server は再起動をまたいで保つ（MUST）。購読の正本は client | "The client owns all subscription state, in all three delivery modes." |
| callback | server が `delivery.url`（https 必須）へ EventOccurrence（eventId、name、timestamp、data、cursor）を POST。配送の前に宛先の受ける意思を確かめる（challenge など。MUST）。redirect は追わない | "The server POSTs events to the callback URL as they occur" |
| 署名 | Standard Webhooks の profile。HMAC-SHA256 を `webhook-id.webhook-timestamp.本文` にかけ、base64 に `v1,` を前置。ヘッダは `webhook-id`、`webhook-timestamp`、`webhook-signature`、`X-MCP-Subscription-Id`。secret は client（ChatGPT）が `whsec_` で作って渡す。受け手は 5 分より古いものを拒否し、webhook-id で重複を除く | "The client supplies the HMAC signing secret, and the server never generates one." |

出典: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415 、本文（fork の commit 固定）https://github.com/pja-ant/modelcontextprotocol/blob/6859def4ba24ab41678d0e6799fe3f4c84228f9a/seps/0000-events-extension.md 、https://modelcontextprotocol.io/specification/2026-07-28/changelog 、補足 https://developers.openai.com/plugins/build/mcp-events 。
未解決: 草稿が Accepted になる時期、公式 SDK の参照実装（草稿が「未着」と明記）、非対称署名の公開鍵の配布先、放棄されたイベントが client に信号なく失われる報告（incubation repo の issue #9、open）。

### T3-1 Dot の受け入れ条件（2026-10-08）

- spec に AC11a（購読の保持）、AC11b（署名つき配送）、AC11c（Dot の宛先と呼び手の鍵）を足し、Q5（Tunnel の接続を名簿の登録に結び付ける方法）を足した。
- 計画の前提から変わった点: (1) Events は草稿なので、ChatGPT が読む形に合わせ、能力の宣言を 2 か所に置く。(2) 配送の向きは seamless → ChatGPT の callback（seamless が POST する側）で、署名の secret は ChatGPT が作る。Grok Bot の送信鍵（本人が置く）とは作り手が逆。(3) Events と版 2026-07-28 は Dot 用の入口にだけ出し、Claude と Codex の既存の入口は 2025-06-18 のまま（AC10 の守り。T3-4 の「版の引き上げ」は既存の入口には行わない形に変わる）。
- 止まる条件 5（外からの入口）との関係: Dot 用の入口はクラウド（ChatGPT の Tunnel）から呼ばれる。Tunnel の設定は本人が行う操作で、実装の承認（T3-3）とは別に止まって聞く。

### P1 の事前の実機確認（2026-10-08 16:43 JST。T1-10e の正式な記録ではない）

この作業場所で Grok の画面（1.0.46）を擬似端末で起動し、「了解とだけ答えて」と打ってから、このリーダーの会話（Claude Code 2.1.288）の Bash で `node src/cli.ts sessions` と `read` を実行した。
- 一覧: `grok:01a11a77-0e68-7ce1-a4c6-9e88420abdb5` が provider grok、host local、status online、世代 `66930@2026-10-08T07:42:53.061540Z`、versionStatus checking で出た。台帳の pid 66930 と一致。
- 読み取り: status ok。利用者 1 件（打った文）と相手 1 件（「了解」）。omitted は thoughts、chat_history、tool_inputs、tool_results、hook_executions。世代は一覧と一致。
- `/exit` の後、台帳は `[]` に戻った。
- 正式な T1-10e は T1-9 の「可」の後に改めて行う。

### T3-2 Dot の受け入れ条件の敵対（2026-10-08 16:48 JST、Codex Astra gpt-6-astra、読み取り専用）

- 指摘 12 件（重い 7、中 5、軽い 0）。反映 12 件、見送り 0 件。
- 重い 7 件: (1) Q5 が決まる前でも購読を作れ、他人の登録に自分の callback を結び付けられる → 購読の作成、更新、解除、配送先の確定を認証済みの接続に限り、Q5 まで入口は購読を受けない。(2) https と challenge だけでは内部への通信（SSRF）を防げない → 名前を引いた IP が公開の住所であることを確認と配送の両方で確かめ、その IP にだけ接続し、引き直さない。(3) 環境変数の固定の鍵では遠隔の呼び手を証明できない → Q5 の成立条件を「接続と登録が一対一で、別のアカウントや接続から借りられない」と定めた。(4) 登録と鍵の版だけでは同じ Dot の会話への配送を証明できない → 会話を識別できなければ「Dot の登録への配送」と表示し、既存の会話への配送と扱わない（別途の承認の対象）。(5) secret の保存と失効が購読の寿命と切り離されている → 登録、購読 ID、callback、secret の版、確認の状態、期限を 1 組で保ち、失効で止め、secret 更新で確かめ直す。(6) 送った直後の再起動で二重送信を防ぐ条件が無い → POST の前に開始を記録し、結果の無い送信は再起動後も再送しない。(7) replyTo だけで返答完了を立てられる → 依頼の宛先の登録と返信元の登録の一致を条件にした。
- 中 5 件: (8) 非 2xx を一律に不受理とする根拠が無い → 4xx は不受理、5xx と時間切れと切断は受理未確認。(9) 購読の更新と解除の同一性 → 購読 ID と、同じ鍵の再購読は延長だけ。(10) 放棄と順序逆転 → 配送先なしの理由を依頼 ID ごとに残し、順序は保証しない。(11) 草稿の版と能力の宣言 → 参照した版を固定し、既存の入口が 2025-06-18 で Events を宣言しない試験、対応しない版を拒否する試験、実機での発見と購読の試験。(12) 検証の数え方 → redirect 先を含む宛先ごとの POST の回数、4 段それぞれの期待値、公開の検証用の値での署名の照合、承認が要る操作は承認待ちのまま。
- 指摘の全文: scratchpad の astra-dot.out（この会話の間だけ残る）。

## P1 の実装の記録（2026-10-08 JST）

- T1-1（コミット 3667eb3）: `bash scripts/verify.sh` exit 0（node の試験 391 件、帯 87 件）。
- T1-2、T1-3、T1-7、T1-8（コミット 4020408）: `bash scripts/verify.sh` exit 0（node の試験 406 件、帯 87 件）。
- 図面検査（実装）1 回目（Haiku 5.5、読み取り専用）: FAIL。指摘は (1) 試験の場面の不足（pid の使い回し、下請けの会話、二重の起動、版、帯の「動いている」）、(2) 台帳の行で `session_kind` を見ていない、(3) 計画に無い判定の幅（世代、生存の許容、二重の起動、版、50 件の上限）、(4) T1-8 の読めない作業場所、Codex の表の中の鍵、実際の配送の部品を通らない受信の比較、(5) 旧方式の名簿の経路、(6) updates.jsonl の実物の形が証拠に無い。すべて反映（下のコミット）。旧方式の名簿は `parseBootstrap` が grok を拒むので届かないことを試験にした。
- updates.jsonl の実物の形（2026-10-08、`01a11a2d-…` の会話の 1 行から項目名だけ）: `{"timestamp": 秒, "method": "session/update", "params": {"sessionId", "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text"}}, "_meta": {"totalTokens", "eventId", "agentTimestampMs", "promptId", "streamStartMs", "turnStartMs", "updateType", "chunkId"}}}`。`tool_call` は `toolCallId`、`title`、`rawInput`、`_meta`。`turn_completed` は `prompt_id`、`stop_reason`、`usage`。読み取りは `params._meta` の `eventId`、`agentTimestampMs`、`promptId` だけを使う。
- 図面検査（実装）2 回目（Haiku 5.5）: FAIL。重い 1 件: 画面なしの `grok -p` の中から seamless が呼ばれると、Grok の祖先が実行ファイルを確かめられずに飛ばされ、その上の Claude か Codex の会話が送り手と取り違えられる経路があった（試験も無かった）。→ ps の名前が `grok` の祖先は必ず実行ファイルを確かめる形に直し、試験を足した（判定を外すとその試験が落ちることを確認）。ほか: 名乗りの試験を「正しい Grok の祖先がいて、別の会話を名乗る」場面に、同じ会話の別 pid の行の場面、生存の窓の境界（120 秒前と 1 秒後）、一覧の拒否と空の一覧の区別、Codex の設定の複数行の配列、T0-3a の照合の書式、最終の検証の記録、を足した。
- 上の反映の後（この節の次のコミット）: `bash scripts/verify.sh` exit 0（node の試験 417 件、帯 88 件）。
- 図面検査（実装）3 回目（Haiku 5.5）: FAIL。2 回目の 8 件中 7 件は直っていた。残る重い 1 件: 名前が `grok` の祖先で実行ファイルが取れないとき、まだ上の祖先へ進んでいた。→ 名前が `grok` の祖先は、実行ファイルが取れないときと既知の Grok でないときも、そこで止める（grok_identity_unobserved）。ほか: 台帳の生きた行の headless、既定の一覧で二重の起動と版の unknown が隠れて offlineHidden に数えられること、範囲「すべて」の 50 件の上限、呼び手の pid の使い回し、の試験を足し、試験の題を 12 件の確認に合わせ、計画に止まっている会話の作業場所の出どころを書いた。
- 上の反映の後: `bash scripts/verify.sh` exit 0（node の試験 423 件、帯 88 件）。
- 実地検査（Codex gpt-6.1-sol、施工と逆の家系）: 1 回目（4020408）は Codex の作業用の閉じた環境が Unix ソケットの待ち受けを禁じていて既存の 4 件が `listen EPERM` で落ち「不一致」（コードの不具合ではない）。指摘の「受信の比較が実際の配送の部品を通らない」は図面検査の指摘と同じで eab0505 で直した。2 回目（eab0505、ソケットを許す設定）は exit 0、413 件、帯 88 件で「一致」。3 回目（fbd4941）は exit 0、417 件、帯 88 件で「一致」。
- 図面検査（実装）4 回目（Haiku 5.5、593e1d0 の文面）: PASS。任意の改善 3 点（止まっている Grok の会話を seen.json に入れない、帯の「止まっている」の試験、版の書き方）も反映した。
- 最終: `bash scripts/verify.sh` exit 0（node の試験 424 件、帯 89 件）。P1 のうち T1-1、T1-2、T1-3、T1-7、T1-8 は Done。T1-4 以降は H0 待ち。P1 の完成の判定（T1-11）は実会話の後に別途行う。
- 一覧の所要時間（2026-10-08 17:18 JST、このリーダーの会話から `node src/cli.ts sessions` を 2 回）: 1.05 秒、0.99 秒。止まっている Grok の会話の走査を足した後も、2026-10-07 の 1.5 秒より遅くなっていない。
- 件数の訂正: P0〜P3 の 51 件のうち済みは 11 件（T0-1、T0-3a、T0-4a、T0-5、T1-1、T1-2、T1-3、T1-7、T1-8、T3-1、T3-2）。T0-3b は T0-3a が Yes なので不要。T0-6 は茶々丸の答え待ちで未達。

## H0 と T3-3（2026-10-08 17:24 JST）

- H0: 立花さん「A、やった」。ターミナルで `.local/grok-t02` の Grok を開き `/hooks-trust` を実行した。Grok の表示は「Trusted: /Users/tachibanashuuta/LocalWork/Code/seamless」。
- 計画との違い: Grok は git のリポジトリの根元をまとめて信頼する。判断材料に書いた「その場所だけ」ではなく、seamless のリポジトリ全体（`.claude/worktrees` の下の作業場所を含む）が信頼された（`~/.grok/trusted_folders.toml` の行 `[folders."/Users/tachibanashuuta/LocalWork/Code/seamless"]`、decided_at 1791447863）。試験用の場所をリポジトリの中に置いた私の設計の誤り。
- 影響の確認（17:26 JST）: リポジトリの中で Grok が読む hook の置き場所（`.grok/hooks/*.json`、`.claude/settings.json` と `settings.local.json` の hooks、`.cursor/hooks.json`）のうち、中身があるのは試験用の `.local/grok-t02/.grok/hooks/seamless-t02.json` だけ。`.claude/settings.local.json` は permissions だけで hooks は無い。`.mcp.json`、AGENTS.md、`.claude/skills` はリポジトリの根元に無い。worktree の `.claude/settings*.json` にも hooks は無い。
- 推奨（立花さんの判断）: T0-2 の後は、リポジトリの信頼を外す。H1 は信頼の要らない `~/.grok/hooks/*.json`（Grok の文書で常に信頼）か `~/.grok/config.toml` で入れるので、seamless のリポジトリの信頼は要らない。
- T3-3: 立花さん「B、承認する」。Dot の受け入れ条件 AC11a〜c を承認。実装は Q5（Tunnel 越しの呼び手の鍵）が決まるまで始めない。

### T0-2 Stop hook の合言葉（2026-10-08 17:28〜17:30 JST、Grok CLI 1.0.46）

- 1 回目（17:26）: 不成立。試験用の hook を `.local/grok-t02/.grok/hooks/` に置いたが、Grok は git のリポジトリの根元（`GROK_WORKSPACE_ROOT` = `/Users/tachibanashuuta/LocalWork/Code/seamless/`）の `.grok/hooks/` だけを読むので、1 回も動かなかった。合言葉を聞かれた Grok は、全体の契約にある別の合言葉 `CJ-WIRE-OK-20260829` を答えた。
- 2 回目（17:28）: 同じ hook をリポジトリの根元の `.grok/hooks/seamless-t02.json` に置き、hook の中で「会話の作業場所が試験用の場所のときだけ動く」に絞って実行。試験の後に根元の `.grok/` を消した（本線の `git status` は空）。
- 結果: Yes。Grok の返事に `SEAMLESS-T02-OK` がそのまま含まれた。文を足した直後に Grok が同じ手の続きを 1 回走らせ（そのときの Stop の入力は `stopHookActive: true`）、その場で「合言葉を受け取りました」と書いた。2 手目に聞くと合言葉を答えた。
- hook の標準入力の項目名: backgroundTasks、cwd、hookEventName、hook_event_name、lastAssistantMessage、permissionMode、permission_mode、promptId、reason、sessionCrons、sessionId、session_id、stopHookActive、timestamp、transcriptPath、transcript_path、workspaceRoot。会話 ID（sessionId）、作業場所（cwd）、Stop の理由（reason）は入っている。reason は 1 手の終わりで `end_turn`、会話の終わりで `shutdown`（このとき promptId は無い）。
- hook から見た pid: hook のプロセスの親（`process.ppid`）が Grok の画面のプロセス（93955、ps の名前 `grok`）で、台帳の行の pid 93955 と一致した。間にシェルは挟まらない。環境変数は GROK_HOOK_EVENT=stop、GROK_HOOK_NAME=`project/seamless-t02:stop[0].hooks[0]`、GROK_SESSION_ID、GROK_WORKSPACE_ROOT。
- updates.jsonl の hook_execution の行: `event_name: "stop"`、`runs[]` に hook ごとの `name`（例 `project/seamless-t02:stop[0].hooks[0]`）と `status.status`（`success` か `failed`）と `elapsed_ms`、`_meta` に `eventId` と `agentTimestampMs`（promptId は無い）。依頼 ID は入らない。hook の識別だけ入る（T1-6 の 7 場面目を足す）。続きの回でも同じ hook の行がもう 1 件できる。
- 時刻の順: hook が書いた記録 08:29:01.653Z、その hook_execution の行の agentTimestampMs 08:29:01.748Z（hook の記録の後に行ができる）。
- 計画への反映: 配信確認は「受領記録の時刻以降で、同じ会話の次の利用者の発話より前にある、seamless の hook の名前を含み status が success の hook_execution の行のうち最初の 1 件」で結ぶ（続きの回の行を数えない）。Plans.md の「(Stop、completed)」は実物の `stop` と `success` に直した。

### T1-4、T1-5、T1-6、T1-6b、TC-3a（2026-10-08 JST）

- 受信箱 `src/grok-inbox.ts`（`~/.seamless/grok-inbox/<会話 ID>/{pending,delivering,handed,delivered,failed,unknown}/`、ディレクトリは 0700、ファイルは 0600、名前は依頼 ID の SHA-256）。hook `src/grok-hook.ts`（Grok が `node <道>/src/grok-hook.ts` で起動する入口と、試験から呼ぶ関数）。送る経路は配送の部品（native-runtime の adapter.send）から受信箱へ置く。段の観測は status.ts の Grok の分岐と adapters/grok.ts の readGrokStructure。帯は exchanges.ts の「受理・未配信」「相手は 5 分以上動いていない。次の 1 手の後に届く」「成否不明。立花さんの確認が要る」。
- 試験: tests/grok-hook.test.ts（7 場面と、相手の会話でない hook、実際に `node src/grok-hook.ts` を起動する場面。9 件）、tests/grok-send.test.ts（5 場面と封筒の印 2 件。6 件）、tests/grok-status.test.ts（6 場面、hook の名前が違う 7 場面目、続きの回の Stop を数えない場面、ファイルから読む場面、返信の後 10 分。9 件）、帯の試験 3 件。
- `bash scripts/verify.sh` exit 0（node の試験 448 件、帯 92 件）。
- 文言の訂正: T1-5 の「同じ ID → duplicate」は、実際には前の結果を返して置き直さない（Claude と Codex と同じ）。同じ内容の別 ID が duplicate になるのは前の依頼が成否不明か処理中の間だけ（予約の claim の既存の仕組み）。tasks.md と Plans.md を実際の動きに合わせた。
- まだ確かめていないこと: Grok が seamless の MCP で send したときの道具の呼び出しの記録の名前（readGrokSentIds の照合）。実会話 T1-10c で確かめる。それまで Grok からの依頼は「送り主は未確認」と出ることがある。
- 図面検査（配送）1 回目（Haiku 5.5、2a0bffb）: FAIL。(1) H0 の信頼がリポジトリ全体に広がったまま解除の判断が記録されていない → T1-9 の立花さんの判断に入れる。(2) T1-6b の帯の描画で 5 分の添え書きと成否不明を確かめていない → 試験を 3 件足した。(3) 足された文が Grok の記録に利用者の発話として出るなら配信確認が立たない、未測定 → 下の実測で確かめた。(4) Plans の古い文言（grok_delivery_unavailable、終了時の Stop、exists の扱い）と P2 の T2-2 の同じ ID の結果 → 直した。不変条件 1〜8 への違反は無し。
- 実測（T0-2 の会話 `01a11aa1-…` の updates.jsonl、2026-10-08 18:00 JST に読んだ）: hook が足した文は利用者の発話（user_message_chunk）としては残らない。Stop の hook_execution の行の直後に `{"sessionUpdate": "hook_annotation", "message": "↩ Stop hook feedback, continuing: <足した文の全文>"}` として残り、agentTimestampMs は Stop の行と同じ。hook の入力の hookEventName の値は `stop`（小文字）。記録の行は時刻の順に並ぶとは限らない（続きの回の前の発話が Stop の行の後に書かれる）ので、段の観測は時刻で並べ直して読む。
- 配信確認の結び方を強めた: 受領記録、その後の最初の Stop の行で seamless の hook が success、その直後の hook_annotation に seamless の封筒の行（文の最後の印の後の 1 行の JSON）があり、依頼 ID と送り手が一致、の 3 つがそろったときだけ。spec の「相手の会話の記録に、その依頼 ID の封筒が現れた」に、依頼 ID のまま合う。本文に偽の封筒の行を書いた場面の試験を足した。
- `subagentType` は Grok の文書（10-hooks.md）で下請けの会話の入力にだけ入る項目。下請けの会話の実測は無い。
- 実地検査（配送）1 回目（Codex gpt-6.1-sol、0188e35）: 不一致。Codex の作業用の環境では `ps` が許されず（operation not permitted）、実際の hook を起動する試験 1 件が前提（試験のプロセスの開始時刻）を作れずに落ちた。ほかの数字（450 件中ほか 449 件、帯 95 件、send 6 件、status 11 件）と、指定した 3 つの試験の中身は一致。→ ps でプロセスを観測できない環境ではその試験を理由つきで飛ばす形にした（製品も同じ環境では動いている Grok を確かめられない）。

## 目的とのずれと過剰の点検、配送の穴探し、本人の判断（2026-10-08 18:20〜18:40 JST）

- 点検（3 観点の独立の点検役と反証役、Claude）: 指摘 20 件のうち反証を越えたのは 9 件。H0 の説明が実際と違い信頼が残っている、帯 第5版が計画から落ちた、茶々丸への送信の署名がハンドオフ（Bot は鍵を見ない）と食い違い認証方式の問いが無い、本物の通しが無い、受信箱の 6 状態のうち 2 つは過剰、実地検査を途中で 4 回、測る前に書類を磨いた、「動いている」の判定の下限（120 秒）が pid の使い回しを防がず `/new` や `/resume` を誤る恐れ、目的との対応表が無い。
- 配送の穴探し（5 観点 × 反証 3 人、Claude）: 指摘 35 件のうち反証を越えたのは 8 件。重い 2 件: (1) 別の送り手が同じ依頼 ID を使うと 2 件目が受信箱に入らず、帯は受理・未配信と出す（受信箱の鍵が依頼 ID だけ）。(2) 宛先の世代が終わった後も帯が「次の 1 手の後に届く」と出す。中 5 件と軽 1 件は試験の不足。
- 立花さんの判断: A「進める」（実物を先に。重い穴だけ直し、hook の登録と本線への取り込みを頼み、Claude から Grok へ 1 往復する。軽い指摘の作り直しはしない）。B「1 往復した後」（帯 第5版はその時点で直す）。C「外す」（リポジトリ全体の Grok の信頼。安全に関わる設定なので、立花さんが `/hooks-untrust` か trusted_folders.toml の 3 行の削除で行う）。
- 先送りした分と支払期日: 受信箱の 6 状態の整理、配送の穴探しの試験の不足 6 件のうち今回の直しに関わらないもの、実地検査の回数の決まり（L で 1 回）。期日は P1 の判定（T1-11）の前。
- A の作業（18:45 JST）: 重い 2 件を直した。受信箱の名前を送り手と依頼 ID の組の SHA-256 にした（予約と同じ範囲）。宛先の世代の生きた行が台帳に無い pending の封筒は inbox `orphaned` とし、帯は「宛先の会話は終わった。この依頼は届かない」と出す（台帳が読めないときは pending のまま）。「動いている」の判定の下限（120 秒）を外し、上限（行の 1 秒後まで）だけにした。pid の使い回しの見本を本物の向き（行より後に起動）に直した。試験を 3 件足し、直した判定を外すとそれぞれ落ちることを確かめた。茶々丸への問いに Q6（webhook の本人確認の方式）を足した。計画の H0、H1、H5、T1-9 の文言を実際に合わせ、帯 第5版を GOD_Plans.md に戻した（B の判断）。
- `bash scripts/verify.sh` exit 0（node の試験 452 件、帯 96 件）。
- 図面検査（直し）1 回目（Haiku 5.5、07407e7）: FAIL。コードの直し（鍵の統一、orphaned、判定の上限）は「正しく直っている」。指摘は主に書類のずれで、反映した: Plans の H0 の段落、T1-10a〜d の前提を H5 から H6（本線への取り込み、push なし）に、orphaned の対象は pending と delivering、台帳のファイルが無いときは空（Grok が終了後に `[]` を残す T0-1 の観測）、帯の文言を推定と分かる「宛先の会話は台帳から消えている。このままでは届かない」に、GOD_Plans の原因の行を「候補」に。承認 2 回目の判断材料（approval-2-easy.html）は承認の記録なので書き換えない。A の判断（守りの上積みは止める）に沿って、図面検査の再実行はしない。
- 根拠の追記: (1) hook が受信箱の無い会話で何もせずに終わる時間は 0.086 秒（18:00 JST、`time` で 1 回）。(2) Grok は `~/.claude.json` の seamless の MCP を読み込んでいる（T0-2 の会話 `01a11a9e-…` の events.jsonl: mcp_config_resolved に seamless（source local、stdio）、mcp_server_connected に tool_count 5、道具 sessions、read、send、limits、status_panel）。その起動コマンドは本線の checkout の `src/cli.ts mcp`（`~/.claude.json` の command と args を値を出さずに確認）。(3) 茶々丸への Q6 は、他の問いと同じく本線の `.local/grok-consult/questions.md`（リポジトリの外の相談用）に書いた。(4) evidence の T1-4 の節の「名前は依頼 ID の SHA-256」は、07407e7 から「送り手と依頼 ID の組の SHA-256」。(5) 直した判定を外す確認: 鍵を依頼 ID だけに戻すと tests/grok-send.test.ts が 8 件中 1 件失敗、orphaned の判定を外すと 8 件中 1 件失敗、元に戻すと 8 件すべて通過（node --test、18:44 JST）。
