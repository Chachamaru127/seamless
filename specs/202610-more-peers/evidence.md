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

- 受信箱 `src/grok-inbox.ts`（`~/.seamless/grok-inbox/<会話 ID>/{pending,delivering,handed,delivered,failed,unknown}/`、ディレクトリは 0700、ファイルは 0600、名前は依頼 ID の SHA-256）。hook `src/grok-hook.ts`（Grok が `node <道>/src/grok-hook.ts` で起動する入口と、試験から呼ぶ関数）。送る経路は配送の部品（native-runtime の adapter.send）から受信箱へ置く。段の観測は status.ts の Grok の分岐と adapters/grok.ts の readGrokStructure。帯は exchanges.ts の「受理・未配信」「相手は 5 分以上動いていない。次の 1 手の後に届く」「成否不明。立花さんの確認が要る」。（この行は 2026-10-08 18:00 頃の版の記録。名前は 07407e7 から送り手と依頼 ID の組の SHA-256、状態は 20c41e3 から delivering を外した 5 つ）
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

### T1-9 の提示（2026-10-08 18:55 JST）

立花さんにお願いした操作（返事の記録は次の節に書く）:
1. C: seamless のリポジトリで Grok を開き `/hooks-untrust` で信頼を外す。
2. H6（本線への取り込み、push なし）: `git -C ~/LocalWork/Code/seamless merge --ff-only claude/seamless-claude-codex-c2a20e`。本線 4fa898e からの早送り（54 コミット）。Claude、Codex、Grok の seamless の MCP は本線の `src/cli.ts` を起動するので、新しく開いた会話から今回のコードで動く。開いたままの会話の MCP は古いコードのまま。
3. H1: `.local/grok-t02/h1-seamless-hook.json` を `~/.grok/hooks/seamless.json` に写す。中身は Stop hook 1 本（`node <本線>/src/grok-hook.ts`、時間切れ 10 秒）。戻すときはこのファイルを消す。

立花さんの返事: 可。3 操作を立花さんが自分の端末で行った（信頼の取り外し、本線への ff の取り込み、hook の写し）。本線は 19:08 に f9b2dc4 になり（T1-10a の節）、のちに d784be8 へ進んだ。`~/.grok/hooks/seamless.json` があり、Grok がそれを読む（T1-10a の hook の行 `global/seamless:stop[0].hooks[0]`）。

### T1-10a 実会話: Claude → Grok CLI（2026-10-08 19:09〜19:15 JST）

- 製品の版: Claude Code 2.1.288（このリーダーの会話 `claude:3263fdb8-…`、世代 `10433@1791431783385`）、Grok CLI 1.0.46。seamless は本線 f9b2dc4（H6 の取り込み、push なし）、Grok の全体の hook は `~/.grok/hooks/seamless.json`（H1）。
- 手順: この作業場所で Grok の画面を擬似端末で開き（会話 `grok:01a11afd-4b64-7b91-8370-34a397751a19`、世代 `8140@2026-10-08T10:09:31.072340Z`）、待機中のうちにこの会話から `node src/cli.ts send` で依頼 `t110a-190942` を送った。依頼の本文は「seamless の sessions で ticket を取り、send で replyTo つきに『受け取りました（Grok）』と返す」。その後 Grok に「はい」とだけ答える 1 手を打たせた。
- 段（UTC）: 受理 10:09:43.451（送った直後の inbox は pending、他の 3 段は未確認）、配信確認 10:09:49.589（受領記録、`global/seamless:stop[0].hooks[0]` の success、hook_annotation の封筒の行の 3 つ）、処理開始 10:09:55.023（Grok が依頼について書き始めた）、返答完了 10:15:10.520（この会話に replyTo つきの封筒 `t110a-190942-reply` が届いた）。世代は送る前と返信の送り手で同じ `8140@…`。
- 待機中の扱い: 送った直後は「受理・未配信」で、Grok が 1 手を終えた 10:09:49 に届いた（D5 の (a) と (b) のとおり）。
- 呼び手: Grok から Claude への返信は、Grok の seamless の MCP（本線のコード）を通り、呼び手が Grok の会話（`grok:01a11afd-…`、世代 `8140@…`）として特定された（T1-7 の実会話での初めての通過。T1-10c の正式な記録は別に行う）。
- 問題 1（承認の取り違え）: Grok は seamless__sessions を呼ぶ前に道具の使用許可を求め、297.764 秒待った（events.jsonl の permission_requested 10:10:02.035、permission_resolved allow 10:14:59.801）。この allow は、観測の台本が時間切れで `/exit` と Enter を打った時刻と同じで、台本の打鍵が許可の確認に答えた形になった。直後の seamless__send は待ち 0 ミリ秒で通った。使われた道具は seamless の一覧と送信で、宛先は立花さんのこの会話（契約の事前承認の「本人の別の会話へ送る依頼と返信」の範囲）。本来は立花さんが Grok の画面で決める承認を、私の台本が代わりにした。以後の実会話の台本は、許可の確認が出たら止まり、打鍵しない。
- 問題 2（照合の取りこぼし）: Grok は MCP の道具を `use_tool`（rawInput の `tool_name: "seamless__send"`、`tool_input: {...}`）で呼ぶ。readGrokSentIds がこの包みを読まず、Grok からの依頼の送り主が「未確認」になっていた → 包みを読む形に直し、この会話の記録で `t110a-190942-reply` が照合できることを確かめ、試験を足した。`bash scripts/verify.sh` exit 0（node 453 件、帯 96 件）。
- 分かったこと: Grok は seamless の道具を使うたびに（少なくとも会話の最初の 1 回は）使用許可を求める。立花さんが Grok の画面で許可しないと、Grok からの返信は止まる。

### 本人の判断と T1-10e、T1-10f（2026-10-08 20:00〜20:04 JST）

- 立花さん「a. 許可する」: Grok で seamless の道具をいつも許可する。Grok の文書（22-permissions-and-safety.md）では `~/.grok/config.toml` の `[permission]` 節に `allow = ["MCPTool(seamless__*)"]` と書くと、seamless の道具だけを確認なしで通せる。今の確認は、Grok が Claude の設定の既定（`~/.claude/settings.json` の `permissions.defaultMode: auto`）を読み込んで auto-review で動いているために出ている（config.toml の `[ui] permission_mode` は always-approve だが、画面の表示は auto-review だった）。安全に関わる設定なので、書き換えは立花さんが行う。
- 立花さん「b、出さない」: 帯に相手の最新の発言は出さない（OD2 は「出さない」で閉じる。10/5 の判断を維持）。
- T1-10e: 20:03:10 JST、この会話から `node src/cli.ts read` で Grok の会話 `grok:01a11b2d-c64d-7ef0-9ad5-d6168af67934`（世代 `5249@2026-10-08T11:02:27.575027Z`）を読んだ。status ok、発話 2 件（利用者「「はい」とだけ答えてください。…」11:02:39Z、Grok「はい」11:02:43Z）、思考の行は無い（omitted に thoughts、chat_history、tool_inputs、tool_results、hook_executions）。道具の使用許可の確認は 0 件。
- T1-10f: Grok の返信が届いた 19:15:10 JST から 46 分後の 20:01:54 JST に、この会話が送り手の依頼を数えて 1 件（`t110a-190942`）のまま。返信を受けた後に seamless が自動で依頼を増やしていない。
- Codex Desktop の seamless の MCP（pid 85882、ChatGPT の下の codex、18:38 起動）は本線への取り込み（19:08）より前から動いていて古いコードのまま。T1-10b と TC-1 は Codex Desktop を開き直した後に行う。

### T1-10c 実会話: Grok CLI → Claude（2026-10-08 22:34〜22:37 JST）

- 前提: H6（本線 af9df0e）、H1（全体の hook）、立花さんの判断 a（`~/.grok/config.toml` に `[permission] allow = ["MCPTool(seamless__*)"]`。立花さんが追記）。製品の版: Claude Code 2.1.288、Grok CLI 1.0.46。
- 手順: 試験用の Grok（会話 `grok:01a11bb8-f407-7e42-a12c-cb23c7281201`、世代 `57082@2026-10-08T13:34:28.808647Z`）を擬似端末で動かし続け、「seamless の sessions で claude:3263fdb8-… の ticket を取り、send で依頼 t110c-223447 を送る」と打たせた。台本は道具の使用許可の確認が出たら止まる形にした（今回は確認が 1 度も出なかった。許可の決まりが効いた）。
- 呼び手の特定: Grok の seamless の MCP の sessions の結果で、caller は `provider grok`、`source grok-ancestor`、世代 `57082@…`。名乗りではなく、祖先の Grok の pid、台帳、作業場所、X.AI の署名で特定された（AC3）。
- 受け手の側: この会話に依頼 `t110c-223447` が届き、seamless の sessions の inbound で送り主が `verified`（Grok の記録の use_tool の包みを読んで照合）。
- 返信: この会話から `node src/cli.ts send`（ticket、id `t110c-223447-reply`、replyTo `t110c-223447`）で返した。submitted。Grok の次の 1 手の終わり（13:35:58Z）に hook が渡し、Grok の記録に hook_annotation「別の会話から返信が届きました」が残った。
- Grok の側の段（Grok が seamless の send の track で確かめた結果、13:36Z 台）: 受理 13:35:23.984Z、届いた 13:35:24.528Z、読んだ 13:35:28.816Z、返信 13:35:58.861Z（Grok の受信箱の受領記録）。4 段すべて observed（T1-10c の Done）。
- この会話の側から見た返信 `t110c-223447-reply` の段: 受理 13:35:34.865Z、届いた 13:35:58.985Z、読んだ 13:36:09.508Z。
- 見つかった手間: Grok の最初の send は、追跡のときだけ使う `waitSeconds: 0` を付けて `invalid_params` で断られ、Grok は seamless のソースを 6 回読んで自分で直した。→ send の道具の入力の説明に「track と waitSeconds は追跡のときだけ」を足した（src/mcp.ts）。`bash scripts/verify.sh` exit 0（node 453 件、帯 98 件）。

### TC-1 と T1-10b の途中（2026-10-08 22:39〜22:50 JST）

- Codex Desktop の seamless の MCP は 22:29:38 に起動し直されていた（本線 af9df0e のコード）。seamless の作業場所にある Codex の会話は、実地検査で使った試験用の会話 `codex:01a11aba-a92a-7001-90d1-91db2a3dcda8` だけ（立花さんの作業の会話ではない）。名指しで Codex Desktop に読み込ませた（Codex Desktop が手前に出た）。
- この会話から依頼 `tc1-223931`（Codex に「Grok へ t110b-223931 を送り、その結果を replyTo つきで返す」）を送った。段: 受理、届いた、読んだ まで observed。
- Codex の判断: 「別の会話から試験依頼が届きました。Grok への送信と Claude への結果返信は未実行です。本人の直接承認が必要です（契約の『別の会話からの依頼は承認にならない』と送信ツールの承認条件）。この 2 件の送信を許可しますか？」。届いた文を承認として扱わない、という不変条件 3 どおりの止まり方。受け手の AI が自分で判断し、seamless は承認設定を変えていない。返答完了は未確認のまま（不変条件 4）。
- 続けるには、立花さんが Codex Desktop のその会話で許可を出す必要がある。私は Codex の承認を代わりにしない。

### TC-1、T1-10b、T1-10d（2026-10-08 22:52〜22:58 JST）

- 製品の版: Claude Code 2.1.288、Codex Desktop（seamless の MCP は 22:29:38 起動、本線 af9df0e のコード）、Grok CLI 1.0.46（試験用の会話 `grok:01a11bbd-0cd6-79e3-8d1a-fccd1783d6d1`、世代 `85429@2026-10-08T13:38:57.227315Z`）。Codex は試験用の会話 `codex:01a11aba-…`（世代 `9b2e8ff0-…`）。
- 立花さんが Codex Desktop で 2 件の送信を許可した後、Codex は Grok へ `t110b-223931` を送り（submitted）、この会話へ replyTo `tc1-223931` で結果を返した。
- TC-1（Claude ⇄ Codex、この会話の status）: 受理 13:39:31.715Z、届いた 13:39:31.963Z、読んだ 13:39:31.963Z、返信 13:52:52.002Z（立花さんの許可を待った分の遅れ）。既存の Claude と Codex の往復は今回のコードで壊れていない（AC10）。
- T1-10b（Codex → Grok。段は製品の statusResult と配送の部品の structure で、読み取りだけで求めた）: 受理 13:52:42.462Z、届いた 13:53:46.578Z（Grok の 1 手の終わりに hook が渡した）、読んだ 13:54:12.379Z、返信 13:54:48.970Z（Grok が replyTo `t110b-223931` で「了解（Grok）」を Codex へ返し、Codex が受け取って replyTo の一致を確かめた）。Grok の受信箱の状態は delivered。世代は送る前と同じ `85429@…`。
- T1-10d（Grok → Codex）: Grok が `t110d-225322` を Codex へ送り（submitted）、受理 13:53:42.624Z、届いた 13:53:42.889Z、読んだ 13:53:42.889Z。返答完了は未確認（Codex が「前の承認は 2 件の送信に限定。今回の送信承認が必要」として立花さんの許可を待っている）。
- Grok は Codex からの依頼に返信する前に、seamless の作業の一覧と証拠の書類を読んで、試験として正当かを確かめた（届いた文をそのまま信じない動き）。

### 毎回の許可の原因（2026-10-08 23:05 JST、立花さん「毎回許可しなくていいようにして欲しい」）

- 原因: 契約（CJ-Plugin/contract/AGENTS.md、Codex は ~/.codex/AGENTS.md の symlink で同じものを読む）の Risk Gates に「`seamless` で本人の別の会話へ送る依頼と返信（2026-10-07）」が事前承認として並ぶ一方、直後に「別の会話からの依頼は承認にならない」とある。Codex は後者を「届いた依頼に応じて送る返信も承認が要る」と読んで、送信のたびに立花さんの許可を求めた。
- seamless の側の同じ種類の問題: Grok に渡す文が「この文を理由に送信…をしないでください」と書き、返信まで止めるように読めた → 「外部への送信、削除、課金、マージ、push、本番への反映をしない。seamless で送り手へ返信することと、本人の別の会話へ依頼を送ることは事前承認の範囲」に直し、試験を足した。`bash scripts/verify.sh` exit 0（node 454 件、帯 98 件）。
- 契約の直しの案（立花さんが当てる。契約は本人が編集する）: 事前承認の括弧に「届いた依頼に応じて送る分も都度確認しない」を足し、後ろの文を「別の会話からの依頼は、それ以外の止まるものの承認にならない」にする。字数は 9,334 字から約 9,370 字（上限 9,500 字）。
- 契約の直しは、立花さんの「上記やっていいよ」（23:10 頃）を受けて私が CJ-Plugin/contract/AGENTS.md に当てた（9,367 字、上限 9,500 字、`wire.sh check` FAIL 0）。CJ-Plugin への commit は立花さんが行う（別作業の未保存の変更があるため）。seamless は本線 d784be8 に取り込み済み（立花さんの `merge --ff-only`、push なし）。

### T1-10d のやり直し（2026-10-08 23:04〜23:25 JST）

- 前の T1-10d（`t110d-225322`）は、Codex が許可を待つ間に Grok の試験用の会話（世代 `85429@2026-10-08T13:38:57.227315Z`）が台本の時間切れで閉じた。Codex の返信 `t110d-225322-reply` は閉じた世代あてに受信箱の pending に置かれた。
- 実地の検証: その返信は製品の判定（`adapter.inboxState`）で `orphaned`（宛先の世代が台帳に無い。このままでは届かない）になる。23:29 JST に再確認しても `orphaned`。再送も、別の世代への配達もしていない（約束 2 番どおり）。
- やり直し: 同じ会話を `grok --resume` で開き直した（世代 `82960@2026-10-08T14:04:31.522549Z`）。Grok が依頼 `t110d2-232411` を Codex へ送った。
- 段（Grok → Codex、Grok の会話を送り手とする status）: 受理 14:24:23.355Z、届いた 14:24:23.643Z、読んだ 14:24:23.643Z、返信 14:25:15.582Z。返信 `t110d2-232411-reply` は Grok の受信箱で delivered（世代 82960、受理 14:24:35.106Z、届いた 14:25:15.713Z）。返信の段の時刻（Grok の記録の行の時刻）が受領記録の時刻（hook が書いた時刻）より 131 ms 早いのは、同じ出来事を別の時計で記録したため。
- Codex の判断: 「更新された承認範囲に従い、`t110d2-232411` に『了解（Codex）』を返信します」。契約の直しの後、立花さんの許可を求めずに返信した。Codex は返信の後に Grok への新しい依頼を作っていない。
- 試験用の Grok は全部閉じた: 世代 82960 は 23:25:38 に `exit` を打ち、23:25:42 に終了した。T1-10a の台本が開いた世代（pid 8140、19:09 起動）は最後の `/exit` が効かずに残っていたので、23:29 に SIGTERM で閉じた（手は終わっていて、受信箱に待ちは無かった）。17:24 に立花さんの端末から開いた Grok（pid 77155）は触っていない。

### TC-4 Claude⇄Codex の返信の後に依頼が増えない（2026-10-08 23:29 JST）

- 自動試験: tests/inbound.test.ts に「ten minutes after a Codex reply arrives (test clock), seamless has made no new request」を足した。Claude の会話が Codex へ 1 件送り、Codex の返信（replyTo つき）が届く。band と sessions を呼び、試験の時計を 10 分進めてもう一度呼ぶ。予約の件数は 1 件、送信の回数は 1 回のまま。`node --test tests/inbound.test.ts` は 21 件すべて通過。
- 実測（予約の記録 `~/.seamless/reservations` を、この会話が関わる分だけ数えた。14:29:44Z）:

| 依頼 ID | 送り手 | 宛先 | 受理 |
|---|---|---|---|
| t110a-190942 | この会話 | Grok | 10:09:43Z |
| t110c-223447-reply | この会話 | Grok | 13:35:34Z |
| tc1-223931 | この会話 | Codex | 13:39:31Z |
| tc1-223931-result | Codex | この会話 | 13:52:51Z |

- Codex の返信の受け取り（13:52:51Z）から 37 分後も、この会話と Codex の間の依頼は 2 件のまま（この会話が送り手の依頼は全部で 3 件）。自動で増えた依頼は無い。

### 気づいたこと: status は送り手の会話の記録の末尾 200 行だけを見る

- 23:29 JST に `status tc1-223931` を引くと、返信の段が unobserved になった（13:52 には observed）。原因: Claude の記録の構造を読む `projectClaudeStructure` は末尾 200 行だけを見る。返信を受けた行（13:52:52Z の待ち行列の行）は、その後の作業で約 2,900 行前になり、窓の外に出た。
- この上限は claudex の初めのコミット（eb09f24）からあり、今回の変更で入ったものではない。見えない段を「未確認」と出すので、約束 4 番（分からないことを成功にしない）には反しない。今回の範囲では直さない。長い会話で古い依頼の返信を後から確かめる用途が出たら、別の作業で窓の広げ方を決める。

### 先送りの支払い（2026-10-08 23:30〜23:50 JST、支払期日は T1-11 の前）

- 受信箱の状態を 6 つから 5 つにした（pending、handed、delivered、failed、unknown）。取ってから返すまでの間だけを表す `delivering` と、それを `pending` に戻す回収を外した。hook は `pending` から `handed`（hook の pid を名前に入れる）へ 1 回の改名で取る。取った hook が受領記録の前に死ねば、次の hook が `unknown` に移す（文脈に入ったか分からないので戻さない。約束 6 番の自動再送をしない側に倒れる）。呼び出し元の無かった `waiting()` を消した。
- `failed` は残した。点検は「改ざんのときしか使わない」としたが、送り手と hook の版がずれたとき（今日の Codex Desktop の古い MCP のような場合）にも検証を通らない封筒が出る。これを `unknown`（成否不明）にすると、渡していない封筒を渡したかもしれないと言うことになり、事実と違う。`pending` に残すと「受理・未配信」が消えず、hook が毎回読み直す。帯の表示は今の「未確認」のまま変えない。
- 計画の文言（Plans.md の配送の節、tasks.md の T1-4）を 5 状態に直した。
- 配送の穴探しの試験の不足 6 件をすべて足した。

| # | 足した試験 | 壊した判定 | 結果 |
|---|---|---|---|
| 1 | 生きている hook が取った封筒を、次の hook が動かさない | 回収で pid の生存を見ない | 1 件失敗 |
| 2 | 別の会話あての封筒、名前と送り手と ID が合わない封筒は failed へ、後ろの正しい封筒は届く | 宛先の照合を外す / 名前の照合を外す | 各 1 件失敗 |
| 2 | 台帳の行より後に起動したプロセス（pid の使い回し）の hook は何も渡さない | 行の開始時刻を見ない | 1 件失敗 |
| 3 | 「読んだ」は hook の Stop の後の発話か道具の呼び出し。利用者の発話と、その Stop より前の発話は数えない | 道具を数えない / 利用者の発話も数える / Stop の前も数える | 各 1 件失敗 |
| 4 | 相手の記録に時刻が無いとき「5 分以上動いていない」と出さない（帯の単体と開いた帯） | 時刻が無ければ 0 とみなす | 2 件失敗 |
| 5 | 送信の部品は書き込みの直前に認可を取り直し、拒まれたら何も置かない | 取り直しを外す | 1 件失敗 |
| 5 | 予約の外で同じ依頼が受信箱にあるときは置き直さず成否不明 | 既にあっても受理と答える | 1 件失敗 |
| 6 | Grok の hook の行は、seamless の hook が成功した Stop の行だけを数える | 成功の条件を外す / Stop の条件を外す | 各 1 件失敗 |

- 壊した 12 通りすべてで、足した試験が落ちた（作業ツリーの写しで 1 つずつ壊して走らせた。作業ツリーは変えていない）。
- 実地検査の回数: team-build の「L では施工と逆の家系に実地検査を 1 回」に従う。この計画では T1-11 の前に実地検査を増やさない。
- 実会話の証拠の範囲: T1-10a〜f の 4 段の観測は、本線 d784be8 の hook（`delivering` があった版）で取ったもの。Grok が呼ぶ hook は本線の checkout の `src/grok-hook.ts` を指すので、今回の hook の直しを実会話で確かめるには、立花さんの本線への取り込み（ff、push なし）が先に要る。取り込みの後に Claude → Grok を 1 回やり直す。それまで、hook の直しの根拠は自動試験と上の壊し方の確認だけ。

## T1-11 P1 の判定（2026-10-08 23:42〜23:52 JST、判定した版 20c41e3、比べる元 4fa898e）

- 判定役: Codex `gpt-6-astra`、推論 xhigh、読み取り専用（`codex-headless exec -s read-only`）。作ったのは Claude なので逆の家系。依頼文は `.local/t111/judge-prompt.md`、結果は `.local/t111/judge.md`。
- 結果: FAIL。不成立は「確かめること」の 1、6、12。2〜5、7〜11 は Yes。
  1. AC1: 止まった会話を製品の一覧で引き、「動いている」と出なかった実測が無い（台帳の観測だけ）。
  6. AC8: 台帳の行に作業場所の項目そのものが無いと、読み取りがその行を捨て、止まった会話の走査が保存先のフォルダ名から作業場所を補って一覧に戻す。
  12. セキュリティ: 受信箱のディレクトリの検査は書くときだけで、hook は読む前に確かめない。書いた後に 0700 でなくなったり symlink に替わったりしても配達する。
- 残件（判定役）: 直した hook の実会話は未実測。別 ID の同じ内容を止める期限（前の計画の 24 時間）を今回の Plans に書く余地がある。末尾 200 行の窓。
- 図面検査（必須、Claude `claude-haiku-5-5`、推論 medium、読み取り専用）: FAIL。食い違いは、Plans.md と実装（受領記録の名前、処理開始の基準、hook の入力の cwd、受領記録の項目、hook_annotation の位置、orphaned の扱い）、記録の欠け（T1-9 の返事、T1-10b の Codex の版、T1-10d の呼び手、T1-10f の 10 分の前後、TC-1 の verify、AC ごとの対応）、書類どうし（H6 の push、T1-9 の H5、127 行の古い状態）。T1-7 の「名乗りだけ」の試験が無いという指摘は読み違い（`tests/caller-scan.test.ts` の 271 行にある）。結果は `.local/t111/haiku.md`。
- 別の敵対（穴探し）は頼んでいない。判定役が判定の後に兼ねた。

## T1-12 判定の指摘の直し（2026-10-08 23:52〜23:59 JST）

- 番号 6: 台帳に形の崩れた行が 1 つでもあれば、台帳全体を読めないもの（null）とする。読めない台帳では、一覧に Grok の会話を 1 件も出さず（動いている会話も止まった会話も）、hook は配達せず、呼び手は特定しない。試験「a ledger row without its working directory makes the ledger unreadable」を足した。崩れた行だけを捨てる形に戻すとその試験が落ちる。
- 番号 12: hook は読む前に、`~/.seamless`、`grok-inbox`、会話のディレクトリ、5 つの状態のディレクトリが、本人の 0700 の実ディレクトリ（symlink でない）かを確かめ直す（`inboxSafe`）。違えば何も取らない（reason `unsafe_inbox`）。試験「an inbox whose directories changed after the write」を足した（pending を 0755 にした場合と、delivered を symlink に替えた場合）。確かめ直しを外すとその試験が落ちる。
- 番号 1: 止まった会話の一覧の実測（2026-10-08 23:53:48 JST、この作業場所で `node src/cli.ts sessions`）。台帳には立花さんの Grok（pid 77155、別の作業場所）だけ。既定の一覧に Grok の会話は 0 件（止まった会話は隠れ、offlineHidden 16）。止まった会話を含める一覧（`{"includeOffline":true}`）では、試験で開いて閉じた 2 つの会話 `grok:01a11afd-…`（19:09 の世代、23:29 に閉じた）と `grok:01a11bbd-…`（23:04 の世代、23:25 に閉じた）が、どちらも `offline`、理由 `process_exited`、切符なしで出た。「動いている」とは出ていない。
- 図面検査の指摘: Plans.md の配送、配信確認、処理開始、未配信の節を実装に合わせた（受領記録の名前と項目、hook は入力の cwd を使わない、hook_annotation は Stop の行の後で次の利用者の発話より前の最初の 1 件、処理開始は配信確認の Stop の行より後で利用者の発話を数えない、orphaned は台帳から推した表示、形の崩れた台帳）。H6 を「取り込み（ff、push なし）は実会話の前、push は判定 PASS の後」に直した。tasks.md の T1-9 の前提から H5 の文を外した。127 行の古い記述に注記を付けた。
- 欠けていた記録:
  - T1-9 の返事: 「可」（T1-9 の節に足した）。
  - T1-10b の Codex の版: ChatGPT.app 26.1002.52244、同梱の codex-cli 0.162.0-alpha.2。アプリの更新は 2026-10-07 16:03 が最後なので、T1-10b（10-08 22:52）の時点も同じ版。
  - T1-10d の呼び手: 依頼 `t110d2-232411` の予約の送り手は `grok:01a11bbd-0cd6-79e3-8d1a-fccd1783d6d1`、世代 `82960@2026-10-08T14:04:31.522549Z`（開き直した Grok の画面の台帳の行と同じ）。送り手が Grok になるのは、呼び手が Grok の祖先として特定されたとき（`grok-ancestor`）だけ。
  - T1-10f の 10 分の前後: Grok の返信 `t110a-190942-reply` の受理は 10:15:09.872Z。その時点でこの会話が送り手の依頼は 1 件（`t110a-190942`）。10 分後の 10:25:09Z も 1 件。次の依頼は 13:35:23Z の `t110c-223447`（Grok が送った別の試験）。予約の記録 `~/.seamless/reservations` の受理時刻で数えた。
  - TC-1 の verify: TC-1（22:39〜22:52）の直前の版 3f8ce0b（22:37）で exit 0。後の版 d784be8（454 件と帯 98 件）、3429ce3（455 件と帯 98 件）、20c41e3（462 件と帯 99 件）でも exit 0。
- 判定役の残件「別 ID の同じ内容を止める期限」: 前の計画（specs/202610-everyday-use/Plans.md）の 24 時間を Grok の経路も同じ予約の仕組みで使う。今回は Plans に書き足さない（予約の仕組みは変えていない）。
- 気づいたこと（窓）の補足: 末尾 200 行の窓は、Grok の会話の記録（宛先の構造）にも効く。受領記録の後に Grok の記録が 200 項目を超えると、配信確認と処理開始が「未確認」に戻る。Claude の場合と同じく、見えない段を成功にはしない。

### AC と証拠の対応（P1 の分）

| AC | 自動試験 | 実会話と実測 |
|---|---|---|
| AC1 一覧 | tests/grok-scan.test.ts（動いている会話、止まった会話は既定で隠れ includeOffline で offline、pid の使い回し、二重起動、headless と下請けを出さない、崩れた台帳） | T0-1、P1 の事前の実機確認、T1-12 の止まった会話の一覧 |
| AC2 Claude か Codex → Grok の 4 段、別の世代に届かない | tests/grok-status.test.ts（4 段、受領記録だけ、hook の行だけ、別の世代の受領記録、次の利用者の発話の後の Stop、別の hook、別の ID、続きの Stop、処理開始の境目、ファイルから）、tests/grok-hook.test.ts（別の世代の封筒は pending のまま） | T1-10a（Claude → Grok）、T1-10b（Codex → Grok）。否定の実例: 閉じた世代あての返信 `t110d-225322-reply` は orphaned で届かない（T1-10d のやり直しの節） |
| AC3 Grok → Claude か Codex、名乗りでは通さない | tests/caller-scan.test.ts の 251〜299 行（台帳と作業場所と署名、名乗りだけは caller_unobserved（271 行）、headless の grok で祖先の探索を止める、pid の使い回し） | T1-10c（Grok → Claude）、T1-10d のやり直し（Grok → Codex） |
| AC6 返信の後に依頼が増えない | tests/grok-status.test.ts の 87 行（Grok）、tests/inbound.test.ts の 79 行（Claude⇄Codex） | T1-10f（Grok、10 分の前後で 1 件）、TC-4（Claude⇄Codex、37 分後も 2 件） |
| AC7 Grok の受信箱の経路で再実行しない | tests/grok-send.test.ts の 26、30、81 行（同じ ID、書き込み後の切断、予約の外の同じ ID）、tests/grok-hook.test.ts（取った hook が死んだら unknown で戻さない） | なし（実会話で切断は起こしていない） |
| AC8 Grok の範囲の拒否、受信で設定が変わらない | tests/automatic.test.ts の 542 行（作業場所が読めない台帳、壊れた制限、範囲外の名指しで一覧、読む、送るを拒否）、570 行と 584 行（受信の前後で Claude、Codex、Grok の承認と sandbox の設定の hash が同じ）、tests/grok-scan.test.ts の 111 行（崩れた台帳） | なし |
| AC9 Grok の会話を読む | tests/grok-read.test.ts | T1-10e |
| AC10 既存の往復と全試験 | `bash scripts/verify.sh` | TC-1（Claude ⇄ Codex の 4 段） |

### T1-12 の再判定（2026-10-09 00:00〜00:04 JST、判定した版 3b9196d）

- 判定役: Codex `gpt-6-astra`、推論 xhigh、読み取り専用。渡したのは前回の判定文、`git diff 20c41e3 3b9196d`、直した版の試験の実結果（`bash scripts/verify.sh` exit 0、node 464 件、帯 99 件）の 3 つ。結果は `.local/t111/rejudge.md`。
- 結果: PASS（確信度 high）。前回 No の 1、6、12 は Yes。前回 Yes の 2〜5、7〜11 を壊す変更は無い。FAIL の項目は無い。
- 判定役の残件（人の出口へ渡す）: 直した hook の実会話は未実測（本線への取り込みの後に Claude → Grok を 1 回）。別 ID の同じ内容を止める期限は 24 時間（期限なしの抑止を確かめた判定ではない）。末尾 200 項目の窓。
- 図面検査の 2 回目（Claude `claude-haiku-5-5`、版 3b9196d）: FAIL。前回の指摘はほぼ直ったとした。残りは書類の細部で、次のとおり片付けた。
  - 3b9196d の verify の結果が evidence に無い → この節に書いた（exit 0、node 464 件、帯 99 件）。
  - 末尾 200 項目の窓が Plans.md に無い → Plans.md の配送の節に「見える範囲の上限」を足した。
  - T1-8 の Done は一覧も「拒否」と書くが、試験は成功の応答で候補 0 件を確かめる → 一覧の拒否は「その会話を候補に出さないこと」と tasks.md に書き足した（試験の中の注記と同じ意味。読むと送るは拒否の status）。
  - spec.md の配信確認（受領記録と hook の行）と処理開始（依頼の後の発話か道具の呼び出し）は、Plans.md と実装（hook が渡した文の記録も要る、配信確認の Stop の後で数える）より緩い → 実装は spec の条件を満たしたうえで厳しくしている向きなので、spec.md は変えない。
  - 計画の見出しの「図面検査 22 回目 PASS」が実装の判定と紛らわしい → 「計画の図面検査」と書き、実装の判定 PASS（3b9196d）を並べた。
- TC-2: GOD_Plans.md の行の状態と、ルートの Plans.md に足したこの計画の節の「最終更新」に、判定役が読んだ版 3b9196d を写した。
- 判定と図面検査の原文: `reviews/` に写した（t1-11-judge-20c41e3.md、t1-12-rejudge-3b9196d.md、t1-11-drawing-20c41e3.md、t1-12-drawing-3b9196d.md）。判定は書き換えていない。
- 図面検査の 3 回目は回していない。理由: team-review の「PASS でその依頼のレビュー工程は閉じ、残件を理由に開き直さない」と、本人の判断 A（守りの上積みは止める）。2 回目の指摘は書類の細部で、0b370ac で片付けた。3 回目を回すかは立花さんが決める。
- tasks.md の T1-8 の Done の文言（一覧の拒否は候補に出さないこと）は、判定の後に実装に合わせて書き足した。判定役は試験の中身（候補 0 件）を見て Yes を出しているので、判定と食い違わない。

### 取り込みまでの版ずれ（2026-10-09 00:10 JST）

- 今、本線 d784be8 の hook は `pending` から `delivering/` への改名で封筒を取る。作業ツリー（20c41e3 以降）の送り手は、新しい会話の受信箱に `delivering/` を作らない（5 状態）。この組み合わせでは、本線の hook は改名に失敗して何も渡さず、封筒は pending に残り、帯は「受理・未配信」のまま。
- 当たるのは「作業ツリーの `node src/cli.ts send` から、受信箱がまだ無い Grok の会話へ送る」ときだけ。既存の受信箱（`01a11afd`、`01a11bbd`）には古い `delivering/` があり、常用の MCP（Claude、Codex、Grok）は本線の古い送り手なので当たらない。取り込みの後は送り手も hook も新しい版になり、当たらない（古い送り手の MCP が作る `delivering/` は新しい hook が無視する）。
- よって、取り込みまで作業ツリーの CLI から新しい Grok の会話へは送らない。取り込みの後の実会話のやり直しは、新しい Grok の会話を 1 つ開いて行う（5 状態の受信箱と新しい hook の経路を通す形）。余力があれば `--resume 01a11bbd` で、閉じた世代あての封筒に新しい hook が触らないことも確かめる。

### 本線への取り込みが止まった（2026-10-09 00:20 JST）

- 立花さんの `git -C ~/LocalWork/Code/seamless merge --ff-only claude/seamless-claude-codex-c2a20e` は「Plans.md の手元の変更が上書きされる」で止まった（本線は d784be8 のまま）。
- 原因: 本線の作業ツリーに、別の会話の Dot の作業（2026-10-08 23:26、未コミット）がある。ルートの Plans.md に 2 行、ルートの spec.md、specs/202610-more-peers/spec.md の Q5、未追跡の `experiments/dot-events/` と `specs/202610-more-peers/dot-events-integration.md`。このブランチと重なるのは、TC-2 で足したルートの Plans.md の節だけ。
- 対処: Dot の作業には触らない（隠さない、退避しない、消さない）。このブランチのルートの Plans.md を本線 d784be8 の版に戻し、取り込みが Plans.md を変えないようにした。TC-2 のうちルートの Plans.md の「最終更新」の行（3b9196d）は、Dot の作業が本線にコミットされた後に足す。GOD_Plans.md の行には 3b9196d を写してある。

## Codex の会話（codex:01a11bd4）の Dot の作業の取り込み（2026-10-09 10:15〜10:55 JST）

立花さんの依頼「このスレッドからやりとり把握し、Dot対応に生かして」。その会話を seamless の read で読み（発話 14 件、2026-10-08 23:04〜23:35 JST）、読み手 4、設計 2、反証 1、まとめ 1 の計 8 体で突き合わせた（読み取りだけ。workflow `wf_eeb0d679-6ed`、結果は会話の記録の作業フォルダ）。本線の作業ツリーにある Codex の未コミットの作業（ルートの Plans.md と spec.md、この機能の spec.md の Q5、`experiments/dot-events/`、`dot-events-integration.md`）には書き込んでいない。

### その会話でしたこと（読み手の確認つき）

- 立花さんの依頼は 2 つ。「記事（X の yoshio_nocode）を読んで Dot を MCP Events に対応させ、seamless に内包したい」と、後から「プラグインの仕組みで Codex 側にも画面を出したい」。
- Codex は本体の src を変えていない。現行の MCP が Events に未対応であること（initialize は 2025-06-18、server/discover と events/* は未知のメソッド）を隔離して確かめ、本体に接続しない試作 `experiments/dot-events`（17 試験）を作り、内包案を書いた。試作と文書の整合は Claude Opus の判定と Haiku の図面検査で PASS。AC11a〜c の製品の合格ではない。
- Codex の Q5 の推奨は、Dot 専用の HTTP 入口に OAuth 2.1 を付け、認証した ChatGPT の接続を名簿の登録に結ぶ形。23:35 JST の前の発話で「この方式で本体実装を進めてよいですか」と聞いた。立花さんはそれを見たうえで、次の発話で別の話題（Codex 側の画面）を出しており、この問いへの答えは無い。
- 試作の手直しが要る点（読み手が再現）: secret を購読の JSON に平文で置く、送信先が無いと予約だけ残り同じ依頼 ID が使えなくなる、同じ secret の再購読が確認に失敗すると有効な購読まで止まる。

### 突き合わせて分かったこと

- Codex の推奨（認可サーバーを Mac に置く OAuth）は採らないほうがよい。理由は 3 つ。待受サーバー、常駐処理、接続設定の変更、公開の口、鍵の保管の止まる条件に最も多く当たる。利用者が立花さん 1 人の認可サーバーでは subject がいつも本人になり、AC11c の「別のアカウントの接続は拒む」の試験が成り立たない。認証で示せるのは登録した ChatGPT の接続までで、Dot と通常の ChatGPT の会話を区別できる値が届くかは誰も観測していない。
- 公式の説明（learn.chatgpt.com/docs/dots/computers-and-apps、2026-10-09 に私が取得）: 「自分のパソコン」の許可を入れると、Dot はローカルの Codex のタスクを作り、既存のタスクを続けられる（"continue existing local Codex tasks"）。スマホから話しかけても同じ。記事の構図はこの経路で、MCP と Tunnel と OAuth の経路ではない。この経路は seamless を通らず、seamless の認証では塞げない。
- 設計 2 体の推奨は割れた。安全優先は「Dot 用の入口を開けず、購読も受けない。接続しない準備だけ進める」。本人の手間優先は「Dot 専用の tunnel と stdio の入口と宛先の許可リスト」。反証役は後者を崩した（AC11c の「_meta の自己申告では通さない」と、止まる条件の「鍵を送り手の登録に結び付けない設計」に当たる）。
- 先に測るべき事実は 2 つ。Dot が自作の MCP を Tunnel 越しに呼べるか。Dot と通常の Chat で区別できる値が届くか。測定用のスタブ（M1）は、動いている tunnel-client が 0.0.9（2026-05-21 版）で MCP 2.0 の扱いが docs に無い点と、スタブが events を宣言しないと購読が来ない点を直してから行う。
- Codex 内の状態パネル: 包み `codex-plugin/seamless-status`（b5f3352）は既にあり、導入の承認待ち（status-ui の C1b）。画面に出たことはまだ無い（2026-10-05 の実機でタブが出なかった）。AC11a〜c にパネルの要件は無いので、P3 には入れず status-ui の作業として扱うのを推す。
- 別件の気づき: コミット 0b12976（2026-10-06）で `specs/202610-status-ui/evidence.md` の 90 行が消え、4 行に置き換わっている（C1b の準備の節など）。意図か誤りかは未確認。ここでは書き換えていない。

### 立花さんの判断が要ること（案。2026-10-09 時点で未決）

1. P3 の範囲（Q5 より先に決める）: Dot から Mac への流れを seamless が受け持つか。
   - (a) 受け持たない。seamless の Dot 対応は Mac から Dot への通知（MCP Events）に絞る。Dot から Mac への依頼と返事は、「自分のパソコン」の許可で Dot が作るローカルの Codex のタスクとして入り、Claude や Grok へは、その Codex のタスクが seamless で送る。Q5 は「誰が購読してよいか」に縮む。AC11c の Dot から Mac の部分を外すので、承認済みの本文の変更になる。「自分のパソコン」の許可を入れるかは別の判断。Dot が作った Codex のタスクを seamless が普通の Codex の会話として扱えるかは未確認。
   - (b) 受け持つ。方式は M1 の後に決める。Codex の推奨（Mac に認可サーバーを置く OAuth）は採らない。
   - どちらでも、M1 までは Dot 用の入口を開けず、購読も受けない。推奨は (a) 寄り。記事の経路と同じで、Dot から Mac の呼び手を確かめる難所（Q5 の大半）を通らずに済む。Codex の会話の「本体実装を進めてよいですか」への答えは、どちらでも今は「いいえ」。
2. M1 の第 1 段（立花さんの約 3 分の画面の読み取り確認、スタブの作成と単体試験、tunnel-client の版の特定。ダウンロードと tunnel の作成と実行は第 2 段で別に go をもらう）（推奨: 承認）。
3. Dot への配送を契約の事前承認に含めるか（Plans.md の H10。推奨: 含めない）。

### 作業の分担（Codex の会話と）

- 同じファイルを両方が書くと取り込みがぶつかる。Codex の会話が本線で Dot の作業をコミットするまで、このブランチはルートの Plans.md、ルートの spec.md、この機能の spec.md、dot-events-integration.md を書かない（ルートの Plans.md は 6bddcb1 で本線の版に戻した）。
- このブランチが書くのは tasks.md の P3、evidence.md、Plans.md の H10、reviews/、experiments/dot-m1/。試作 `experiments/dot-events` の試験の追加（T3-8）は Codex の会話の担当にする案。
- Codex の会話へ、分担の事実だけを seamless で送った（依頼 `dot-coord-20261009`、2026-10-09 10:58 JST、submitted）。中身は上の 2 点と、Q5 は立花さんの判断待ちで判断が出たら改めて送ること。Q5 の推奨は入れていない。

## 本線への取り込みの後の実会話（直した hook、2026-10-09 11:11〜11:17 JST）

- 立花さんの `merge --ff-only` で本線は e03ab4e になった（d784be8 から）。Grok が呼ぶ hook（本線の `src/grok-hook.ts`）は、受信箱から delivering を外し、読む前に受信箱のディレクトリを確かめ直す版になった。status-ui の復元（8ff9ba3、e520f98）とこの記録は、この取り込みより後のコミット。
- 新しい会話で確かめた（「取り込みまでの版ずれ」の節のとおり）。Grok の画面を擬似端末で開き（会話 `grok:01a11e6e-6bb4-76c2-ae6d-f04359fbea1f`、世代 `70806@2026-10-09T02:11:57.284730Z`、作業場所はこのブランチの作業ツリー）、この会話から作業ツリーの CLI で依頼 `t1r-111428` を送った。送る前は受信箱が無く、送った後は pending、handed、delivered、failed、unknown の 5 つのディレクトリで作られた（delivering は無い）。
- 段（UTC）: 受理 02:14:28.961、配信確認 02:14:44.147（Grok が 1 手を終えたとき）、処理開始 02:14:47.546、返答完了 02:15:00.855。Grok は replyTo `t1r-111428` で「受け取りました（Grok、直した hook）」をこの会話へ返した。送り主は Grok の会話と世代 70806 で、送る前と同じ世代。
- 受信箱: delivered に 1 件（名前は送り手と依頼 ID の組の SHA-256）。受領記録は会話、世代 70806、Stop の理由 end_turn、hook の名前 `global/seamless:stop[0].hooks[0]`、hook の pid 86077。pending、handed、failed、unknown は空。
- 別の世代に触らないこと: 会話 `grok:01a11bbd-…` を `--resume` で開き直した（新しい世代 `88549@2026-10-09T02:15:40.492892Z`）。受信箱の pending には、閉じた世代 85429 あての返信 `t110d-225322-reply` が残っている。1 手の終わりに seamless の hook は success で動いたが、Grok が渡された文を記録する行（hook_annotation）は出ず、pending は 1 件のまま、delivered は 2 件のまま。製品の判定は今も orphaned。古い送り手が作った delivering のディレクトリがあるこの受信箱でも、直した hook は普通に動いた。
- 試験用の 2 つの Grok は台本の `exit` で閉じた（台帳には立花さんの Grok pid 77155 だけ）。許可の確認は出ず、台本は何も承認していない。
- 気づいたこと: Grok は返信の依頼 ID に、宛先の会話の名前（`claude:3263fdb8-…`）をそのまま使った。依頼 ID は送り手が決める自由な文字列で、予約は送り手と ID の組で名前を付けるので、ほかの依頼とはぶつからない。
- 判定役の残件「直した hook の実往復は未実測」は、これで済み。

## Dot の 3 つの判断と、T3-4、T3-5（2026-10-09 13:40〜13:55 JST）

- 立花さんは早見表（seamless の今できること、できないことのページ）を見たうえで「まだできないこと 進めて」と言った（2026-10-09 13:46 JST ごろ）。Dot の欄は「立花さんの 3 つの判断待ち」だったので、これを推奨どおりの承認として扱った。どれも何も開けない側の判断で、書類を戻せば取り消せる。
  1. Dot から Mac への流れは seamless で受け持たない。seamless は Mac から Dot への通知（MCP Events）だけを持つ。Dot からの依頼は、「自分のパソコン」の許可で Dot が作るローカルの Codex のタスクとして入る。Q5 は「誰が購読してよいか」に縮む。AC11c の Dot から Mac の部分を外す spec.md の書き換えは、Codex の会話の Dot の作業が本線にコミットされた後に行う（T3-6。それまで spec.md を書かない分担のため）。
  2. 測定 M1 の第 1 段を進める。次は立花さんの約 3 分の画面の読み取り確認（T3-11）。ダウンロード、tunnel の作成、実行は第 2 段で別に go をもらう。
  3. Dot への配送は契約の事前承認に含めない（Plans.md の H10 の判断欄に記入）。
- T3-4: 既存の入口（`node src/cli.ts mcp`）に版 2026-07-28 で initialize を送ると、2025-06-18 が返り、能力は tools と resources だけで events は無い（13:47 JST に実測）。`bash scripts/verify.sh` は 38183ba で exit 0（node 464 件、帯 99 件）。既存の Claude と Codex の入口は古い版のまま動く。
- T3-5: Codex の会話の Dot の証拠のうち 10 件（checks.json、判定と図面検査の原文 5 件、probe.out、prototype-tests.out、verification.md、vector.out）を `reviews/dot-events/` に写した。写す前に、鍵、token、パスワードの形の文字列が無いことを確かめた（該当 0 件）。試作の events.ts と events.test.ts の sha256 は、checks.json の記録と本線の実ファイルで一致した。
- Codex の会話への連絡: 分担の事実（`dot-coord-20261009`、10:55 JST）と、判断の結果とお願い（`dot-decision-20261009`、13:49 JST）を送った。返事（`dot-decision-20261009-ack`）: 内包案への反映と試作の試験 4 つは引き受ける。本線へのコミットは、立花さんの直接の指示が無いので本人の確認待ち。証拠は Codex 側の別のフォルダに置き、reviews/ には写さない。Codex は私の会話を read で読み、立花さんの「進めて」を自分で確かめたうえで、実接続と本体には進まないとした。
- 気づいたこと: 1 通目（`dot-coord-20261009`）は Codex の会話に 01:55:02Z に届き、Codex が返事を書いていた（read で確認）。それでも status は「届いた」が未確認のままだった。送った後に Codex のアプリが立ち上げ直され、会話の世代が 9b2e8ff0 から 8e19beb4 に変わったため。status は送った時点の世代の記録しか照らさないので、相手の世代が変わると、それより前の依頼の段は「未確認」に戻る。届かなかったと誤って出す動きではない。

## T0-4b と T0-6 茶々丸の答え（2026-10-09 13:51 JST、`.local/grok-consult/answers.md`）

- 茶々丸（Grok Bot）が、questions.md の Q1〜Q6 に answers.md で答えた。根拠は茶々丸の手元のルーチンの説明だけで、推測で埋めた所は無いと明記している。鍵と URL の値は書いていない。立花さんがこの会話に要約を貼った。
- 茶々丸の手元の説明にあるのは 4 点: ルーチンは trigger `{ "type": "webhook" }` で、その URL への POST で動く。URL と送信鍵は立花さんがアプリのルーチンの画面からコピーし、Bot は鍵を見ず使わない。Bot は中身を `<webhook_event>` として読む。ルーチンの実行には成功と失敗の記録が残る。

| 問い | 答え | 採る値 |
|---|---|---|
| Q1 POST の大きさの上限 | 未公開 | 既定: 1 回の POST に 1 封筒、本文 8,000 字まで（超えたら text_too_long） |
| Q2 受け付けたときの応答 | 未公開 | 既定: 2xx を受理、2xx 以外を不受理。応答の本文の印には頼らない |
| Q3 順序 | 未公開 | 既定: 順序を仮定しない |
| Q4 送り直しと重複 | 未公開。同じ中身が 2 回届くと Bot は別々の起動として読む。見分けるには封筒の一意な ID を Bot 側で記録して比べる必要がある | 既定: seamless からは送り直さない。封筒には依頼 ID を入れる（既にそうしている） |
| Q5（T0-6）茶々丸が Mac で CLI を動かす経路 | 既存の経路でできる。登録済みの Mac で、立花さんの承認つきで 1 コマンドずつ実行でき、パイプかヒアドキュメントで標準入力に JSON を渡せる。2026-10-08 にこの経路で `node src/cli.ts send` を実行し、送り手の確認で `caller_unobserved`（`native_ancestor_missing`）になった | 既存の経路。新しい常駐処理や公開の口は要らないので、H9（受ける経路を範囲から外すか）は不要。受ける経路（T2-3）の入口の条件がそろった |
| Q6 送信鍵の入れ方 | 未公開。確かめ方は 2 つ: 立花さんがルーチンの画面で鍵の欄の近くの説明や例を見る、または試しの POST を 1 件送って実行の記録に残るかを見る | 未決。送る経路（T2-2）の、鍵を入れる場所だけが決まらない。T2-2 は、受理の記録、予約、送り直しの禁止、保守的な既定を先に作り、鍵を入れる場所は小さな部品に閉じ込めて、確かめた後に差し替える |

- T0-4b の Done when（4 問それぞれに答えか未公開と、採る値）と、T0-6 の Done when（「既存の経路」）は満たした。
- Q6 を確かめる 2 つの方法は、どちらも立花さんの手が要る。試しの POST は外部送信で、Grok Bot 側のルーチン（H2）と、住所と鍵の環境変数（H3）と、外部送信の判断（H7）が先に要る。画面の説明を見るほうが手前でできる。

## T3-7 試作から本体へ取り込む前に決める 7 項目（案、2026-10-09）

AC11a の「受ける意思の確認」は、callback の URL が challenge の値をそのまま返すこと（ChatGPT 側の受け口の確認）で、人の承認ではない。人の承認と取り違えると、購読を「保留」で受ける形になり、MCP Events の手順（購読を受ける前に callback を確かめ、id と refreshBefore を返す）と合わなくなる。

| # | 項目 | 案 | 理由 | 承認 |
|---|---|---|---|---|
| 1 | secret の保管場所 | 採る: secret の本体は macOS の Keychain（OS が管理する秘密の保管場所）に置き、購読の記録には secret の版と Keychain の参照だけを書く | AC11a は記録に secret の版を、AC11b は記録に secret を書かないことを求める。試作は購読の JSON に平文で置いていた | 立花さんの承認が要る（新しい秘密の置き場。Keychain への登録と読み取りは実装の段階で別に確かめる） |
| 2 | 送信先が無いときの予約 | 採る: 送信先（有効な購読）を確かめてから予約を作る。無ければ予約を作らず no_destination で拒否する | 試作は予約を先に作り、同じ依頼 ID が後で使えなくなっていた。本体の既存の方針（書き込む前の拒否では予約を使わない）と同じにする。Codex の会話が T3-8 で同じ受け入れの条件を引き受けた | 不要 |
| 3 | 同じ secret の再購読が確認に失敗したとき | 採る: 有効だった購読は配送を続ける。新しい確認が通るまで、新しい状態は別に持つ | AC11a の「同じ鍵の再購読は期限を延ばすだけ」の失敗側。試作は有効な購読まで止めていた（読み手が再現）。Codex の会話が T3-8 で引き受けた | 不要 |
| 4 | 購読 ID に grant を含めるか | 採らない: 購読 ID の材料は AC11a の文言どおり（登録名、callback、イベント名、引数）にする | Dot から Mac の流れを持たない判断（2026-10-09 の判断 1）で、Mac 側の grant の考え方が要らなくなった。「誰が購読してよいか」の確かめ方が決まったら、その主体を材料に入れるかを決め直す | 不要（AC の文面どおり） |
| 5 | webhook-id と message.id の文字の検査 | 採る: 依頼 ID と同じ範囲（1〜256 字、制御文字と空白なし）に限る | Standard Webhooks の webhook-id は署名の対象に入るので、区切りの文字が混ざると別の封筒と同じ署名の対象になりうる | 不要 |
| 6 | 通信の打ち切り | 採る: callback の確認と配送は 10 秒で AbortSignal により通信を打ち切る | 試作は時計を比べるだけで、通信は続いていた。Codex の会話が T3-8 で引き受けた | 不要 |
| 7 | 予約の後の親のディレクトリの fsync | 採る: 予約のファイルを作った後に親のディレクトリも fsync する | ファイルの中身は書き切っても、ディレクトリの記録が残らないと、電源が落ちたときに予約が消え、二重に送る余地が残る。本体の今の予約（request-store、delivery）もファイルの sync だけで、親のディレクトリの fsync は無い（2026-10-09 に確認）。本体の分は Dot と別に直すかを決める | 不要 |

## T3-10 Dot から Mac に届く 2 つの経路（2026-10-09）

| 経路 | 通るもの | seamless で守れるか |
|---|---|---|
| seamless を通る | Mac から Dot への通知（MCP Events。seamless が callback へ署名つきで POST する）。2026-10-09 の判断 1 で、seamless が受け持つのはこの向きだけ | 守れる。購読してよい相手の確かめ方（縮んだ Q5）が決まるまで、Dot 用の入口は開けない |
| seamless を通らない | 「自分のパソコン」の許可を入れた Dot が、ローカルの Codex のタスクを作り、既存のタスクを続ける | seamless の認証では塞げない。許可を入れるかは立花さんが別に決める。Dot が作った Codex のタスクを seamless が普通の Codex の会話として扱えるかは未確認 |

- 出典（公式）: learn.chatgpt.com/docs/dots/computers-and-apps（2026-10-09 に私が取得。"Your dot can create local Work or Codex tasks and continue existing local Codex tasks"、"Access to your computer applies wherever you message the same dot, including from your phone"、"Your dot can use supported plugins installed and enabled for your account"）。developers.openai.com/plugins/build/mcp-events（Events の通知は callback の URL への HTTPS の POST で届き、購読を受ける前に callback を確かめる。2026-10-09 の読み手の取得）。

## T3-8 試作の試験 4 つ（Codex の会話、2026-10-09 13:55 JST に結果の返事 `dot-decision-20261009-result`）

- Codex の会話が引き受けた b（内包案への反映）と c（試作の試験 4 つ）が済んだ。src と設定は触っていない。本線へのコミット（a）は、立花さんの直接の指示が無いので未実施。
- 内包案への反映: 通知の一方向（Mac から Dot だけ）、M1 の 2 段、H10 は 1 件ごとの確認、Dot と通常の Chat の区別は未観測、Codex 用のパネルの包み（b5f3352）、callback の確認は人の承認ではないこと。
- 試作の試験: 同じ secret の更新の確認に失敗しても前の購読を続ける、模擬の DNS で危険な IP と接続先の変更を拒む、実のタイマーの 10 秒で模擬の通信を打ち切る、宛先が無いときは予約を使わない、の 4 つを足した。試作は 21 試験、型検査、独立の Python の署名計算、隔離した probe、本体の verify（464 件と帯 99 件）がすべて実際の終了コード 0。判定は Claude Opus 5.5（high）が試作を PASS、Claude Haiku 5.5（medium）が範囲と記録の照合を PASS。
- 試作の sha256（私が本線の実ファイルで計算して一致を確認）: events.ts e0f2772301113e4e…、events.test.ts cb970d193d2217af…。検証した本線の版は 38183ba。
- 記録の置き場: 本線の `.local/dot-events/20261009-fixes/`。途中で 10 月 8 日の checks.json を保存先の取り違えで一時的に上書きし、私が写した `reviews/dot-events/checks.json` から戻した、と Codex が報告した。戻った中身は、写しとバイト単位で一致した（私が cmp で確認）。
- Codex が挙げた本体への残件: 実際の通信での、本文を送る前の照合など。Q5 と本体の実装は承認済みとして扱っていない。
- 残る判断: Codex の会話の Dot の作業（本線の作業ツリーの未コミットの変更）を本線にコミットするか。コミットが済めば、spec.md の AC11c と Q5 を判断 1 に合わせて直し（T3-6）、ルートの Plans.md に判定の版の行を足せる（TC-2 の残り）。

## T2-1 と T2-6 名簿と鍵の漏れの確認（2026-10-09 13:52〜15:16 JST、19c9cde）

- 作り: 施工役 1 体（Claude Sonnet 5.5）が試験と実装を書き、照合役と穴探し役（どちらも Claude、読み取り専用。壊す試しは複製で行った）が独立に崩し、直し役が直した（workflow `wf_a74aa850-b09`）。新しいファイルは `src/peers.ts`、`scripts/peer-env-names.ts`、`scripts/peer-secrets.sh`、`tests/peers.test.ts`。変えたのは `src/automatic.ts`（一覧に external を足す）と `scripts/verify.sh`（確認を呼ぶ）。
- T2-1: 名簿 `~/.seamless/peers.json` を、制限の設定と同じ本人だけのファイルの確かめ方（lstat、symlink を辿らない、同じ inode、mode 0600、所有者）で、操作のたびに読み直す。形が崩れていれば名簿全体を使わない。失効した登録と範囲が未設定の登録は使えない。一覧（sessions）の external に、登録名、表示名、鍵の版、読むのは常に不可、送るの可否、状態を出し、住所と鍵は出さない。範囲が未設定の登録は一覧に出さない（AC8）。名簿の環境変数の値は読まない（試験で process.env の参照を数えて確かめた）。
- T2-6: `scripts/peer-secrets.sh` を verify.sh から呼ぶ。名簿の住所と 2 つの鍵の環境変数ごとに値を読み、空なら失敗。値が ~/.seamless、リポジトリ（作業ツリーと本線の checkout）、~/.claude/projects、~/.codex/sessions、~/.grok/sessions のどこかにあれば失敗。値は引数、出力、ファイルに出さず、失敗の行は「登録名の役割」だけを出す。名簿が無いか登録が無ければ何もせず通る（今はこれ）。
- 判定役の指摘 14 件のうち 13 件を直した。重いもの: 日本語の設定（UTF-8）のまま探すと、壊れた文字を含む行の中の値を見逃した（実データの約 5％のファイルに壊れた文字がある）→ 文字の扱いを固定（LC_ALL=C）。保存先や中のファイルが symlink だと探さずに「漏れなし」とした → symlink を辿り（BSD grep の -S）、行き先の無い symlink は失敗。xtrace で値が標準エラーに出た → 先頭で切る。verify.sh への配線の試験が文字列の検索だけだった → 複製のリポジトリで verify.sh を実際に走らせる試験に替えた。名簿全体で環境変数の名前を重複させない。一覧の send に制限の設定の send を交差させる。直さなかった 1 件は報告だけの項目（共有の作業フォルダの上書き）。
- 直し役が決めた形（計画の字面から変えた所。どれも安全側）: 一覧の send は制限の設定との交差（Plans.md に 1 行足した）。名簿全体での名前の重複の禁止（同）。失敗の行に環境変数の名前を出さず、登録名と役割を出す（名前の欄に鍵を貼り付けた場合に鍵を出さないため）。
- `bash scripts/verify.sh`: exit 0（node 532 件、帯 99 件、`peer-secrets: ok（登録なし）`）。私が 19c9cde の前に走らせて確かめた。
- 残件（期日: 名簿に茶々丸を登録する H4 の前）: 名簿に登録が入ると、鍵の漏れの確認は実データ約 29GB を探すので、実測で約 10 分かかった（並走の負荷があり、原因の切り分けは未確認）。verify のたびに 10 分かかるのは重いので、前回の合格より後に変わったファイルだけを探すなど、H4 の前に方式を決める。JSON の書き方のうち、`\/`、`&`、非 ASCII の `\uXXXX` に直された写しは探していない（合格のときに注記を出す）。
- P2 の判定（T2-9）は、P2 の作業がそろってから別の家系に頼む。

## T3-11 画面の読み取りの確認（2026-10-09 15:30〜15:36 JST）

立花さんと私（この会話の内蔵のブラウザ。ログイン済みだった）で見た。作成、保存、変更は何もしていない。

| # | 見たもの | 結果 |
|---|---|---|
| 1 | ブラウザ版の ChatGPT の Plugins（chatgpt.com/plugins）→「追加」→「カスタム MCP サーバーを作成」（私が開いて閉じた） | 可。入力の画面が開く。接続タイプは「サーバーURL」と「トンネル」。認証は「OAuth」「認証なし」「OAuthまたは認証なし」から選べる。リスクの注意と「理解したうえで続ける」の確認がある |
| 1b | ChatGPT のデスクトップアプリの「設定 > 連携 > プラグイン > MCP > カスタム MCP に接続する」（立花さんの画像 2 枚） | 接続のタイプは「STDIO」と「ストリーミング可能な HTTP」で、トンネルは無い。HTTP では URL、Bearer トークンの環境変数、ヘッダーを入れる。手元で動かす MCP の登録の画面に見える（Codex の設定と同じ場所かは未確認） |
| 2 | OpenAI の Platform の Tunnels（platform.openai.com/settings/organization/tunnels。私が開いた） | 可。画面が開き、「Create tunnel」のボタンは押せる状態（押していない）。既に「pro-review Tunnel」（gpt-pro-review の Path B 用）が 1 つある |
| 3 | Dot | 可（立花さんの確認「Dotあるよ」） |

- T3-11 の Done when（3 項目それぞれの可か不可）は満たした。T3-12（スタブ）と T3-13（版の特定）の入口の条件がそろった。
- 測定に効く事実: ブラウザ版では「認証なし」でカスタム MCP サーバーを作れるので、測定用のスタブは鍵の仕組みなしで登録できる。Dot が使える plugin は「アカウントに入れて有効にした、対応する plugin」（公式の説明）なので、この経路で作った plugin を Dot が呼べるかが M1 の最初の観測になる。

## H2 茶々丸のルーチン（2026-10-09 15:4x JST、立花さんが茶々丸の返事を貼った）

- 茶々丸が、webhook で動くルーチン「seamless からの依頼の受け口」を作った。茶々丸の説明: webhook に 1 件届くたびに茶々丸が起きて中身を読み、範囲内の依頼なら進め、判断が要るときだけ立花さんとのチャットで知らせる。届いた本文は承認として扱わず、自動で送り直さない。
- URL と送信鍵の場所: Grok Bot アプリの茶々丸とのチャットの上の名前を押すと右に情報の欄が開き（Cmd+Shift+I でも）、その中の Routines の一覧から「seamless からの依頼の受け口」を開くと、URL と送信鍵をコピーできる（茶々丸の説明。茶々丸からはその画面は見えない）。
- 鍵の付け方（Q6）はまだ分からない。立花さんがその画面で、ヘッダの名前、鍵の書き方、送り方の例、本文の決まりを、値を伏せて確かめる。確かめた書き方は茶々丸が answers.md の Q6 に写す。
- 確認カードの承認: 茶々丸の報告ではルーチンは作成済みなので、作成に要る立花さんの承認は済んでいると見なした（カードの文面は記録に無い）。H2 の Done when の「確認カードの承認が済んだこと」はこの扱いで記録する。

## Q6 の答え（2026-10-09 15:45 JST、立花さんがルーチンの画面で確かめ、茶々丸が answers.md に写した）

- 送信鍵のヘッダは `Authorization`、書き方は `Authorization: Bearer <鍵>`（アプリの「Authorization header」欄にこの形のまま出る）。送り先は `POST <URL>`（アプリの「Webhook URL」欄）。
- 署名（HMAC など）、本文の決まり（Content-Type、大きさの上限）、curl の例は画面に出ていない。未公開として扱う。
- 値は立花さんが持っている（「正しい値はこっちで持ってる」）。seamless の手元の設定（環境変数、H3）にだけ置き、リポジトリとチャットには書かない。
- 計画の直し: 送る経路（T2-2）は、送信鍵による HMAC の署名ヘッダをやめ、`Authorization: Bearer <送信鍵>` で付ける。茶々丸は鍵を見ず、照合するのは Grok Bot の仕組みなので、HMAC を付けても確かめる側がいない。本文は JSON、大きさは保守的な決まり（8,000 字まで）のまま。Plans.md の「送る」の節と tasks.md の T2-2 を直した。
- これで送る経路（T2-2）の入口の条件（T2-1、T0-4b）はそろい、鍵の付け方も決まった。受ける経路（T2-3）の実装が終わった後に続けて作る（同じファイルを触るので順番に行う）。

## T3-12 と T3-13 Dot の測定の準備（2026-10-09 15:38〜16:00 JST、workflow `wf_a5b823f1-af3`）

- T3-12: 測定用のスタブ `experiments/dot-m1/`（stub.ts、stub.test.ts、README.md）を作った。tunnel-client の --mcp-command（stdio）から起動される JSON-RPC のサーバーで、server/discover と initialize で版 2026-07-28 と events を宣言し、ping の道具を 1 つ出す（--no-tools で無し）。events/subscribe は記録してから既定ではエラーを返す（callback へ POST しないので受理したことにしない。--accept-subscribe で受理の応答だけを返す選択もある）。記録は明示した絶対パスの 0600 のファイル 1 つで、明示が無ければ起動しない。subject と session は実行ごとの乱数の salt の HMAC の先頭 8 桁、subscribe は callback のホスト名だけ。Authorization、secret、URL の全体、引数の値、本文は書かない。全ての記録の行を許可した欄だけに絞る。通信の部品（http、net、fetch）は読み込まない（私が grep で確認）。
- 判定役（穴探し）の指摘 10 件のうち 9 件を直した。重いもの: 2026-07-28 の版で必須の `ttlMs` と `cacheScope` が discover と tools/list に無く、最初の往復で全部の測定が空振りしうる → 足した。深い入れ子の _meta で例外が出て子プロセスごと落ちる → 落ちないようにした。イベントの説明が「出さない」で、モデルが購読を断る材料になる → 直し、README に購読を引き出す頼み方を書いた。秘密を書かない要件の一部が試験で守られていなかった → 許可した欄だけを残す検査と試験を足した。
- `node --test experiments/dot-m1/stub.test.ts`: 17 件すべて通過、exit 0。型検査（verify.sh と同じ旗の tsc）exit 0。私が走らせて確かめた。
- 決めずに残した 1 点: ping に任意の引数 caller（dot、chat、unknown）を足すか。足すと Dot と Chat の呼び手の区別が強くなるが、「引数の値を書かない」の例外になる。今は足さず、呼んだ時刻を控えて記録の時刻と突き合わせる（1 分以上空けて Dot と Chat を 1 回ずつ）。
- T3-13: MCP 2.0（2026-07-28）の自己完結の要求を stdio の --mcp-command で通すことが docs に初めて書かれたのは tunnel-client の v0.0.15（2026-09-25 公開。docs/configuration.md の「Automatic stdio initialization guard」に「2026-07-28 以降の版で params._meta に client capabilities を持つ自己完結の要求はこのガードを通る」）。v0.0.14 以前の docs には無い。実機の pro-review 用は 0.0.9+62b9b42 でこの記述が無い。

| 項目 | v0.0.15（最初の版） | v0.0.16（最新、Homebrew の版） |
|---|---|---|
| ファイル名（macOS arm64） | tunnel-client-v0.0.15-darwin-arm64.zip | tunnel-client-v0.0.16-darwin-arm64.zip |
| サイズ | 27,018,754 バイト | 27,041,422 バイト |
| sha256（GitHub の digest） | b2cae3aa9df45b4c2fe9b1d700ebacce39f9feb6a6b46b86e6499f9a51bf72ff | a160820d45089b5253d8d671fe2a689bde0f73d78c135d1497a7b33f28a3ac62 |
| 取得元 | github.com/openai/tunnel-client/releases/download/v0.0.15/… | 同 v0.0.16/…、Homebrew は `brew install openai/tools/tunnel-client`（persistent.oaistatic.com から、sha256 は GitHub と一致） |

- GitHub から直接取った zip は notarize されておらず、Gatekeeper に止められる場合がある（README）。Homebrew の版を使うのが手前。どちらもダウンロードはしていない（ディスクに無い）。

## T2-3〜T2-5 受ける経路（2026-10-09 約 15:18〜16:36 JST。終了の時刻と所要 78 分から逆算、workflow `wf_9c916078-482`、コミット 50e2985）

- 作ったもの: `send --as <登録名>` と `sessions --as <登録名>`。署名済みの封筒を標準入力で受け、形、名簿、失効、鍵の版、鍵、署名、時刻、名簿の認可、nonce、宛先、予約の順に確かめ、どれかで止まれば何も届けない。`read --as` は常に `operation_not_permitted`（`reason: external_read`）。新しい部品は `src/signed-envelope.ts`、`src/nonce-store.ts`、`src/external-inbound.ts`。
- 役の顔ぶれ: 施工、照合（計画との突き合わせ）、穴探し（壊して確かめる）、直しの 4 役。4 役とも Claude の家系なので、逆の家系の判定は T2-9 で P2 全体として頼む。
- 照合と穴探しの指摘 11 件（重複 1 件を含む）の扱い:

| # | 指摘 | 扱い |
|---|---|---|
| 1、9 | 確定した配送の後、別 ID で同じ内容が 2 回目の配送として通る（Plans.md の「別 ID でも duplicate」と違う） | 直した。grok-bot の経路だけ、受理の後も内容の hash を 24 時間保持して `duplicate`（`previous: submitted`）にする |
| 2 | 確定後の同じバイト列の再提示が `nonce_replayed` になり、最初の結果を Bot に伝えない | 直した。同じ内容の予約があれば `duplicate`（`previous` 付き）、結果不明なら `duplicate_of_unknown`。予約が無いときだけ `nonce_replayed` |
| 3 | 範囲外の会話が一覧では拒否の語でなく、候補から外れるだけ | 文書で固定した（Plans.md の認可の項）。固定する試験も足した |
| 4、8 | 鍵の等値の検査が、送信鍵の値を読んで Bot に 1 ビットを返す。別の登録の鍵の値と同じでも通る | 直した。名簿の全ての鍵の値と比べ、同じなら拒否。Bot には `key_unavailable` だけを返し、理由は変数の名前だけを Mac の標準エラーへ |
| 5 | Bot に届かなかった依頼（`rejected`）への返信も受け入れる | 直した。`rejected` は返信先に数えない。`pending` と `unknown` は届いた可能性があるので数える |
| 6 | 孤立サロゲートと U+FFFD が同じ署名になり、本文を差し替えられる | 直した。署名に入る文字列（text、id、replyTo、recipient）に孤立サロゲートがあれば `envelope_invalid` |
| 7 | nonce の全件走査で、2000 件のとき請求 1 回 895 ms、受け手の一覧が 1 秒を超える | 直した。索引で 2 ファイル読みにし、期限切れの掃除は 1 時間に 1 回。5100 件で請求、確認、一覧が各 1.5 秒未満の試験を足した |
| 10 | 記録が消えるか時計が跳ぶと、一覧の再提示が窓内で通る | 限界として Plans.md に書いた。送信は予約が 2 つ目の鍵になり止まる（試験で固定） |
| 11 | 試験の無い箇所（制限なしでの入れ子と `scope: all`、書込み直前の鍵の版、`workspace_changed`） | 試験を 3 つ足した |

- 直しの確認: 新しい試験を古い実装に当てて #1、#6、#7、#8 が落ちることを確かめてから直した。直した部分を 14 通りに壊す変異試験は 14 通りとも試験で落ちた（直し役の報告）。
- 私が走らせた `bash scripts/verify.sh`: exit 0。型検査 0、node 587 件すべて通過（前の 532 件から 55 件増）、帯 99 件通過、`peer-secrets: ok（登録なし）`。
- 推奨どおりに決めたこと（2026-10-08 の「今日決めることは推奨で実行」による）:
  - 別 ID の同じ内容を止める期間は 24 時間。代償は、同じ会話へ同じ本文（同じ replyTo）を 24 時間に 2 回送ると 2 回目が `duplicate` になること。縮めるなら `src/external-inbound.ts` の定数 1 つ。
  - 鍵の等値の検査は残す。代償は、受ける瞬間に名簿の他の鍵の環境変数も読むこと（比べるだけで保存も出力もしない）。
- 茶々丸に渡す契約（T2-7 で手順と一緒に渡す）:
  - 署名する文字列: `seamless-inbound-v1`、登録名、鍵の版、宛先、依頼 ID、replyTo（無ければ空行）、本文の UTF-8 の SHA-256（小文字の hex）、署名時刻、nonce の 9 行を `\n` でつなぐ（末尾に改行なし）。署名はその HMAC-SHA256（小文字の hex）。
  - 署名時刻は `YYYY-MM-DDTHH:MM:SSZ` ちょうど。nonce は `[A-Za-z0-9_-]{16,128}`。宛先は `claude|codex|grok:<会話 ID>:<世代>`、一覧は `*`。
  - 既知解（鍵 `test-key-not-a-secret`、登録名 `chachamaru`、鍵の版 1、宛先 `claude:11111111-1111-4111-8111-111111111111:42@100`、ID `req-1`、replyTo なし、本文 `hello`、時刻 `2026-10-09T12:00:00Z`、nonce `A` を 22 個）→ `02a0fb553a6108cdc4245e93a0fad8adfd06b2b511dd6ea541e60ad704e59ab6`（施工役が python3 と openssl で一致を確認）。
  - 状態語: 確定後の同じ封筒、署名し直した同じ ID、24 時間内の別 ID の同じ内容は `duplicate`。結果不明は `duplicate_of_unknown`。予約の無い再提示と一覧の再提示は `nonce_replayed`。
- 計画の字面から変えた所: 署名の並びの行頭の版の印、`duplicate` に `previous` を付けること、新しい状態語 12 個（`envelope_invalid`、`sender_mismatch`、`sender_unregistered`、`peers_unusable`、`key_unavailable`、`key_version_mismatch`、`signature_mismatch`、`timestamp_out_of_window`、`nonce_replayed`、`nonce_unavailable`、`scope_unset` ほか）。
- 未確認: 実在の会話への実送信（T2-8c、T2-8d）。T2-2 が書く Mac → Bot の予約の記録の形（`recipient.id` が `grok-bot:<登録名>`）は施工役の想定で、T2-2 で合わせる。

## T2-2 送る経路（2026-10-09、workflow `wf_4f3a2c10-9c1`、所要 98 分、コミット b8928f0）

- 作ったもの: `src/webhook-send.ts`。一覧の external[] に切符を付け、Mac の会話は `send` にその切符を渡して、登録した Bot の webhook へ封筒の JSON を POST する。`Authorization: Bearer <送信鍵>`（環境変数の値の先頭の `Bearer ` は 1 つ外す）。2xx は受理、2xx 以外は不受理、接続や応答の途中の失敗は成否不明で、送り直さない。同じ ID は POST せず前の結果、同じ内容の別 ID は 24 時間 duplicate、8,001 字以上は text_too_long。
- 役の顔ぶれ: 施工、照合、穴探し、直しの 4 役。4 役とも Claude の家系なので、逆の家系の判定は T2-9 で頼む。
- 照合: PASS（medium 1、low 6、info 1）。Done when の 8 場面それぞれを、複製に入れた変異で殺せることを確かめた（66 件中 56 件が落ち、生き残りは上流の重複した守りと試験の穴）。外へのネットワークは 0 件（fetch と DNS と接続をフックして全試験を走らせ、宛先は 127.0.0.1 だけ）。
- 穴探し: PASS（中 1、低 4、情報 1）。鍵と住所の漏れ、リダイレクト、二重 POST、名簿の再確認、https の検査、タイムアウト、Mac 側の観測は破れなかった。
- 直したもの 5 件: 署名を経ない文で Bot 宛の返答完了が埋まる（予約からだけ埋めるようにした）。住所と鍵の不備で ID が焼ける（予約の前に止めた）。呼び手の再確認、制限が壊れたとき、Bot の切符の形の 3 つの試験の穴。
- 私が走らせた `bash scripts/verify.sh`: exit 0。型検査 0、node 624 件すべて通過（T2-3〜T2-5 の 587 件から 37 件増）、帯 99 件、`peer-secrets: ok（登録なし）`。
- 実測まで据え置く判断 5 点は Plans.md の「送る」に書いた（5xx と 3xx、接続できない失敗、タイムアウト、範囲外の登録の見せ方、limits.exclude）。
- H7 の前に立花さんへ伝えること（直し役の指摘）: Bot へ送る JSON の `sender.generation` に、Mac の会話の世代（pid と開始時刻）が入る。住所と鍵の環境変数は、MCP を起動するアプリ（Claude、Codex、Grok）のプロセスから見える必要があり、端末で設定しただけでは足りないことがある。Bot 宛の依頼は帯とパネルに出ず、見る手段は `send` の track だけ。
- 未確認: 実在の茶々丸への POST（T2-8a、T2-8b。H7 の後）。Node 22 系での `redirect: 'manual'` の挙動（24.19.0 では確認）。実会話の記録での返信の照合。

## P2 のコードの中間判定（2026-10-09、Codex gpt-6-astra、high、読み取り専用）

- 実在の茶々丸との送受信（T2-8a〜f）の前に、コードと試験だけを逆の家系に見せた。正式の判定は T2-9 で別に行う。依頼は 7 項目（Done when の試験、鍵と住所の漏れ、Bot → Mac の確認の抜け、Mac → Bot の二重 POST などの穴、承認として扱わないこと、既存の経路の非破壊、AC を弱める変更）。
- 1 回目（版 1fd6f52）: FAIL。原文は `reviews/p2-interim-judge-1fd6f52.md`。
  1. 送信鍵の値に `Bearer ` が付くと、受信鍵と同じ鍵でも衝突を見逃し、送信鍵で署名した封筒が配送まで通った（合成した鍵で再現）。
  2. 2xx の応答の本文が 65,536 バイトを超えると読むのを打ち切り、途中で切れても受理にした。
  3. 漏れの確認（peer-secrets.sh）が、`Bearer ` を外した後の鍵を探さなかった。
  - verify.sh は判定役の読み取り専用の環境で一時フォルダを作れず exit 1（コードの回帰ではない。私の環境では exit 0）。
- 直し（919d343）: 鍵の値を比べるときも送るときも `src/peers.ts` の `keyOf`（先頭の `Bearer ` を 1 つ外す）を使う。2xx の応答は最後まで読み、途中で切れたら長さに関係なく成否不明（読む時間は 15 秒の上限で止まる）。漏れの確認は `Bearer <鍵>` の値について `<鍵>` だけの形も探す。足した試験は 5 件で、そのうち 4 件は直す前の版で落ち、直した版で通ることを私が確かめた。残る 1 件（長い応答が最後まで届けば受理）は、直す前の版でも通る正常系の試験。コミットの文の「5 件とも直す前に落ちた」は不正確で、再判定で指摘された。
- 私が走らせた `bash scripts/verify.sh`: exit 0。型検査 0、node 627 件すべて通過、帯 99 件、`peer-secrets: ok（登録なし）`。
- 2 回目（版 919d343）: PASS、確信度 high。原文は `reviews/p2-interim-rejudge-919d343.md`。4 項目とも Yes。判定役は全体の試験を再実行せず、私の verify の結果を採用した。

## T3-14 と T3-15 測定 M1（2026-10-10 18:26〜18:52 JST、道具あり。項目 1〜5）

- 準備で起きたこと（2026-10-09〜10）:
  - `security … -w` の入力欄は、128 文字を超えた分を黙って切り捨てる。最初に保存した鍵は 128 文字で、OpenAI は `401 invalid_api_key` を返した（57 回、すべて失敗）。`experiments/dot-m1/save-key.sh`（コピーを待って保存する）で入れ直した（164 文字）。
  - 最初に入った値は、立花さんがこの測定のために作った鍵ではなかった（立花さんは「API キーは作ってない」と答えた）。手元の別の `sk-proj-` の鍵の先頭 128 文字だったとみられ、送り先は OpenAI だけで、切れていたので認証に通っていない。今は上書きされている。
  - `/readyz` は、鍵が断られていても `ready` を返した。つながったかは `/metrics` の `commands_poll_last_successful_timestamp_seconds` で見る（18:26:39 に成功、失敗 0）。
  - tunnel-client 0.0.16 は、起動すると子プロセスとして `codex app-server` を立ち上げる（管理画面の補助）。測定には関係しない。
- 操作: ChatGPT アプリ（バンドル ID `com.openai.codex`）を、立花さんの依頼でコンピューター操作（裏から）で動かした。Dot は「あなたのdot」の会話、通常の Chat は ChatGPT 表示の Chat モードの新しい会話。
- 記録: 本線の `.local/dot-m1/m1-tools.jsonl` の run `50f6b5c5`（10 行、0600）。

| 時刻 | 誰が | 頼んだこと | スタブに届いたもの | ChatGPT の返事 |
|---|---|---|---|---|
| 18:33:50 | 登録 | カスタム MCP の作成（トンネル、認証なし） | `server/discover`、`tools/list`、`events/list`（初期化 `initialize` は無し。版 2026-07-28 の自己完結の要求） | 作成できた |
| 18:38:06 | Dot | ping を 1 回 | 18:38:14 `tools/call ping` | 「1回だけ呼びました。結果は『pong』」 |
| 18:40:37 | 通常の Chat | ping を 1 回 | 18:40:39 `tools/call ping` | 「1回だけ呼び出しました。結果: pong（成功）」 |
| 18:46:29 | Dot | m1.probe.created を監視 | 18:46:55 `events/subscribe`（エラー -32602 を返した）→ 18:46:56 `events/unsubscribe` → 18:47:12 `events/subscribe`（同）→ 18:47:12 `events/unsubscribe` | 「監視対応イベントとして確認できたが、登録がサービス側のエラーで失敗し、再試行しても同じ。監視開始は確認できていない」 |
| 18:51:03 | 通常の Chat | m1.probe.created を監視 | 何も来なかった（90 秒見た） | 「イベント購読・監視の対応ツールが公開されていない。監視状態: 未開始」 |

6 項目のうち 1〜5:

| # | 項目 | 結果 |
|---|---|---|
| 1 | Dot が呼べたか | 呼べた（18:38:14 の `tools/call ping`、結果を返した） |
| 2 | 呼び手の指紋が Dot と Chat で同じか違うか | `subject` は同じ（同じ利用者）。`session` は違う（別の会話なので当然）。`openai/organization` は同じ。`client` は両方 `openai-mcp` 1.0.0。client の capabilities が違う（Dot は `elicitation` と `extensions/openai/elicitation`、Chat は `extensions/io.modelcontextprotocol/ui`） |
| 3 | `_meta` に Dot 専用の項目があるか | ある。Dot だけ: `callId`、`itemId`、`sessionId`、`windowId`、`traceparent`、`openai/request_id`、名前を伏せたキー 1 個（認証らしい語を含む名前。指紋 `60bc36ff`）。Chat だけ: `openai/locale`、`openai/userAgent`、`timezone`、`timezone_offset_minutes` |
| 4 | `events/subscribe` が来たか | Dot から来た（頼んでから 26 秒後）。通常の Chat からは来なかった（Chat は監視に対応しないと答えた）。断ると Dot は直後に `events/unsubscribe` で片付け、1 回だけ再試行して止まった |
| 5 | callback の宛先のホスト名 | `connectors.api.openai.com`（2 回とも）。`delivery_mode` は webhook、secret あり |

読むときの注意:
- `events/subscribe` の `_meta` には、MCP の標準の 3 つ（`clientCapabilities`、`clientInfo`、`protocolVersion`）しか無かった。`openai/subject`、`openai/session` も Dot 専用の項目も無い。つまり、購読の要求そのものからは、どの利用者のどの会話（Dot か）の購読かを読めない。読めるのは callback の宛先と secret だけ。
- 通常の Chat の `tools/call` に `openai/userAgent` があり、Dot には無い。Dot の呼び出しは利用者の画面ではなく ChatGPT のサービス側から来ているとみられる（未確認）。
- 名前を伏せたキーの元の名前は記録していない（スタブの決まり）。Dot の呼び手を確かめる材料になりうるが、中身は見ていない。
- HTTP のヘッダはスタブに届かない（stdio の構造）。ヘッダに Dot の印があるかは、この測定では分からない。
- 項目 6（認証なし、道具なしの入口でも subscribe が来るか）はまだ。Work chat での監視の依頼も、まだ試していない。

## T3-14 と T3-15 測定 M1 の項目 6（2026-10-11 16:50〜16:51 JST、道具なし）

- 道具ありの tunnel-client を 2026-10-10 18:53 ごろに止め（SIGINT）、同じ tunnel で `run-m1.sh notools` を立花さんの端末のタブで起動した（19:32:13 起動、19:32:44 に問い合わせが成功）。記録は `.local/dot-m1/m1-notools.jsonl` の run `ea36c1a3`（3 行）。
- 画面のロックの間は操作できず、解除の後は立花さんが ChatGPT で別の作業中だったため、Dot への依頼は立花さんが送った（2026-10-11 16:50 ごろ、「seamless-dot-m1-probe のイベント m1.probe.created を監視して」）。
- 届いたもの: 16:51:02 `events/subscribe`（`m1.probe.created`、webhook、宛先のホスト `connectors.api.openai.com`、secret あり。スタブはエラー -32602）→ 同じ秒に `events/unsubscribe`。再試行は無かった。`server/discover`、`tools/list`、`events/list` は来なかった。
- Dot の返事（立花さんの貼り付け）: 前回の登録が残っていないことを確かめてから再設定を試したが、登録サービスが「unexpected error」を返した。イベント自体は対応している。監視開始は確認できていない。重複を避けるため再試行はしていない。
- 項目 6 の結果: 道具なしの入口でも subscribe は来た。ただし ChatGPT は新しい入口の能力を読み直していない（discover が来ていない）ので、登録の時（道具あり）に読んだ能力を使い回した結果として読む。「最初から道具なしで登録した入口でも購読が来るか」は確かめていない。再試行の回数は 1 回目（2026-10-10）が 1 回、今回が 0 回で、Dot は直前の失敗を覚えて再試行を控えたとみられる（未確認）。
- 後片付け: 測定の tunnel-client とスタブは止めた（ps に無い）。pro-review 用（pid 2733）は動いたまま。ChatGPT の登録、tunnel、API キー、Keychain の 2 項目は立花さんが消す（T3-15 の残り）。
- 試していないこと: Work chat での監視の依頼（Work モードは「フルアクセス」で手元の作業を始めるため、依頼の範囲外として送らなかった）。購読を受理して、callback へ通知を 1 件送る測定（外部への送信になるので、別の go が要る）。

## T3-16 M1 の結果からの方式の選び直し（2026-10-11）

- 前提: 2026-10-09 の判断 1 で、Dot から Mac への流れは seamless では受け持たない。tasks.md の T3-16 の分岐のうち「外部の IdP と JWT の確認、Dot からの send は 1 通ごとに本人が承認」は Dot → Mac を前提にした文言なので、ここでは使わない。Q5 は「誰が購読してよいか」だけを決める。
- 当たる分岐: 「呼べた、購読も来た、Dot と Chat は区別できる」。ただし推奨を決める事実は tools/call の差ではなく、**events/subscribe の `_meta` が MCP の標準の 3 項目だけだった**こと（3 回とも。subject、session、Dot 専用の項目は無い）。購読の要求の中に、名簿の登録や会話に結び付ける材料は無い。
- 推奨する Q5 の方式（tunnel 単位の結び付け）:
  1. `chatgpt-dot` の登録 1 件ごとに、専用の tunnel を 1 つ持つ。tunnel は runtime key で OpenAI に認証され、1 つの tunnel で動く tunnel-client は 1 台だけ（configuration.md の「Stdio deployment limits」）。
  2. その tunnel の入口に届いた購読だけを、その登録の購読として受ける。callback は `https://connectors.api.openai.com/` のホストだけ受ける（M1 の 3 回とも同じホスト）。
  3. Dot だけに付く `_meta`（`callId`、`sessionId`、`windowId`、名前を伏せたキー 1 個など）は、表示の区別（「Dot からの呼び出し」）には使ってよいが、認可には使わない。ChatGPT の自己申告で、AC11c の「名乗りでは通さない」に当たる。
  4. 購読に会話の印が無いので、宛先の表示は AC11c のとおり「Dot の登録への配送」で確定する。「既存の会話への配送」とは扱わない。
- 判断材料:
  1. 本質: 購読を誰のものとみなすかは、要求の中身ではなく「どの tunnel に届いたか」でしか決められない。
  2. 何が変わるか: 前は「Q5 は Tunnel の接続ごとの主体か、入口に渡す鍵で決める（未定）」。後は「登録 1 件 = 専用の tunnel 1 つ。届いた tunnel で登録を決める」。
  3. 立花さんから見て: Dot への通知を足すたびに、Platform で tunnel を 1 つと、Restricted の鍵を 1 つ用意する手間がある（M1 と同じ手順）。鍵は Mac の Keychain に置く。
  4. 仕様への影響: spec.md の Q5 を閉じられる。戻せる（tunnel を消せば購読も止まる）。期限は M2 の判断まで。
- まだ言えないこと（未測定）:
  - Mac → Dot の通知が実際に届くか。確かめたのは「Dot が購読を送る」まで。受理したあとの検証の要求、通知 1 件の配送、ChatGPT 側の表示は測っていない。
  - 「認証なし」の plugin が、同じワークスペースのほかの人にも見えて購読できるか。「誰が購読してよいか」に直接効く。
  - 複数の plugin の登録が同じ tunnel を選べるか。
  - Work chat から購読が来るか（OpenAI の手順では Work chat も購読元。通常の Chat が購読しなかったことは手順と合う）。
- 次の一手: 測定 M2（`--accept-subscribe` で購読を受理し、OpenAI の手順どおり検証に応え、通知を 1 件 `connectors.api.openai.com` へ送る）。callback への外部送信なので、立花さんの go が要る。T3-17（本体の実装の作業分け）は M2 の後。
- 名前（2026-10-11 立花さん）: ChatGPT の Dot の表示名を「茶々丸dot」にした。Grok Bot は「茶々丸」。名簿の登録名は英小文字（例: Grok Bot は `chachamaru`、Dot は `chachamaru-dot`）なので、表示名が似ていても登録名はぶつからない。

## MVP の部品と M2 の道具の判定（2026-10-11、Codex gpt-6-astra、high、読み取り専用）

- 立花さんの方針（Plans.md の「MVP を先に完成させる」）に沿って、2 つを作った。
  - 茶々丸の MVP 部品（workflow `wf_3cbbf5ae-07e`）: 鍵と住所を Keychain から読む（`src/secrets.ts`）、Mac 上で署名を代行する `bot-send` と `bot-sessions`（`src/bot-sign.ts`）、設定スクリプト `scripts/peer-setup.sh`、漏れの確認の既定の範囲。
  - M2 の道具（workflow `wf_a95eb098-b2a`）: `experiments/dot-m2/notify.ts` と `run-m1.sh notify`。
  - どちらも Claude の家系の施工、照合、穴探し、直しの 4 役で作った。
- 茶々丸の部品の判定: 1 回目（a62bb95）FAIL 2 件 → 2 回目（0ee7bb4）FAIL 2 件 → 3 回目（d8e2066）PASS、確信度 high（今の MVP の使い方が前提）。原文は `reviews/mvp-judge-a62bb95.md`、`reviews/mvp-rejudge-0ee7bb4.md`、`reviews/mvp-rejudge-d8e2066.md`。
  - 直したもの: Mac が署名して届けた依頼を、同じ ID の古い茶々丸の署名の記録で「確かめた送り手」と表示しない（Mac の署名の記録が名前を上書きする）。上書きできなければ届けない。
  - 先送りの表に足したもの: 設定スクリプトが値を引数に一瞬載せること、Keychain の読み手の範囲、掃除と上書きが重なる経路（茶々丸が自分で署名するまで起きない）。
- M2 の道具の判定: 1 回目（f6b8204）FAIL 2 件（未知の要求の名前を記録に書く、確認の返事を上限なしで読む）→ 2 回目（006f34c）PASS、確信度 high。IP の固定の先送りは、この 1 回の測定を止める理由にならないと判定された。原文は `reviews/m2-judge-f6b8204.md`、`reviews/m2-rejudge-006f34c.md`。
- 私が走らせた `bash scripts/verify.sh`（d8e2066）: exit 0。node 697 件すべて通過、帯 99 件、`peer-secrets: ok（登録なし）`。`node --test experiments/dot-m2/*.test.ts`: 34 件通過。
- 帯の試験 2 件が、Claude Code 2.1.296 の試験ハーネスの変更（`ui.toast` の代役に `{ value }` を求める）で落ちていた。試験の代役だけを合わせた（本番の hook は無変更）。
- 点検役の 1 人が、偽の道具を置かずに `peer-setup.sh` を 1 回起動し、実在の Keychain に存在確認を 1 回、実在のクリップボードを約 30 秒読んだと自己申告した。Keychain の `seamless` の項目が 1 つも無いことを私が確かめた（値の書き込みと読み出しは無い）。

## 本線への取り込みと茶々丸の登録、T2-8a（2026-10-12）

- 立花さんが本線へ fast-forward で取り込んだ（main = b9be03d、12:00 ごろ）。本線で `bash scripts/verify.sh` exit 0（node 697 件、帯 99 件、peer-secrets ok 登録なし）。
- 立花さんが `scripts/peer-setup.sh` を実行した（12:02 ごろ）。Keychain に URL（79 文字）、送信鍵（69 文字）、受信鍵（64 文字、作成）が入り、名簿 `~/.seamless/peers.json` に chachamaru（keyVersion 1、範囲 `/Users/tachibanashuuta/LocalWork`、送信可）が載った。宛先のホストは `api2.cursor.sh` で、Grok Bot のアプリのルーチンの画面から写した値だと立花さんが確かめた（「Yes」）。
- 新しい版の一覧（`node src/cli.ts serve` の sessions、この会話から）: external に `grok-bot:chachamaru`（表示名 茶々丸、registered、send 可、read 不可、切符あり）。Mac の会話の候補は 18。
- T2-8a（Claude → 茶々丸、1 通）: 12:04:39 JST に依頼 `t2-8a-20261012` を送った。結果は `submitted`（webhook が 2xx を返した）。段は、受理が observed（予約が submitted）、配信確認と処理開始は unobserved（外の実行主体）、返答完了は unobserved。本文は試験の文だけで、会話の中身は入れていない。製品の版: Claude Code 2.1.295。
- 送り手の Keychain の読み取り: この会話の子プロセス（`node src/cli.ts serve`）から、確認の画面を出さずに URL と送信鍵を読めた（結果が address_unavailable や key_unavailable にならなかった）。MCP として起動した子プロセスでの確認はまだ。
- T2-8c（茶々丸 → Claude、1 通）: 茶々丸が Mac で `bot-send chachamaru` を動かし、返信 `chachamaru-20261012-t2-8a-001`（本文「T2-8a 受け取りました」、replyTo `t2-8a-20261012`）がこの会話に届いた（2026-10-12 03:05:47Z、12:05:47 JST。送ってから 68 秒）。受け手の一覧では送り手が `declared`（Mac が代わりに署名したため。設計どおり）。nonce の記録は `signedBy: 'mac'`、鍵の版 1。
- T2-8f（Claude の依頼の段）: 依頼 `t2-8a-20261012` の段は、受理が observed（12:04:39）、返答完了が observed（12:05:46、根拠は返信の ID）、配信確認と処理開始は unobserved（外の実行主体）のまま。AC4 の形どおり。
- 茶々丸がこの返事を送る前に、立花さんが使い方の文（handoff/chachamaru-mvp.md）を茶々丸に渡したかは、この会話からは見えない（茶々丸は手順どおりの形で返した）。
- まだのもの: T2-8b（Codex → 茶々丸）、T2-8d（茶々丸 → Codex）、T2-8e（返信の後 10 分で依頼の件数が増えないこと。12:06 の時点の茶々丸に関わる予約は 2 件）、T2-9（正式な判定）。
- M2 の 1 行の宛先違い（2026-10-12 12:07）: 「seamless-dot-m1-probe のイベント m1.probe.created を監視して」が、茶々丸dot（ChatGPT）ではなく茶々丸（Grok Bot）に届いた。茶々丸の答え（立花さんの貼り付け。茶々丸の自己申告で未確認）は「このコネクタは私の一覧に無い。私はコネクタのツールを呼べるだけで、`events/subscribe` を送る仕組みは無い。監視は未開始。私を起こすなら webhook」。M1 の結果（購読を送るのは Dot だけ）と食い違わない。M2 のサーバーの記録 `m2-notify.jsonl` は起動の 1 行のまま（12:10 時点。購読も検証も来ていない）。tunnel は接続中（最後の取得は 12:09:57）。
- 茶々丸dot の画面（12:10、背後から読み取りのみ）: 立花さんが別の作業（Rappiness）の途中だったので、M2 の 1 行は入力していない。
- T2-8e（返信の後 10 分の実観測）: `~/.seamless/reservations` のうち送り手か宛先が `grok-bot:chachamaru` の予約は、12:06:18 に 2 件、12:16:23 に 2 件。返信の後に依頼は増えていない（自動の返信の連鎖なし）。

## 測定 M2（2026-10-12 12:15〜12:17 JST、茶々丸dot、`run-m1.sh notify`）

立花さんが 12:15 に茶々丸dot（ChatGPT）へ「seamless-dot-m1-probe のイベント m1.probe.created を監視して」と送った。サーバーは 2026-10-11 22:30 から待機（pid 81745、tunnel-client 0.0.16、tunnel は接続中）。記録 `.local/dot-m1/m2-notify.jsonl` の順:

| 時刻（JST） | 記録 | 中身 |
|---|---|---|
| 12:15:56 | `tools/call` | 茶々丸dot がツールを 1 回呼んだ（名前は記録しない作り。応答は result） |
| 12:16:42 | `verification` | callback の確認。宛先 `connectors.api.openai.com`、HTTP 200、541 ms、結果 ok |
| 12:16:42 | `events/subscribe` | イベント `m1.probe.created`、配送は webhook、宛先 `connectors.api.openai.com`、secret あり、受理、更新ではない（新規） |
| 12:16:47 | `delivery` | 通知 1 件の送信を開始（data `{id:'m2-test-1'}`） |
| 12:16:48 | `delivery` | OpenAI 側が HTTP 200 で受け取った。`.sent` の印ができ、2 件目は送らない |

- 判定: Mac から茶々丸dot への通知の経路（購読の受理 → callback の確認 → 署名つきの通知 → 200）は、実物で 1 回通った。MVP の完成の定義の「茶々丸dot へは、Mac から通知が届く」の、OpenAI が受け取るところまでを満たす。
- まだ見ていないもの: 茶々丸dot の画面に通知が出たか（OpenAI が受け取った後の段。12:17 の画面にはまだ出ていない）。
- 茶々丸dot の返事（画面、12:15）: 「m1.probe.created の監視設定を確認して、有効になっていなければ設定します。設定できたことまで確認して返します」。
- 茶々丸dot の 2 通目の返事（立花さんの貼り付け、12:18 ごろ）: 「m1.probe.created の監視を登録できた。有効になっていることも確認済み。受信した内容はこの会話に日本語で通知する」。12:16:48 に OpenAI が 200 で受け取った通知 1 件（`m2-test-1`）には触れていない。考えられる理由は 2 つで、どちらかは未確認: (a) 通知は購読の 5 秒後に送ったので、茶々丸dot が監視を有効にし終える前に届き、会話には出なかった。(b) 会話に出るまでに時間がかかる。
- 茶々丸dot の 3 通目（立花さんの貼り付け、12:20 ごろ）: 「m1.probe.created の受信通知が届いた。イベント本体のデータが付いていないため、内容やイベント ID は確認できていない。監視は継続している」。通知は会話に出た。M2 の判定は「Mac から茶々丸dot へ通知が届き、会話に出る」まで通った。
- データが見えなかったこと: 送った本文は OpenAI の手順の例と同じ 5 欄（`eventId`、`name`、`timestamp`、`data`、`cursor`）で、`data` の `{id:'m2-test-1'}` は宣言した `payloadSchema`（`id` は文字列、必須、ほかの欄なし）に合っている。手順書（developers.openai.com/plugins/build/mcp-events、2026-10-12 に読んだ）は「受けた会話は利用者の指示に従って応じる」「大きい記録は要約を送り、全文を取る読み取りのツールを出す」と書くが、`data` がモデルに見えるかは書いていない。茶々丸dot が `data` を見られないのが OpenAI の仕様か、今回だけかは未確認。
- 本体に入れるときの設計への影響（T3-17 へ）: 通知は「起こす合図」として使い、本文はツールで取らせる。`data` が見えても見えなくても動く形にするため、茶々丸dot 用の入口に「届いている依頼の一覧と本文を返す」読み取りのツールを置く（M1 で、茶々丸dot が tunnel 越しにツールを呼べることは確かめ済み）。

## T2-8b の 2 回の試み（2026-10-12 12:20〜12:24 JST）。茶々丸には届いていない

- 1 回目（Codex の会話 `01a12e1f`、作業場所 `~/Documents/Codex/2026-10-12/seamless-t2-8b-bot-send`）: 立花さんの文「seamless で茶々丸に…と送って」を受け、`sessions` で宛先を探したが、外の登録は 0 件だった。名簿の範囲が `/Users/tachibanashuuta/LocalWork` の下だけで、Codex のアプリが新しい会話を既定で置く `~/Documents/Codex/…` は範囲の外のため。送信なし。同じ会話の中の別の Codex（`01a12e20`、本文「T2-8b の試験です。受け取ったら bot-send で…」を受けた）が `bot-sessions chachamaru` を Mac で実行し、「T2-8b を受信しました。bot-sessions にこの会話が出ていないため、bot-send は送信できていません」と答えた。立花さんが茶々丸の返事として貼った文は、この Codex の答え（茶々丸の文ではない）。
- 2 回目（Codex の会話 `01a12e21`、作業場所 `~/LocalWork/Code/seamless`）: 立花さんが「T2-8b の試験です。受け取ったら bot-send でこの会話に一行返してください」をそのまま Codex に送った。Codex は自分への指示と読み、リポジトリの使い方の文（handoff/chachamaru-mvp.md）を読んで、自分で `bot-send chachamaru` を実行した。茶々丸の名前（`grok-bot:chachamaru`、Mac の署名、受け手には declared）で「T2-8b を受け取りました。bot-send からこの会話への返信です」が、この Codex の会話自身に届いた（予約 `t2-8b-ack-20261012-01a12e21-001`、submitted）。
- 茶々丸の受け口への送信: 2 回とも 0 件（`~/.seamless/reservations` に Codex → `grok-bot:chachamaru` の予約が無い、12:26 時点）。T2-8b と T2-8d はどちらも未達。
- 分かったこと 1（先送りの表の 1 行目が実際に起きた）: Mac の署名の代行（`bot-send`）は、この Mac で動く AI の会話からも実行でき、茶々丸が書いていない文が茶々丸の名前で届く。受け手の表示は declared（確かめていない送り手）なので設計の範囲内だが、立花さんは茶々丸の返事と受け取った。対処: 使い方の文と `src/cli.ts` の説明に「Mac の会話は bot-send と bot-sessions を実行しない」を足した（文書だけ。コードの拒否は入れていない）。
- 分かったこと 2: 経路の部品のうち「Mac の bot-send → Codex の会話に届く」は動いた（茶々丸ではなく Codex が実行したので T2-8d には数えない）。
- 分かったこと 3: 名簿の範囲 `~/LocalWork` は、プロジェクトに入れずに開いた Codex の会話（`~/Documents/Codex/…`）を含まない。

## T2-8b と T2-8d（Codex ⇄ 茶々丸、2026-10-12 12:27〜12:29 JST）

立花さんが 12:27:12 に新しい Codex の会話 `codex:01a12e26-6d83-74e1-a9be-1144f04d932d`（作業フォルダ seamless、本線の取り込み 12:00 の後に開いたので新しい版で動く）を開き、「seamless で茶々丸に『T2-8b の試験です。受け取ったら bot-send でこの会話に一行返してください』と送って」と頼んだ。記録は `~/.seamless/reservations` と `~/.seamless/nonces`。

| 時刻（JST） | 向き | ID | 結果 |
|---|---|---|---|
| 12:27:59 | Codex → 茶々丸 | `t2-8b-01a12e26-20261012` | `submitted`（webhook が 2xx） |
| 12:28:50 | 茶々丸 → Codex | `chachamaru-20261012-t2-8b-001`（replyTo `t2-8b-01a12e26-20261012`） | `submitted`。nonce の記録は `signedBy: 'mac'`、鍵の版 1。送ってから 51 秒 |

- T2-8b: 済み。受理は observed、配信確認と処理開始と返答完了は送った時点で unobserved。製品の版: Codex Desktop 26.1007.30912+20156。
- T2-8d: 済み。Codex の会話が「茶々丸から『T2-8b 受け取りました』と届き、replyTo も送った依頼の ID と一致した」と報告した（立花さんの貼り付け）。送り手は名簿の登録名 `grok-bot:chachamaru` で、Mac の代行署名なので受け手には `declared` として出る（T2-8c と同じ）。
- T2-8f（Codex の依頼の段）: 依頼 `t2-8b-01a12e26-20261012` は、受理が observed（12:27:59）、返答完了が observed（12:28:50、根拠は replyTo が一致する返信の記録）、配信確認と処理開始は unobserved のまま。この会話の `status` は呼び手が違うので `not_found` を返す。段は予約の記録から読んだ。
- 茶々丸の画面（立花さんの観察）: 「特に表示なし」。茶々丸は会話の画面ではなく、webhook で起きた裏の処理で返した。
- 茶々丸の説明（立花さんが茶々丸に聞いた答えの貼り付け、12:3x）: 「12:27 に Codex（01a12e26）から依頼が届き、bot-send で返した（submitted）。表示が無かったのは、ルーチンの結果がまず茶々丸に届き、茶々丸がチャットへ伝える仕組みだから。今回は伝えていなかった」。つまり、茶々丸の側で届いた依頼が立花さんに見えるかは、茶々丸がチャットに書くかどうかで決まり、seamless からは保証できない。Mac の側（依頼を送った会話）では、返信が会話に届き、段も記録に残る。

### この試験の外で、茶々丸の名前で試みられた 3 通（2 通は submitted、1 通は invalid_reply。12:39 に訂正: 送ったのは茶々丸ではなく Codex の会話。下の「訂正」を参照）

| 時刻（JST） | 宛先 | ID | 結果 |
|---|---|---|---|
| 12:22:40 | `codex:01a12e21`（立花さんが 12:22:06 に「T2-8b の試験です。受け取ったら bot-send でこの会話に一行返してください」だけを打った Codex の会話。茶々丸への送信は記録に無い） | `t2-8b-ack-20261012-01a12e21-001` | `submitted` |
| 12:27:40 | `claude:968ced28`（AISDR_UI2 の team-plan-roadmap の会話） | `t2-8b-codex-reply-20261012-01` | 署名の記録はあるが予約は無い（Mac が `invalid_reply` で断った。下の訂正の節） |
| 12:27:45 | `claude:968ced28`（同上） | `t2-8b-codex-ack-20261012-01` | `submitted` |

- （12:39 に撤回）この節を書いた 12:32 の時点では「3 通と 2 回の一覧は茶々丸が送った」と書いていた。これは誤りで、確定した事実は次の 3 行と、下の「訂正」の節のとおり。
- 12:21:25 と 12:22:37 の一覧（`bot-sessions`）は、茶々丸ではなく Codex の会話（`01a12e1f` の下の作業 `01a12e20` と、`01a12e21`）が Mac で動かした（両方の rollout に `bot-sessions chachamaru` の実行がある）。一覧に載るのは登録名、作業フォルダ、版だけで、会話の題名や本文は載らない（`src/external-inbound.ts` の `list`）。
- `codex:01a12e21` へ送ったのは、`codex:01a12e21` 自身（`bot-send chachamaru` を自分で動かした）。
- `claude:968ced28` は 12:27:37 に `codex:01a12e1f` へ `t2-8b-leaderpm-20261012-01` を送った。12:27:40 と 12:27:45 の 2 通は、`codex:01a12e1f` の下の作業がその返事を茶々丸の名前で送ろうとしたもの。
- 3 通とも本文は Mac に残らない（予約は hash だけ）。自動の返信の連鎖は起きていない（3 つの会話から茶々丸への送信は記録に無い）。
- 設計への影響: 名簿の範囲（`limits`）の中なら、Mac は新しい依頼の送り先の正しさを確かめない。配布の前に「茶々丸が送れるのは、茶々丸に依頼を送った会話への返信だけ」に絞るかを決める（先送りの表に足した）。（12:39 訂正: この節の 3 通は茶々丸ではなく Codex の会話が送った。12:26 の節「T2-8b の 2 回の試み」と、下の「訂正」の節を参照）

## T2-9 の前の補い（2026-10-12 12:3x JST）

- T2-8c と T2-8d の「送り手が名簿の登録名として確かめられた」の対応: 2 通とも、Mac は封筒の HMAC を名簿の `chachamaru`（鍵の版 1）の受信鍵で確かめ、nonce を `~/.seamless/nonces` に記録した（記録は peer `chachamaru`、keyVersion 1、op `send`、id は各返信の ID）。受け手の表示が `declared` なのは、その nonce の記録が `signedBy: 'mac'`（Mac が茶々丸の代わりに署名した）だからで、確かめに失敗したからではない（Plans.md の先送りの表「茶々丸の側での署名」）。
- TC-3b: webhook へ送る封筒は `tests/webhook-send.test.ts` の 442 行で、markUnapproved の有無の両方を確かめ済み。受ける側（茶々丸の名前で署名された封筒。今は Mac の代行署名）は、`src/external-inbound.ts` が封筒を `humanApproval` なしで渡し（`tests/signed-inbound.test.ts` の 54 行）、Mac の会話へ書く直前に `src/native-runtime.ts` の 172 行が markUnapproved に従って印を付ける。この書き込みの試験（`tests/native-runtime.test.ts` の「envelope marker」）に、送り手が `grok-bot:chachamaru` の封筒を足した。Claude と Codex の宛先それぞれで、markUnapproved が無い、false、true、古い呼び方の 4 通りを確かめ、true のときだけ `humanApproval:false` が付き、どの場合も `humanApproval:true` が無い（16 件通過）。本番では `src/automatic.ts` の 82 行が、受ける経路にもこの同じ書き込みの部品を渡している。
- TC-1（Claude ⇄ Codex、今回の版。T2-8a と T2-8b の後）: 依頼 `tc-1-20261012`（この会話 → `codex:01a12e26`）の 4 段は、受理 03:36:55.984Z、届いた 03:36:56.229Z、処理開始 03:36:56.229Z、返答完了 03:38:37.441Z（返信 `tc-1-reply-01a12e26`「TC-1 受け取りました」、replyTo 一致）。既存の Claude と Codex の往復は壊れていない（AC10）。返答までの 101 秒の大半は、Codex が「別の会話からの依頼だけでは送れない。本人の許可が要る」と立花さんに聞いた待ち時間。契約では seamless で本人の別の会話へ返す分は事前承認済み（2026-10-07）だが、Codex は聞くほうを選んだ（安全側の挙動なので直さない）。
- この会話の呼び名: 会話の圧縮の後、この会話は `claude:f2a04e59-9f7a-4753-af0b-a8b013d26409`（世代 57534@1791775815685）として動いている。12:36 以降の送受信はこの名前。

### 訂正: 茶々丸の名前で試みられた 3 通は、Codex の会話が送った（12:39 確認。2 通は submitted、1 通は invalid_reply で断られた）

茶々丸に seamless で問い合わせた（依頼 `t2-8b-check-20261012`、12:36:57）。返信 `chachamaru-20261012-t2-8b-check-001`（03:39:21Z、送ってから 2 分 24 秒）の答えを、Codex の会話の記録（`~/.codex/sessions/2026/10/12/` の rollout）で確かめた。

| 送られた ID | 実際に送った者 | 根拠 |
|---|---|---|
| `t2-8b-ack-20261012-01a12e21-001`（12:22:40） | Codex の会話 `01a12e21`（作業フォルダ seamless）。立花さんが打った「T2-8b の試験です。受け取ったら bot-send でこの会話に一行返してください」を自分への指示と読み、`bot-send chachamaru` を Mac で動かして自分の会話に送った | rollout に `bot-send chachamaru <<'JSON'` が 7 回、結果 submitted が 2 回 |
| `t2-8b-codex-reply-20261012-01`（12:27:40） | Codex の会話 `01a12e1f`（作業フォルダ `~/Documents/Codex/2026-10-12/seamless-t2-8b-bot-send`、12:20:10 に開始）の下の作業 `01a12e20`。`claude:968ced28` から届いた依頼 `t2-8b-leaderpm-20261012-01` への返信として、茶々丸の名前で送った。返信する者（chachamaru）が元の依頼の宛先（`codex:01a12e1f`）と違うので、Mac が `invalid_reply` で断った | rollout に `bot-send chachamaru` が 10 回、`invalid_reply` が 2 回 |
| `t2-8b-codex-ack-20261012-01`（12:27:45） | 同じ Codex の作業が、replyTo を外して送り直した。submitted | 同上 |

- 茶々丸が `bot-send` で送ったのは、この問い合わせ（12:36:57）より前は 2 通（T2-8a と T2-8b の返信）。問い合わせへの返信 `chachamaru-20261012-t2-8b-check-001`（12:39:21）を含めると 3 通。どれも Mac の代行署名なので、受け手には `declared`（名乗り）として出る。茶々丸の会話の記録はこの Mac に無いので、この 3 通が茶々丸の書いたものかは、茶々丸の申告と、送られた時刻と内容が依頼に合っていることからの推定。
- 起きたこと: Plans.md の先送りの表の「この Mac で本人の権限でコマンドを動かせる者は、誰でも茶々丸として署名できる」が、使い始めた当日に、立花さんの Codex の会話によって実際に起きた。悪意ではなく、私が渡した文の「bot-send でこの会話に一行返して」を Codex が自分への指示と読んだため。
- 守れたこと: 届いた 2 通は、受け手には送り手が `declared`（確かめていない名乗り）として出た。残る 1 通（返信の取り違え）は `invalid_reply` で止まり、届いていない（T2-5 の拒否の経路が実物で働いた）。どの会話も自動で返信の連鎖を起こしていない。
- 判断が要ること（立花さんへ）: 先送りの期日（配布の前）を前に倒し、`bot-send` と `bot-sessions` を「Grok Bot のアプリから動かしたときだけ」受け付ける形にするか。今の呼び手の特定（`src/caller.ts` の祖先と署名の確認）を使えば、Claude、Codex、Grok CLI の会話から動かした `bot-send` を断れる。セキュリティの変更なので、立花さんの判断の後に行う。

## T2-9 の判定の前の verify（2026-10-12 12:4x JST）

- `bash scripts/verify.sh` を af54da3 で走らせた: exit 0。node 705 件すべて通過（TC-3b で 8 件増えた）、帯 99 件、`peer-secrets: ok`（茶々丸の登録あり。値は環境変数か Keychain から読み、リポジトリと `~/.seamless` に無い）。af54da3 の後のコミット（2304f2a 以降）は specs だけで、コードは同じ。
- 54994dd で走らせた分も exit 0（node 697 件、帯 99 件）。

## T2-9 と T2-10 P2 の正式な判定（2026-10-12、Codex gpt-6-astra、high、読み取り専用）

- 判定役: Codex `gpt-6-astra`、推論 high、`codex-headless exec -s read-only`。作ったのは Claude なので逆の家系。P2 のコードの差分は `git diff 3b9196d <版> -- src scripts tests mods`。確かめた 7 項目: 試験が T2-1〜T2-6 と TC-3b を満たすか、記録が T2-8a〜f と TC-1 を満たすか、実物で分かったこと（Codex の会話が茶々丸の名前で送った件）が先送りの表の範囲か、承認として扱わないこと、鍵と住所の露出、既存の経路、配布できる構造。
- 1 回目（4c33850）: FAIL、確信度 high。コードの指摘 0 件。項目 3 だけ No（evidence.md に「茶々丸が送った」という旧説明が断定形で残り訂正と食い違う、「今日 2 通だけ」の集計の範囲）。→ 382fe9f と 0cb9b42 で直した。
- 2 回目（0cb9b42）: FAIL、確信度 high。Plans.md の 20 行と 27 行が「3 通が届いた」と読め、1 通は invalid_reply で断られた記録と食い違う。→ 3be0f44 で「試み 3、届いた 2、断られた 1」に書き分けた。
- 3 回目（3be0f44）: **PASS**、確信度 high。7 項目すべて Yes。判定役は型検査 exit 0、空白の検査 exit 0 を自分で確かめ、全体試験は af54da3 の verify（exit 0、node 705 件、帯 99 件、peer-secrets ok）を採用した（af54da3 と 3be0f44 のコードは同じ）。判定役は実在の予約と nonce と Codex の会話の記録でも照合した。
- 原文: `reviews/t2-9-judge-4c33850.md`、`reviews/t2-10-rejudge-0cb9b42.md`、`reviews/t2-10-rejudge-3be0f44.md`。

## 立花さんの判断 3 の実装（2026-10-12 13:1x JST）: Bot と Dot は作業フォルダで絞らない

- 変更: `scripts/peer-roster-write.ts` の新しい登録の既定の範囲を `$HOME/LocalWork` から `"all"`（すべての場所）にした。フォルダを渡せば絞れる（これまでどおり）。既にある登録は、フォルダを渡さない限り持ち主の範囲を変えない（これまでどおり）。
- 試験: `tests/peer-setup.test.ts` の「first run」の期待を `scope:'all'` と「範囲 すべての場所（既定）」の表示に変え、今のコードで落ちることを確かめてから直した。設定スクリプトの試験 20 件すべて通過。
- 名簿の書き換え: 茶々丸の登録の `scope` を `["/Users/tachibanashuuta/LocalWork"]` から `"all"` にした（名簿の形の検査 `validPeers` を通してから、0600 のまま置き換えた。書き換え前の写しは会話の作業用フォルダにだけ置いた）。書き換え後も一覧で `grok-bot:chachamaru` は registered、send 可。`~/Documents/Codex/2026-10-12/seamless-t2-8b-bot-send`（12:20 の 1 回目の試みで茶々丸が一覧に出なかった場所）も範囲に入ることを `scopeAllows` で確かめた。
- 変えていないもの: 手元の制限 `~/.seamless/limits.json`（今は無い）で範囲を絞ったときに、名簿の `"all"` より制限が優先される照合（`src/external-inbound.ts` の `inRange`）。Mac の Claude、Codex、Grok CLI どうしの範囲。
- 判定（Codex gpt-6-astra、high、読み取り専用、9926e73）: FAIL、確信度 high。項目 1、2、4 は Yes（外の登録だけが広がり、手元の制限、失効、未設定、送信の可否、除外は弱めていない。再実行で既存の範囲は広がらない。記録と実在の名簿が一致）。項目 3 が No: `scripts/peer-setup.sh` の 23 行の使い方の表示が「新規は 茶々丸 と $HOME/LocalWork」のまま。→ 使い方の表示の試験（`tests/peer-setup.test.ts` の引数の試験で、不明なオプションのときの表示に「新規は 茶々丸 と すべての場所」があり LocalWork が無い）を先に足して落ちるのを確かめ、表示を直した（20 件通過）。原文は `reviews/scope-all-judge-9926e73.md`。
- 再判定（3e7e5ef）: **PASS**、確信度 high。使い方の表示と試験が新しい既定に合い、前回 Yes の項目も崩れていない。verify は 3e7e5ef で exit 0（node 705 件、帯 99 件、peer-secrets ok）。原文は `reviews/scope-all-rejudge-3e7e5ef.md`（判定の原文の行末の空白は消した）。

## 立花さんの判断 2 の確認: 茶々丸dot まわりの使い分け（2026-10-12 13:10〜13:50 JST）

調べ方: workflow `wf_ec48a770-212`（Claude の調査役 3 体が、リポジトリの試作、アプリ標準の機能、過去の判断を別々に調べ、まとめ役 1 体と反証役 1 体が突き合わせた。読み取りだけ）。反証役の指摘のうち要点はリーダーが手元で確かめた。

| 流れ | 担当 | 状態 | 根拠 |
|---|---|---|---|
| Dot → Mac の Codex（タスクを作る、続ける） | アプリ標準（Dot の「あなたのコンピューター」） | 公式にある。この Mac にも Dot に結び付いたタスクの記録がある | learn.chatgpt.com/docs/dots/computers-and-apps（2026-10-12 取得）。`~/.codex/.codex-global-state.json` の `aeon-subtasks-by-account-v1` と `cloud-aeon-sidebar-cache-v1`（Dot の会話ごとの印） |
| Mac の Codex → Dot に結び付いたタスク | アプリ標準（Codex の道具 `codex_app` の `send_message_to_thread`、`hostId: durable`） | 使われた記録がある（Codex の会話が「dot とやりとりして…」と送った）。そこから Dot 本人へ報告が戻るかは未確認 | `~/.codex/sessions` の rollout（`"hostId":"durable","prompt":"人間立花からこの元チャットで『dotとやりとりして…』"`）。公式は「裏の作業は Dot に報告を返す」と書く（tasks-and-memory） |
| Mac の Claude、Grok CLI、茶々丸 → Dot | アプリ標準の道は見つからない。seamless の通知（MCP Events、測定 M2 で通った）か、Codex の会話を経由する形 | seamless の通知は試作だけで本体に無い（T3-17） | evidence.md の M2 の節。`src/peers.ts` の product は grok-bot だけ |
| Codex ⇄ Codex | アプリ標準（`codex_app`）と seamless が重なる | 別の論点 | `~/.codex/state_5.sqlite` の `thread_dynamic_tools` |
| Mac → Dot の通知の作り | 二重の試作: 本線の Codex の会話の `experiments/dot-events`（保持と予約は揃うが実物の購読を受けられない作り、実機 0 回）と、`experiments/dot-m2/notify.ts`（実物で通った、保持はメモリだけ） | T3-17 で 1 本にする（notify.ts を土台に、events.ts から保持、依頼ごとの予約、接続先固定の受け口などを取る案） | 調査役が両方の試験を走らせた（21 件と 34 件、すべて通過） |

- 「Codex 内部ですでにできている」の読み: 最も字面に近いのは、Codex の道具 `codex_app` で Dot に結び付いたタスクへ送れること（上の表の 2 行目）。本線の Codex の会話が作った `experiments/dot-events` の可能性もある。どちらも、Claude、Grok CLI、茶々丸から Dot へ届ける道にはならない。
- seamless の Codex の部品は、`src/native-runtime.ts` が会話の持ち主を `hostId:'local'` で探すので、Dot に結び付いたタスク（durable）を一覧に出さない（コードからの推論。実行は未確認）。
- T3-17 の中で決める必要が見つかった衝突: M2 の後に書いた「本文は Dot に読み取りのツールで取らせる」は、Plans.md の H10「Dot からの read は閉じる」とぶつかる。
- 安全の観察（seamless の変更ではない）: `~/.codex/config.toml` の既定が全権限で承認なしの設定なら、Dot が作るローカルのタスクもその設定で動く可能性がある（未確認）。
- 訂正: Q5 という問いを最初に立てたのは Claude 側の spec.md（76b04a9、2026-10-08 16:46）で、Codex の文書（dot-events-integration.md）は答えの案を足した。

## 測定 M3: 茶々丸が Mac で動かすコマンドの起動元（2026-10-12 13:5x JST）

依頼 `m3-whoami-20261012`（13:10:25）に、茶々丸が返信 `chachamaru-m3-whoami-reply-001` で答えた（立花さんが Grok Bot の画面で承認した後。茶々丸は台本の中身を読んで読み取りだけと確かめてから、自分の Bot の UUID を渡して 1 回動かした。終了コード 0）。送り手の表示は declared（Mac の代行署名）。

| 項目 | 結果 |
|---|---|
| 起動元 | `bash` ← `/bin/zsh` ← `Grok Bot Helper`（Identifier `com.anysphere.sand.electron-helper`、TeamIdentifier `DCNK4UB866`）← `Grok Bot`（Identifier `com.anysphere.sand`、TeamIdentifier `DCNK4UB866`、親は launchd） |
| 関係する環境変数の名前 | `AGENT_TRANSCRIPTS`、`CURSOR_AGENT`、`CURSOR_CONVERSATION_ID`、`CURSOR_REQUEST_ID`、`SAND_AGENT`、`SAND_CLIENT_APP_VERSION`、`SAND_DATA_ROOT`、`SAND_LAB`、`SAND_LOCAL_EXEC_GENERATION`、`SAND_PACKAGED`、`SAND_SENTRY_ENVIRONMENT`、`SAND_SENTRY_RELEASE`、`__CURSOR_SANDBOX_ENV_RESTORE` |
| 茶々丸の Bot の UUID（`69590697-ebf9-44d5-8f40-64dbc9455660`）を値に含む変数 | `CURSOR_CONVERSATION_ID`、`__CURSOR_SANDBOX_ENV_RESTORE` |
| 作業フォルダ | ホームフォルダ |

- 茶々丸の補足: 同じ Grok Bot のアプリから、ほかの Bot も Mac のコマンドを動かす（Bot のサーバーのエージェントのフォルダは 77 個）。アプリの署名だけでは茶々丸とほかの Bot を見分けられない。
- 分かったこと: 「Grok Bot のアプリから動かされた」は、起動元のアプリの署名（Identifier とチーム ID。表示名ではない）で確かめられる。「どの Bot か」は `CURSOR_CONVERSATION_ID` の UUID で見分けられる。
- 未確認: 茶々丸の UUID が、ルーチン（webhook で起きた処理。今回はこれ）と、立花さんとのチャットのどちらでも同じか。UUID は環境変数なので、同じアプリの中のほかの Bot がわざと書き換えれば名乗れる（Codex や Claude の会話からは、起動元の署名で断れる）。

## 立花さんの判断 1 の実装（2026-10-12 14:0x JST）: bot-send を茶々丸自身にだけ使わせる

- 作り: `src/bot-executor.ts` を足し、代行署名（`src/bot-sign.ts`）の鍵を読む前に確かめる。署名するのは、(1) 起動元の 8 段以内に、lsof で取った実行ファイルが Grok Bot のアプリか helper の署名（`codesign --verify --strict`、要件はチーム `DCNK4UB866` かつ Identifier `com.anysphere.sand` か `com.anysphere.sand.electron-helper`）を持つものがあり、(2) 環境変数 `CURSOR_CONVERSATION_ID` の UUID が、名簿のその登録の新しい欄 `botIds` にあるとき。表示名、プロセス名、argv[0] は使わない。どちらかが欠ければ `{"status":"executor_unverified","reason":…}`（`bot_id_unset`、`bot_id_missing`、`bot_id_mismatch`、`not_from_bot_app`）を返し、鍵を読まず、署名も配送も記録もしない。
- 名簿: `src/peers.ts` に `botIds`（小文字の UUID の 1 個以上の並び、重複なし）を足した。
- 試験（先に書いて落ちるのを確かめてから作った）: `tests/bot-executor.test.ts`（本人、Codex の会話、名前だけ Grok Bot の偽物、同じアプリのほかの Bot、UUID なし、壊れた UUID、`botIds` なし、8 段の上限と循環、codesign の要件）、`tests/peers.test.ts`（`botIds` の良い例 2、悪い例 5）、`tests/bot-send.test.ts`（組み込み: Codex の会話からは UUID を手で入れても断る、ほかの Bot は断る、本人は届く、`bot-sessions` も同じ。実プロセスの試験は「試験の実行役は Grok Bot ではないので断られ、nonce も残らない」に変えた）。関係する試験 156 件と、verify.sh（node 713 件、帯 99 件、peer-secrets ok、exit 0）が通った。
- 実物の確認（この Mac、読み取りだけ）: 要件は Grok Bot の本体（67 ms）と helper（33 ms）で通り、Cursor（チーム `VDXQ22DGB9`）、Codex、Claude では通らない。
- 残る穴（Plans.md の先送りの表を更新）: 同じアプリのほかの Bot が UUID をわざと書き換えれば名乗れる。設定スクリプトは `botIds` を書かない（期日: 2 体目の Bot を登録する前）。
- 名簿の茶々丸の行に `botIds` を入れるのは、本線の取り込みの後（今の本線のコードは知らない欄があると名簿全体を使えないと扱うため、先に入れると茶々丸の送受信が止まる）。
- 判定（Codex gpt-6-astra、high、読み取り専用、7a5ea67）: FAIL、確信度 high。項目 1〜5 は Yes（Mac の会話からは UUID を手で入れても署名されない、名前は使わない、ほかの Bot は断る、断ったときは鍵も記録も触らない、既存の経路と「MCP と serve からは署名を頼めない」は保たれる、`botIds` なしは誰も通さない）。項目 6 が No: (1) `tests/peers.test.ts` の `botIds` の悪い例 5 件が名簿の形で渡されず、`botIds` の検査に届いていない。(2) Plans.md の「茶々丸の分は手で入れた」と evidence の「取り込みの後」が食い違い、署名の行の期日の欄に判断待ちの文が残っている。(3) `scripts/peer-roster-write.ts` は行を作り直すので、再実行で既にある `botIds` が消える。→ (1) 5 件を `roster(...)` で包んだ。(3) 再実行の試験に `botIds` を足して落ちるのを確かめてから、再実行で `botIds` を残すようにした。(2) Plans.md の 2 行を直した。関係する試験 102 件通過。原文は `reviews/executor-judge-7a5ea67.md`。
- 再判定（de11b44）: **PASS**、確信度 high。3 点が直り、試験がそれぞれを捉え、項目 1〜5 も保たれている。再実行で残すのは同じ登録の既にある `botIds` だけで、範囲や送信の可否は広がらない。verify は de11b44 で exit 0（node 713 件、帯 99 件、peer-secrets ok）。原文は `reviews/executor-rejudge-de11b44.md`。
- 本線への取り込み（立花さん、2026-10-12 15:28、0b0136e → 09384b1）の直後に、見張りが茶々丸の名簿の行へ `botIds: ["69590697-ebf9-44d5-8f40-64dbc9455660"]` を入れた（15:28:30。`validPeers` を通してから 0600 のまま置き換え、読み直して ok）。本線のコードで一覧を取り、茶々丸は registered、send 可のまま。15:29:03 に、本物の経路が新しい確認を通るかを見るため、茶々丸へ `bot-send` で 1 行返す依頼 `m3-check-20261012` を送った（submitted）。
- 本物の経路の確認の結果（茶々丸の報告を立花さんが貼り付け、15:3x）: 茶々丸が `bot-send` で「M3-2 受け取りました」を返そうとして、`executor_unverified`、reason `bot_id_missing` で断られた。返信は届いていない。つまり本線の 09384b1 では、茶々丸から Mac への返信が止まっている（Mac から茶々丸へは動く）。
- 考えられる原因（未確認）: (a) リーダーの読み違い。M3 の台本は「値に UUID を含む変数の名前」を出す作りで、`CURSOR_CONVERSATION_ID` が UUID そのものかは確かめていなかった。値が UUID の前後に文字を持つ形なら、`src/bot-executor.ts` の形の検査で `bot_id_missing` になる。(b) `bot-send` を動かしたときだけ、この変数が渡っていない（道具や承認の流れの違い）。
- 切り分け: 台本に `CURSOR_CONVERSATION_ID` の形（UUID の部分は `<UUID>` に伏せる）を出す節を足し（66ad88f）、15:42:23 に茶々丸へ「bot-send と同じ動かし方で台本を動かし、結果は立花さんへチャットで」と依頼した（`m3-diag-20261012`、submitted）。

## 測定 M3-4 と、ルーチンからの返信の確かめ方（2026-10-12 15:4x〜16:xx JST）

- 茶々丸の切り分けの報告（立花さんの貼り付け、15:4x）: チャットから動かすと `CURSOR_CONVERSATION_ID` は茶々丸の UUID そのもの。受け口のルーチンから動かすと `sand-subagent-<UUID>` の形で、茶々丸の UUID を値に持つ変数は無い。起動元はどちらも Grok Bot のアプリで、経路も同じ。違いは、M3 は立花さんの承認の後、M3-2 はルーチンの範囲内として承認なしで動いたこと。リーダーの読み違いではなく、ルーチンの ID が別だったのが原因。
- 測定 M3-4（`experiments/grok-bot-m3/note-id.sh`、値と時刻を本線の `.local/m3/ids.txt` に書くだけ）: ルーチンに 2 回動かしてもらった。15:46:04 は `sand-subagent-48e30927-af7f-4990-94ba-8786b6a8a37a`、15:46:42 は `sand-subagent-1dfe487b-0ecc-4781-9c50-f7101a293248`。ルーチンの ID は実行ごとに変わるので、環境変数ではルーチンの茶々丸を見分けられない。
- 作り（判断 1 の続き）: Mac が茶々丸へ webhook で送るたびに、その依頼だけの合言葉（24 バイトの乱数、base64url で 32 文字）を本文の `replyToken` に入れ、予約の記録には指紋（SHA-256）だけを残す（`src/webhook-send.ts`、`src/delivery.ts`）。呼んだ会話への結果には出さない。`bot-send` の入力に `replyToken` を足し（署名する本文には入れない）、合言葉があれば、元の依頼の予約が茶々丸宛てで、返信先が元の依頼の送り手の同じ世代で、24 時間以内で、指紋が合うこと（比べる時間は値によらない）を確かめる。起動元が Grok Bot のアプリであることも合わせて確かめる。合言葉が無ければ、これまでの UUID の確認。
- 試験（先に書いて落ちるのを確かめてから作った）: `tests/webhook-send.test.ts`（本文に依頼ごとに別の合言葉がある、予約には指紋だけ、結果とディスクに合言葉そのものは無い。scene 1 の本文の欄に `replyToken` を足した）、`tests/bot-executor.test.ts`（合言葉の 8 つの断る場合、Codex の起動元は合言葉があっても断る、合言葉だけで依頼が無いのは断る）、`tests/bot-send.test.ts`（ルーチンの ID のままで合言葉つきの返信は届く、違う合言葉は断る、合言葉は署名も配送もされない、合言葉は文字列だけ）。verify.sh は exit 0（node 716 件、帯 99 件、peer-secrets ok）。
- 使い方の文（`handoff/chachamaru-mvp.md`）に、返信に `replyToken` を入れる手順を足した。
- 判定（Codex gpt-6-astra、high、読み取り専用、e9f7aa9）: FAIL、確信度 high。項目 1〜4 は Yes（合言葉は茶々丸のアドレスにだけ渡る、予約には指紋だけ、比べる時間は値によらない、宛先と返信先と期限と形を確かめる、起動元のアプリの確認は合言葉があっても外さない、署名する本文と配送される封筒に入らない、既存の経路を壊さない）。項目 5 が No: (1) 指紋を予約に書くのが茶々丸の受け口の応答の後で、その前に返信が来ると断られ、送った直後にプロセスが落ちると二度と返信できない。(2) 合言葉に使用済みの印が無く、期限内なら返信の ID を変えて何度でも使える。
- 直し: (1) 配送の部品（`src/delivery.ts`）に、送る前の準備の口 `prepare` を足した。webhook の部品はそこで合言葉を作り（`replyWord`）、指紋を送る前の予約（pending）に書き、合言葉そのものは送る処理にだけ渡す。合言葉が渡らなければ送らない。(2) 合言葉で確かめ、起動元のアプリも確かめた後に、元の依頼ごとの印を `~/.seamless/reply-words-used/` に作る（中身は返信 ID。一時ファイルに書いて fsync し、link で置くので、半端な印は残らない）。同じ返信 ID の送り直しは通し、別の ID は `reply_token_used` で断る。断った試み（アプリからでない）は印を使わない。試験（先に書いて落ちるのを確かめてから作った）: 送信の最中に予約を読むと pending で指紋がある、応答が無く unknown でも指紋が残る、同じ返信 ID は 2 回通る、別の ID は断る、同時の 2 つは片方だけ通る、pending の依頼にも返信できる、返信 ID が無い合言葉は断る。
- 再判定（Codex、eddbfbc）: FAIL、確信度 high。項目 1（指紋は POST の前に pending の予約へ書かれ、応答前や unknown でも照合できる。合言葉は外に出ない。prepare は Bot 宛てだけ）と項目 3（前回の Yes を保つ）は Yes。No は 2 つ: (2) 不正な返信 ID（例: 257 文字）でも先に合言葉を使用済みにし、その後の封筒の検査で断られて、直した返信も `reply_token_used` になる。強制終了で一時ファイルが残る。(4) 試験の予約先が `mkdtemp` の直下で、印が共通の一時フォルダ（`tmpdir()/reply-words-used`）に作られて残る（実際に 4 個残っていたので消した）。使い方の文の「同じ ID を 2 度使わない」と「同じ ID で送り直してよい」が並んで食い違う。
- 直し: 代行署名は、署名する前の本文を封筒と同じ検査（`parseSignedEnvelope`）に先に通し、通らなければ合言葉に触れずに `envelope_invalid` を返す。印の置き場所では、1 分より古い一時ファイル（強制終了の残り）と、2 日より古い印（合言葉は 1 日で切れるので要らない）を、印を作るたびに消す。試験は予約先を `<一時フォルダ>/reservations` にし、印も同じ一時フォルダの中に作られて後片付けされるようにした。足した試験: 不正な返信 ID は合言葉を使わず、直した返信は届く。古い一時ファイルと古い印は消え、新しい印は残り、共通の一時フォルダには何も作られない。続けて 2 回走らせても同じ結果。使い方の文は「別の返信に同じ ID を使わない（届かなかった同じ返信の送り直しは同じ ID）」に直した。
- 2 回目の再判定（Codex、20a02de）: FAIL、確信度 high。項目 2（前回の Yes を保つ）は Yes。(a)〜(d) のうち 257 文字の ID、一時ファイルの掃除、試験の隔離、使い方の文は直っていると確認された。残る穴: 受ける側（`src/external-inbound.ts`）には送る種類ごとの追加の検査（空の本文、一覧の宛先など）があり、署名の前の検査は `parseSignedEnvelope` だけだったので、空の本文の返信が合言葉を使ってから受ける側で断られる。→ 送る種類ごとの検査も含めた 1 つの関数 `envelopeFor`（`src/signed-envelope.ts`）を作り、受ける側と代行署名の両方から使うようにした。試験に「空の本文、一覧の宛先の返信は合言葉に触れずに断られ、直した返信は届く」を足した（先に落ちるのを確かめた）。関係する試験 79 件通過。
- 3 回目の再判定（Codex、71e3be9）: FAIL、確信度 high。項目 2 は Yes（空の本文などの穴は直った）。残り: (A) 受ける側の断る理由の順番が変わった（送り手の取り違えと空の本文が重なると、以前は `sender_mismatch`、今は `envelope_invalid`）。(B) 茶々丸が別の送信で使った返信 ID を指定すると、合言葉を使った後で `id_conflict` になり、どの ID でも返せなくなる。宛先の会話が無い、範囲外、長すぎる本文は合言葉を使った後に断られるが、返信の予約より前なので、同じ返信 ID で送り直せば救われる（判定役の確認）。
- 直し: (A) 形の検査を「封筒の欄（`parseSignedEnvelope`）」と「送る種類ごと（`callShape`）」の 2 つに分け、受ける側は欄 → 送り手 → 種類の順に戻した。代行署名は両方を続けて使う（`envelopeFor`）。(B) 合言葉を使う前に、その返信 ID で茶々丸がすでに送った予約があり、それが別の依頼への返信か別の宛先なら `reply_id_taken` で断る（同じ返信の送り直しは断らない）。試験（先に落ちるのを確かめた）: 送り手の取り違えと空の本文、送り手の取り違えと一覧の形が重なると `sender_mismatch`。別の依頼で使った返信 ID は合言葉に触れずに断られ、新しい ID の返信は届く。関係する試験 79 件通過。
