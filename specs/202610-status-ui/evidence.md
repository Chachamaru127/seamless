# 状態の帯の証拠

## 2026-10-04 U1〜U6（手元の実装と試験）

- 前提の実測: Claude Code CLI 2.1.289（mod の条件 2.1.287 以上を満たす）。Desktop アプリ 2.19675.0 の同梱は 2.1.284 と 2.1.286 で、Code タブでは mod が読み込まれない（U9 は外部条件待ち）。
- 取り込んだ部品: whats-agent-doing（https://github.com/tzafrir/whats-agent-doing、commit 1efd306948e2cb1866a02fe65f0cdbfb0c3da277、MIT、Tzafrir Rehan）。手元の写しで `claude plugin validate` PASS、`claude plugin test` 11件 PASS を確かめてから取り込んだ。
- 第13便（Codex Astra）: `mods/seamless-band/` を作った（41fc38e）。リーダーの実測で本体 332 試験、mod 35 試験 PASS、validate --strict PASS、verify.sh 終了 0。
- 判定（Claude Opus 5.5、別家系）1回目 FAIL。重大1: 帯の照会が `~/.seamless/seen.json` を書き、Claude 自身の sessions に出る世代の変化と除外切れの表示を先に消す。中1: 拒否が赤にならず、試験の stub が実際の形でない。中2: turn.step を途中で終えたとき内側の流れを閉じない。軽6件。
- 第14便（Codex Astra）: sessions に `peek`（seen.json を読みも書きもしない照会）を足し、帯はそれを使う。依頼の照会結果に記録の状態 `delivery` を足し、拒否（rejected）だけを赤にする。試験の stub を本体の statusResult と stages から作る。turn.step の finally で内側を閉じる。軽6件を直した（f23e4cf）。リーダーの実測で本体 343 試験、mod 48 試験 PASS、verify.sh 終了 0。
- 判定 2回目 PASS（重大、中なし）。残りの軽: MCP の sessions が inputSchema に無い peek を受け付ける（害なし、差分が見えなくなるだけ）、使われていない `plural` が残る、turn.step の finally で内側の return が reject すると戻しの処理が飛ぶ（engine 側の例外のときだけ、確信度 low）。
- `claude plugin validate --json` の calls: `$.agent.list`、`$.clock.after`、`$.clock.every`、`$.clock.now`、`$.process.run`、`$.state.get`、`$.state.set`、`$.ui.invalidate`、`$.ui.resolve`（AC6、AC7 の範囲内）。

## U7（実物の確認）

- 2026-10-04: ターミナルで `claude --plugin-dir mods/seamless-band --model haiku` を起動した。最初にフォルダの信頼の確認が出たので、立花さんの操作待ち。撮影と観測は未実施。

## 2026-10-05 対象をアプリの Code タブに戻し、見た目を見本に合わせる

- 立花さん「CLIは想定してない、アプリ版のUI上で出してほしい」。元の依頼（2026-10-02「APP画面にUIを追加」「openaiとアンソロピック社のロゴと、ロゴの隣に数字」）に戻し、spec の AC1 を Code タブだけに、ロゴを見本の単色の印（Svg）にした（aae9a4e）。
- 第15便（Codex Astra）: 見本（out/ask-pro/20261003-claude-band）の色と構成に合わせた。Svg のロゴは desktop の面だけで描き、ターミナルでは会社名の文字（ecd479a）。リーダーの実測で本体 343、帯 52 試験 PASS、verify.sh 終了 0。
- 判定（Claude Opus 5.5）PASS（重大なし）。中は Desktop の実画面で確かめる3件: borderStyle round の枠で閉じた状態が1行に収まらないおそれ、区切り線（高さ 0.0625 の Box）が消えるか太くなるおそれ、ターンが終わっても TodoWrite の目的が待機中の行に残る。軽5件（Bash の description が見出しから消える、灰の回数に「未確認」を付ける、全角空白が半角に潰れる、ロゴの試験が path の先頭だけ、開いた状態の行数の見積もり）。
- 外部条件: Desktop アプリ 2.19675.0 の同梱 Claude Code は 2.1.286 で、mod の条件（2.1.287 以上）に届かない。Code タブでの実物の確認はこの更新待ち。

## 2026-10-05 Codex アプリに出せるかの調査（spec Open questions 1）

立花さん「Codexも調査進めてOK」。読み取りだけで、2つの経路で調べた。
- 調査役（Claude のサブエージェント）: 公式文書（developers.openai.com/plugins/build/extensions、github.com/openai/mcp-extensions の spec.md、chatgpt-ui）と、/Applications/ChatGPT.app（26.930.31730）の app.asar を展開せずに読んだ。
- Codex 本人（会話 01a0f59d）: seamless の send で尋ね（seamless-codex-ui-q1）、replyTo 付きの返事（seamless-codex-ui-answer-q1）を受け取った。追跡では到達と処理開始を観測した。

結論（両者一致、確信度 medium）:
- 入力欄の上に常駐する帯を差し込む公開の口は見つからない。
- 会話ごとの右側パネルのタブ（thread entrypoint）なら出せる作りがある。MCP サーバーの道具の `_meta["openai/ui"].entrypoints` に `{type:"thread"}`、`_meta.ui.resourceUri` に `ui://…` を付け、資源を `text/html;profile=mcp-app` で返す。UI は MCP App の橋渡し（postMessage の tools/call）で同じサーバーの道具を呼べる。
- 実例: 同梱の code-review プラグイン（`~/.codex/plugins/cache/openai-bundled/code-review/26.930.31730/server.mjs` 47775〜47815 行）が global と thread の入口を宣言している。プラグインの説明に「Codex 用の local MCP App」とある。
- app.asar: thread の入口を右パネルの view に足す処理、`ui://` の必須の検査、`enable_mcp_apps` の条件がある。code-review 以外のサーバーを絞る処理は見つからない。

確かめていないこと:
- `enable_mcp_apps`（`codex features list` では false、under development。アプリ側はリモート設定で上書きしうる）が、このアカウントで有効か。
- 自作のサーバー（config.toml に直接登録した MCP、または手元の marketplace のプラグイン）で、実際にパネルが出るか。
- パネルの UI から道具を呼んだとき、`x-codex-turn-metadata`（seamless が Codex の呼ぶ側を特定する付帯情報）が付くか。付かなければ seamless は caller_unobserved を返す。CLI を直接呼ぶ形は、現行の caller.ts が Codex の CLI 経由を拒むので使えない。呼ぶ側を引数で注入する回避はしない。
- 状態が変わったときにパネルを自動で更新する仕組み（ポーリングか push か）。

## 2026-10-05 Codex の右パネル（C1 の作り）

- 第16便（Codex Astra）: seamless の自動方式の MCP に、資源 `ui://seamless/status` と読み取りだけの道具 `status_panel`（entrypoints thread）を足した（07aee7a）。判定（Claude Opus）PASS、軽7件。
- リーダーの直し（cff306d と次の commit）: 旧形式のキー `ui/resourceUri` を足した（同梱の code-review と同じ）。Codex からの要求への返事、結果が空のときの理由の表示、`resources/templates/list` の空の一覧。時々落ちていた試験（受信の並び順に頼っていた）を依頼 ID ごとの照合にした。判定（Codex Astra）PASS、軽3件のうち2件を直した。残り: 今回の直しの回帰試験。
- 実機の確認（C1）は未実施。Codex で新しい会話を開き、右パネルに「seamless の状態」のタブが出るか、出たら呼ぶ側の行が `codex-turn-metadata` になるかを見る。

## 2026-10-05 C1 の実機の観察（Codex アプリ 26.930.31730）

- 立花さんの承認（画面の占有の許可）を得て、画面の操作で確かめた。新しい会話は作らず、メッセージも送っていない。既存の会話「シームレスチェック」（seamless の作業フォルダ）を開いただけ。
- 会話の右上のパネルには、作業フォルダ「seamless」、「変更」、「ソース」（seamless、すべて表示）が出た。「ソース」の「+」を押すと「プラグインを使用」と「ファイルまたはフォルダーを添付」が出た。
- 「プラグインを使用」の候補は、導入済みのプラグインの一覧（Cloud Environment、Writing Style、Code Review、Browser など）だった。見えた範囲に seamless は無かった。検索欄への入力は反映されず、一覧の全体は確かめていない。
- 「seamless の状態」のタブは出なかった。
- 合言葉（受け手の `peerToken`）を先に送っても、親から切り離したプロセスの行は届かなかった。合言葉の仮説は外れ。
- 原因（Claude Code 2.1.288 の実行ファイルのコードで確認、確信度 high）: 受け手の受け入れの判定は accept、hold（利用者の承認まで保留）、refuse の3つ。送り手が受け手の子孫なら accept。受け手が「権限をバイパス」で、送り手が同じモードを名乗らなければ hold（理由 `no-mode-asserted`）。受け手が通常のモードなら accept。この会話は 10-05 から「権限をバイパス」で動いており、Codex の返信は hold になって承認待ちのまま止まった。10-04 に届いたのは、そのとき通常のモードだったためと見ている（モードの記録は未確認）。
- 直し方の候補: 利用者の設定 `crossSessionInbound` を `accept` にする（組織の設定と repo の設定が厳しくしていれば、そちらが勝つ）。seamless が送り手のモードを名乗る形は、安全の仕組みの迂回になりうるので採らない。
- 86b1c1b の「直後に destroy すると捨てる」は誤り（送り手がすぐ終了したことと取り違えた）。半分閉じて閉じ返しを待つ形は、書けたことの確かめとして残す。
- seamless に合言葉を読ませる直しは不要になった（実装していない）。設定を変えるかは立花さんの判断待ち。

## 2026-10-06 受け手が「権限をバイパス」のときの案の検証

- この会話は 09:40 に auto へ変わった。auto（通常のモード）では、名乗りなしの Codex の返信 reply-band-v3-check-3 がそのまま届いた（Codex → Claude の初の実着、09:42 台）。
- 使い捨ての会話（Claude Code 2.1.289、`--permission-mode bypassPermissions`、.local/bypass-probe）へ、親から切り離したプロセスから送った:
  - 名乗りなし: 保留。ターミナルに承認の画面「Held message from another session … The sender did not attest its permission mode, and this session bypasses permission prompts.」と Deny / Deliver の選択、「crossSessionInbound を accept に」の案内が出た。
  - `<cross-session-message from="seamless" from-mode="bypass">` で包む: すぐ届いた（origin に fromMode: bypass）。
  - `from-mode="prompting"`: 単独の試しは、auto モードの自動判定が「安全を弱める」（Security Weaken）として止めたので未実施。コード上は保留（mode-mismatch）。
  - 設定 crossSessionInbound=accept の実地の試しも、同じ理由で未実施。コード上は、利用者の設定があれば受け手のモードによらず accept。
- Codex の会話のモードは rollout の turn_context から読める（01a10630: approval_policy never、sandbox danger-full-access、つまりバイパス相当）。
- Desktop で保留の承認の画面が出るかは未確認（これまで立花さんの画面には出ていない）。
- 受け手（この会話）がバイパス、Codex が「代わりに承認」（rollout の turn_context: approval_policy on-request、sandbox workspace-write、approvals_reviewer auto_review、active_permission_profile :workspace）での実地（09:56）: Claude → Codex は届いて1秒で読み始め。Codex の seamless の send は審査で止まらず `submitted`（reply-band-v3-check-4）。この会話の待ち行列には入らず、保留（名乗りなし、受け手バイパス）。Desktop に承認の画面が出るかは立花さんに確認中。
- Claude Code の分類では、承認を審査役に任せるモード（Claude の auto）は bypass ではなく prompting に入る（auto の受け手は名乗りなしを受け入れた）。なので「代わりに承認」の Codex の本当のモードは prompting に当たる。案 B（本当のモードを名乗る）なら、受け手がバイパスのときは保留のまま（mode-mismatch）、受け手が通常のモードなら届く。
- Desktop（立花さんの確認、10:0x）: 保留されたメッセージの承認の画面は出なかった。ターミナル版では出る。Desktop では保留が見えないまま止まり、送り手には `submitted` しか返らない（案 D は Desktop では使えない）。
- 再試（10:04、この会話は立ち上げ直し後 78848、バイパス。Codex は代わりに承認）: Claude → Codex は1秒で読み始め。Codex は 10:05:27 に reply-band-v3-check-5 を新しい宛先（78848@…）へ submitted。この会話の待ち行列には入らず、保留。前回と同じ結果。
- モードを変えれば保留が流れるかの確認（10:1x、立花さんの依頼）: この会話は auto に戻っていたが、保留された reply-band-v3-check-5 は届かなかった（待ち行列に記録なし）。Desktop のような画面のない受け手では、保留はモードを変える前に期限切れになる、または流れないと見られる。保留の回収は当てにできない。4回目の保留は、会話の立ち上げ直しで消えている。

## 2026-10-07 Codex の考え方の採用（crossSessionInbound=accept）の検証

- 立花さんの判断「Codexの考え方を採用する」（受け手に関門を置かず、届いた後の安全は受け手自身のモードが受け持つ）。設定 `crossSessionInbound` を `accept` にした。私からの配送（wire.sh v7）は auto モードの判定が Security Weaken として止めたので、立花さんが `/config` の「Messages from your other sessions」で入れた。読み取りで `~/.claude/settings.json` の値が accept であることを確かめた。
- auto × 代わりに承認（02:56）: Claude → Codex は1秒で読み始め（この組み合わせは初の実測）。Codex → Claude の reply-inbound-accept-1 が届いた。
- バイパス × 代わりに承認（03:01）: Claude → Codex は1秒で読み始め。Codex → Claude の reply-inbound-accept-2 が届いた（設定前は保留されて消えていた組み合わせ）。
- バイパス × フルアクセス（03:15〜、Codex アプリは 26.1002.51308 に更新済みで、開かれていた会話 01a10594 を使った）: Claude → Codex は1秒で読み始め。Codex は repo の決まり（相手の会話への送信は了承を得てから）で立花さんの許可を待ち、許可の後に reply-inbound-accept-3 を送り、届いた。
- auto × フルアクセス（03:29）: Claude → Codex は1秒で読み始め。Codex は立花さんの許可待ち。
- Codex アプリの更新で再起動すると、以前の会話 01a10630 は持ち主がいなくなった（thread-owner-discovery が no-client-found）。アプリの中身では、窓の窓口の操作は thread-follower-* だけで、開かれていない会話を読み込ませる操作はない。スケジュールはアプリの本体が app-server に thread/resume と turn/start を直接頼んでいる。外から会話を開く正規の入口は codex://threads/<id>。
- auto × フルアクセス（03:29〜）: 立花さんの許可の後、reply-inbound-accept-4 が届いた。これで4つの組み合わせすべてで、Codex → Claude と Claude → Codex の往復を確かめた（crossSessionInbound=accept の後）。
- 送信の承認の扱いの食い違い: Codex は共通の契約の Risk Gates の「外部送信」に当てて、seamless の返信の前に毎回立花さんの許可を待つ。Claude は立花さんの「今後この確認は不要」（2026-10-06）を自分の記憶に持つので待たない。共通の契約に例外を足す編集は、auto モードの判定（Instruction Poisoning）が止めたので元に戻した。立花さんの判断待ち。
- 案 A の試し（2026-10-07 14:15）: Codex アプリの会話 01a114c3（Rappiness、originator は Codex Desktop）は持ち主がいなかった（thread-owner-discovery が成功を返さない）。`open "codex://threads/01a114c3-020e-7ef1-9de7-c983372f5b7c"` で開かせると、2秒後の問い合わせで持ち主ができた。依頼は送っていない。Codex アプリの画面はこの会話に切り替わった。今日の rollout のうち codex_exec（裏の実行）と codex-imagegen の会話は、アプリの一覧に出ない会話で、持ち主も無い。
- 再起動の後に起こして送る（2026-10-07 16:05、f63b67f）: 立花さんが Codex アプリを再起動し、seamless の会話を開かずにおいた。再起動の直後は 01a114be、01a10630、01a10594 の3つとも持ち主がなく、送り先の一覧から消えた（offlineHidden 100）。`sessions` に target `codex:01a114be-…` を付けると、seamless が `open -g codex://threads/…` で会話を開き、online（世代は再起動後の新しい番号 4923ad22）と券が返った。この券で wake-after-restart-20261007-1 を送ると、1秒で読み始め、返信「受け取りました」が届いた。立花さんは会話を手で開いていない。
- open -g でも Codex アプリは前面に出た（前面のアプリが Claude から ChatGPT に変わった）。持ち主ができるまで、開かれていない Rappiness の会話では4秒、再起動の後の 01a114be でも数秒。
- 既知の別件: CLI からの sessions は、名指しの有無にかかわらず毎回25〜26秒かかる（今回の変更の前からの遅さ）。進み具合の追跡（status）は、返信が届いた後も replied を拾わず wait_limit で終わる（変更の前の 05:04 の確認でも同じ）。

## 2026-10-07 status が返信を拾わなかった原因と修正（Claude が送り手のとき）

- 原因: 送り手の Claude が tool 呼び出し（status の待ちや Bash）の中にいる間、届いた返信は記録（transcript の jsonl）に `queue-operation` の `enqueue` 行としてだけ書かれる。封筒つきの `attachment`（`queued_command`、`origin.from`=seamless）は tool 呼び出しが終わった後に、enqueue と同じ時刻を付けて書かれる。前の会話の記録では、05:05:39 の enqueue（510 行目）の次が 05:08:40 の wait_limit の結果（511 行目）で、その次に 05:05:39 の attachment（512 行目）が並ぶ。07:06:24 の返信も同じ並び（1004、1005、1006 行目）。status の replied は attachment の封筒だけを見ていたので、待っている間は立たず wait_limit で終わっていた。
- 修正: `projectClaudeStructure` が enqueue 行の content を封筒として読めたとき、その送り手と replyTo を付ける。`stages` は enqueue 由来の封筒を replied の判定にだけ使う。reached と processing には使わない（enqueue 行には origin が無いので、宛先側の reached は従来どおり payload の hash の完全一致だけ）。replied の根拠は、replyTo が自分の依頼の id であることと、封筒の送り手が依頼の宛先（provider と nativeId）と一致すること。
- 試験: status.test.ts に 1 件追加（enqueue 行だけで replied が立つ、replyTo や送り手が違えば立たない、remove や別の会話の行は無視、attachment が後から来ても根拠は enqueue 行、宛先側の改変した封筒では reached が立たない）。既存の「enqueue は hash の完全一致でだけ reached」の試験は、構造の期待値に封筒の送り手を足した以外そのまま。verify.sh exit 0（typecheck 0、388 件 PASS）。
- 本番（17:08、この会話 13b9af9a、作業ツリーは worktree、Codex 01a114be は名指しの sessions で起こして online）: `send` の 3 秒後に `status --wait 240` を Bash から実行。返信 replied-while-busy-20261007-1-reply は 08:08:58Z に届き、status は `replied observed`（根拠 `queue:2026-10-07T08:08:58.895Z`）で `ok` を返した。待ち上限まで待たずに 17:09:24 に戻った。
- 範囲: Codex が送り手のときの replied 検知は今回見ていない。CLI の sessions が毎回 25〜26 秒かかる件は未着手。
- 効き始め: seamless の MCP は起動時に読んだコードで動く。すでに開いている Claude と Codex の会話の MCP（`send` の `track`、帯の表示）は会話を立ち上げ直すまで前のままで、返信が届いても wait_limit のまま。今回の本番は作業ツリーの `node src/cli.ts` で確かめた。

## 2026-10-07 sessions が毎回 25〜26 秒かかった原因と修正

- 計測（この会話 13b9af9a、same_repository、Codex の会話 101 件、Claude の会話の記録 35 件）: 子プロセスの起動が 1811 回、うち git が 1512 回（累計 29 秒）。1 回の git の観測は 7 コマンドなので、観測が約 216 回。発生源は候補ごとの範囲判定（automatic の policy の inScope）とチケットのブランチ観測で、キャッシュの無い observeGit を候補ごとに呼んでいた。scanSessions の中のキャッシュは scanSessions の外には効いていなかった。
- 残りの時間は Codex の持ち主問い合わせ（thread-owner-discovery）。持ち主がいる会話は 4〜17 ms で返るが、いない会話は Codex アプリが「no-client-found」を返すまで 10 秒かかる（要求の timeoutMs を 50 ms にしても変わらない）。seamless は 1.5 秒で見切るので、1 件あたり 1.5 秒が下限で、16 件ずつの波では 101 件で 7 波 = 10.5 秒。1 本の接続で 120 件を同時に問い合わせても 1.5 秒で、持ち主のいる会話は正しく見つかった。
- 修正（4 点）: (1) automatic の 1 回の呼び出しの間、cwd ごとの git の観測と Desktop の版の観測を 1 回に絞る。送る直前のブランチの再確認だけはキャッシュを使わない（同じ呼び出しの中で発行したチケットが自分を保証しないため。branch-ticket の試験がこれを守る）。(2) scanSessions の持ち主問い合わせを帯と同じ 1 本の接続（createCodexOwnerLookup）に変え、波を 16 件から 128 件にする。(3) Claude の会話の記録（ps と lsof）の確認を並列にする。(4) Codex の会話の範囲判定を並列にする（git の観測は cwd ごとに 1 回のまま）。
- 結果: CLI の sessions が 25.4 秒 → 4.1〜4.2 秒（3 回）。名指し（target 付き）も 4.6 秒。内訳は、持ち主問い合わせ 1.5 秒（下限）、git の観測 16 回で 1.4〜1.7 秒、呼び手の特定（ps と lsof）14 回で 0.75 秒、その他。verify.sh exit 0（388 件）。
- 残している理由: 呼び手の特定の繰り返し（読み取りの直前の再確認）は安全側の確認なので触っていない。持ち主のいない会話の 1.5 秒は Codex アプリの応答の仕様で、縮めるには持ち主の一覧を別の方法で得る必要がある（未調査）。
- 回帰試験: automatic.test.ts に「1 回の sessions で git の観測は cwd ごとに 1 回（Codex の会話 50 件が同じ cwd でも 2 回）」を追加。
- 最終のコードでの本番（17:54）: 名指しの sessions が 4 秒、send は submitted、Bash で待つ間に届いた返信 final-code-check-20261007-1-reply（08:55:36Z）を status が replied で拾い、ok で返った（17:55:58、次の 30 秒の確認で検知）。
- この記録が status-ui の evidence にあるのは、元の「既知の別件」の記述がここにあったため。sessions の走査の仕様書は別（specs/202610-session-discovery）。

## 2026-10-07 sessions の残り 4 秒の調査と修正（4.1 秒 → 2.7〜2.9 秒）

- 内訳（修正前、CLI の 1 回 4.1 秒）: node の起動 0.47 秒、呼び手の特定 0.3 秒、探索 1.5〜2.0 秒（Claude の記録 38 件 0.4 秒、Codex の会話 9083 件の範囲判定 0.5 秒、持ち主問い合わせ 0.5〜1.5 秒）、探索後の範囲判定の繰り返し 0.8〜1.0 秒、受信の照合 0.6 秒、候補の組み立て（依頼の段階の読み取り）0.8 秒。CPU プロファイルでは 4.7 秒のうち 4.1 秒が待ち（子プロセスと IPC）で、JavaScript 側の処理は無視できる。
- Codex アプリに持ち主を一括で聞く方式は無い。ChatGPT.app の app.asar にある thread-* の方式名は thread-owner-discovery と thread-follower-*（開いている会話の操作）と通知（thread-stream-following-changed など）だけ。持ち主のいない会話への返事 no-client-found は 10 秒後で、要求の timeoutMs を 50 ms にしても変わらない。
- 持ち主のいる会話の応答時間: 接続と初期化を含めて中央値 3 ms、最大 36 ms（20 回）。64 件同時の波の中でも 11 ms。
- 修正（4 点）:
  1. 持ち主問い合わせの見切りを 1.5 秒から 0.5 秒（OWNER_LIMIT_MS）に。上の実測の最大 36 ms に対して 14 倍の余裕。副作用: Codex アプリが 0.5 秒以上返事をしない会話は offline と出る（帯の相手ごとの確認も同じ定数）。定数 1 つで戻せる。リンクで開いた直後の持ち主確認（wakeCodexThread の道）は 1 件だけなので 1.5 秒のまま。
  2. 探索後の範囲判定の繰り返しが 0.83 秒かかっていた原因は、git の観測のキャッシュが外れていたこと。Codex の会話の cwd は旧名 claudex（seamless へのシンボリックリンク）で記録されていて、探索はリンクのままの道、範囲判定は実体の道で観測するので別のキーになっていた（6 回外れて 115〜240 ms ずつ直列）。キャッシュのキーを実体の道にそろえた。
  3. 依頼の段階の読み取り（両側）と受信の照合を帯と同じ並列にした（78c78dc で帯だけに入れていたもの。照合の内容は同じで、送り手ごとに 1 回の読み取りに束ねる。試験の proofs の期待を 2 から 1 に直した）。
  4. 試した上で戻したもの: Claude のプロセス照合の ps と lsof の同時実行。lsof 同士が競合して時間が変わらなかった（2.65〜2.92 秒）。
- 結果: CLI の sessions 2.66〜2.92 秒（5 回）、名指し 2.56 秒。verify.sh exit 0（389 件）。
- 残り（下限に近い）: node の起動 0.47 秒、呼び手の特定が 1 回の呼び出しで 6 回（各 0.3 秒、読み取り直前の再確認で意図どおり）、持ち主問い合わせ 0.5 秒、Claude の記録の確認 0.3 秒。これ以上縮めるには、呼び手の再確認を軽い生存確認（pid と開始時刻）に置き換える設計変更が要る（未着手、判断待ち）。

## 2026-10-07 呼び手の再確認を軽い照合にする（2.8 秒 → 1.6 秒）

- 前提の整理: 1 回の sessions で呼び手の特定（identifyCaller）が 6〜7 回走っていた（読み取り直前の再確認）。各回は祖先のプロセスを ps と lsof で 2〜3 段たどり、Claude の記録を照合し、署名の控えを見る（約 0.3 秒）。
- 変更: 同じ 1 回の呼び出しの中では、初回だけフルで特定し、2 回目以降は stillCaller で「同じ pid が同じ開始時刻で生きている（ps 1 回）」と「記録の会話 ID、世代、cwd、ソケットが初回と同じ（記録 1 回）」を確かめる。1 つでも違えばフル特定に戻る。Codex が呼び手のときは持ち主の問い合わせ（IPC）で世代と cwd を照合する。差し替えは identifyCaller の previous オプションで、automatic の 1 回の呼び出しの中だけ前回の結果を渡す。
- 繰り返さないもの（デメリットの正確な一覧）: 祖先の辿り直し、署名（codesign）の確認、プロセスの今の cwd の読み取り（lsof -d cwd）、プロセスがソケットを握っている確認（lsof -U）。軽い照合は記録の cwd とソケットの道を初回の結果と比べるだけで、プロセスの今の状態は見ない。pid と開始時刻が同じプロセスは置き換わらないので、この 4 つが 1 回の呼び出し（約 1.6 秒）の中で変わることは現実には無い。変わっていればフル特定に戻る。帯（band）は毎回の確認で今までどおりフル特定する。
- 試験: caller-scan に 2 件追加。Codex が呼び手のとき（持ち主と cwd が同じなら祖先を辿らず、持ち主が変われば フル特定が走って新しい世代を返す）と、Claude が呼び手のとき（再確認で祖先を辿らず ps は 1 回、記録の会話 ID が変わればフル特定が走って新しい会話を返す、開始時刻が違えば拒否、ソケットと世代と cwd の違いもフル特定に戻る）。verify.sh exit 0（391 件）。Codex が呼び手の道は単体試験だけで、本番は Claude が呼び手の道（この会話から CLI で送信 → 返信の検知）で確認した。
- 結果: CLI の sessions 1.56〜1.69 秒（5 回）。自分のプロセスへの lsof は 14 回から 5 回に。

## 2026-10-07 「起動の 0.47 秒」の正体と修正（最小のコマンド 0.47〜0.78 秒 → 0.25 秒）

- 正体: node 自体は 0.05 秒、cli.ts の読み込みは 0.11 秒。残りは最小のコマンド（limits get）でも走る呼び手のフル特定で、祖先を ps と lsof でたどる（この会話からの CLI は node → zsh → claude の 3 段。ps 4 回、lsof 5 回、lsof は 1 回 55 ms、ps は 23 ms）。
- 修正: (1) 祖先の lsof を「Claude の記録がある段」か「argv[0]（ps の comm）が既知の Codex の実行ファイルの段」だけにする。それ以外の段は ps だけで通り過ぎる。署名に使う実行ファイルの道は従来どおり lsof から取り、argv[0] は候補の絞り込みにしか使わない。飛ばした段があって何も見つからなかったときだけ、全段を lsof で見直す（従来と同じ結果に戻る保険）。(2) Claude の照合の lsof（cwd と unix ソケット）を 1 回の `lsof -p PID -Fnft` にまとめ、実行ファイルも同じ出力から取る。
- Codex の祖先の確認: Codex 側の seamless MCP の親は `~/.codex/plugins/.plugin-appserver/codex-cli/CodexCLI.app/Contents/MacOS/codex`（comm にフルパス）。既知の場所との照合は従来の lsof の道と同じ基準。
- 試験: 模造の lsof を -F 形式（f、t、n の行）に合わせ、帯の試験の lsof の回数の期待を 1 件あたり 2 回から 1 回に直した。verify.sh exit 0（391 件）。
- 結果: limits get 0.25 秒、sessions 1.5〜1.6 秒（持ち主問い合わせ 0.5 秒と Claude の記録 38 件の確認 0.3 秒が主）。本番: 保険の見直しを入れる 1 つ前の版で Codex と往復し、status が replied を検知（19:22〜19:23）。保険は失敗した場合にだけ走る道で、本番の結果は変わらない。

## 2026-10-07 帯 第4版（design-v4）の実装と点検

- 見本 design-v4/mock.html に立花さんの OK（「やっていいよ」）。設計書 design-v4.md。実装はコミット「帯 第4版: 相手を会社ではなく会話として見せ、×n でパネル「チーム」を開く」。担当: Cursor の Gemini 3.8 Flash は route-cli で確認できず（unknown_tool）、リーダー（Claude）が実装し、判定は逆の家系の Codex Astra。Ask Pro の画像生成は使わず（帯は Box/Text/Svg で描く制約が強く、画像は仕様にならない。第3版と同じ HTML の見本の方式）。
- 試験: plugin の試験 85 件 PASS、verify.sh exit 0（391 件）。試験の期待は会社名から会話名へ、数の確認は帯の右からパネルの集計へ移した。
- design-critique（リーダー自身）: 1 行は目的（太字）が先に目に入り、右のチップは名前 › 軌跡 › 今の段の順で読める。名前だけが縮む（flexShrink 1）ので、狭い幅でも軌跡と言葉は残る。×n の意味は初見では分からないが、参考 mod と同じ慣習で、押せば「チーム」と題のあるパネルが開く。
- accessibility-review（リーダー自身、WCAG 2.1 AA の 1.4.11 非テキストのコントラスト 3:1）: 最初の印の丸 #b9b6ae はライトのカード上で 2.03:1 で不足。丸を #8d8b85（tone.idle）に変えて、ライト 3.41:1、ダーク 4.96:1、中の文字 4.96:1 にした。段の点は、橙 5.25 / 3.22、緑 4.18 / 4.04、灰の輪郭 4.96 / 3.41、赤 3.86 / 4.38（ダーク / ライト）で全部 3:1 以上。色だけに頼らず、今の段は言葉（focusWord）と Svg の alt（段の言葉）でも伝える。
- 未確認: Desktop の実画面（チップの Svg の並び、パネルの幅）。実画面は、本線に取り込んだ後に立花さんの会話で確認する。plugin は marketplace「seamless」からの複製（~/.claude/plugins/cache/seamless/seamless-band/0.1.0）で読み込まれているので、取り込み後に plugin の更新が要る。
- 判定 1 回目（Codex Astra、読み取り専用、対象 26e8d8c）: FAIL。中 2 件: (1) 段の軌跡（trackSvg）で、まだの段へ入る線が緑だった（見本は灰色）。線の色を「入る先の段」で決める形に直し、単体試験を足した。(2) 帯の右側の箱が flexShrink 0 で縮まず、長い会話名で 1 行を保てない。右側の箱とチップを縮む設定にし、名前だけが省略される形にした。パネルと ▸ の見出しの会話名も省略つきにした。軽微 1 件: 相手が 0 件だと ×n が出ず、空のパネルを開けない。設計どおり（×n は相手の数）として据え置き。判定役の環境では plugin の試験が EPERM（一時フォルダの作成不可）で走らず、製品の失敗ではない。
- 判定 2 回目（Codex Astra、対象 565373f）: PASS。前回の 2 件は直っていることを確認。重大 0、中 0。軽微 3 件（相手 0 件で ×n が出ない、参考 mod にある縮小表示と完了分の折り畳みが無い、狭い幅の折り返しは実画面未確認）。判定役の確信度 medium（実画面未確認）。敵対（穴探し）は判定役が判定のあとに兼ねた。別の敵対は呼んでいない。
- 次: 本線へ取り込んだ後、plugin の更新と会話の立ち上げ直しをして、立花さんの実画面で確認する（design-v4.md の未確認 2 点）。
