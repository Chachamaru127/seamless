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
