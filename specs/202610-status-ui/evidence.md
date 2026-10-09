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
- 見立て（確信度 medium）: 会話の横の画面の入口は「プラグイン」として導入されたものから選ぶ作りで、config.toml に MCP サーバーとして直接登録した seamless は候補に入らない。また、この会話はメッセージを送っていないので、seamless の MCP が新しいコードで起動し直したかも分からない。
- 次の手: seamless の右パネルを、手元のプラグイン（`.codex-plugin/plugin.json` と `.mcp.json`）として包み、手元の marketplace から導入して確かめる。Codex の設定を変える操作なので、立花さんの承認が要る（Plans の C 段に追記）。

## 2026-10-05 C1b の準備（導入の直前まで）

- seamless の MCP に、右パネルの道具と資源だけを出す起動の形 `node src/cli.ts mcp --panel-only` を足した（Codex に seamless の4道具が二重に並ばないため）。試験を足し、本体 351、帯 52 試験 PASS、verify.sh 終了 0。
- Codex 用のプラグインを `codex-plugin/` に作った。手元の marketplace `seamless-local`（`.claude-plugin/marketplace.json`）と、プラグイン `seamless-status`（`.codex-plugin/plugin.json`、`.mcp.json` は `mcp --panel-only` を絶対パスで起動）。
- 設定を書かない確認: `codex -c 'marketplaces.seamless-local.source_type="local"' -c 'marketplaces.seamless-local.source="<repo>/codex-plugin"' plugin list` で `seamless-status@seamless-local  not installed` と出た。`~/.codex/config.toml` の更新時刻は変わっていない（00:20 のまま）。
- 起動の確認: `mcp --panel-only` に initialize、tools/list、resources/list を送り、道具は status_panel だけ、資源は ui://seamless/status だけが返った。
- 残り（承認待ち）: 導入。CJ-Plugin の wire.sh には Codex のプラグインを配る経路がまだ無い。
- 判定（Codex Astra、別家系）PASS（重大、中なし。b5f3352）。軽: .mcp.json の絶対パスはこの Mac の配置に依存し、導入後もリポジトリの最新のコードを動かす（手元の利用には合う。移設や版の固定には直しが要る）。

## 2026-10-05 夜間（立花さん「6h ねる間に進めて。Claude のアプリ版UIは朝にはできていること」）

- 帯の問い合わせが重かった: `sessions`（scope any）1回 15 秒、current_work 65 秒。帯を全セッションで30秒ごとに走らせると重すぎる。
- 第18便: 軽い照会 `band` を足した（全体の走査をせず、自分の依頼の宛先と受信の送り主だけを見る。seen.json を書かない）。帯は Desktop で描かれてから問い合わせを始め、60 秒ごと。ターミナルと claude -p では描かず問い合わせない（5794f64）。
- 第19便: Claude の相手を探すとき会話 ID が合う pid だけを完全照合、相手ごとの処理を並列、Codex の owner の探索の接続を1回の呼出しの中で使い回し（78c78dc）。
- 記録の取り方: `node --import` の前処理で子プロセスと接続の時間を記録。Claude の実行ファイル（225MB）の `codesign --verify --strict` が1回約5秒で2回（OpenAI のチームを先に試して空振り）。
- 第20便: 期待するチームだけで検証し、通った結果を `~/.seamless/signature-cache.json`（0600。realpath と dev、ino、size、mtimeMs、ctimeMs と24時間で照合）で再利用（728dd8a）。
- 判定（Claude Opus、第18〜20便）PASS、「有効にしてよい」。中-1（時計が全セッションで動く）は有効にする前に直した（113f236。時計も Desktop で描かれた後だけ）。中-2（署名の結果を保存すると ~/.seamless が信頼の入口に加わる。同じ利用者は他の経路でも同じことができるので受け入れを推奨）と中-3（壊れたキャッシュは作り直さない）は立花さんの判断と次便。
- Mac の負荷: 夜の間 load average 260〜440（Chrome、Claude、Codex の描画プロセスが各 CPU 約95%）。子プロセスを使う試験と帯の試験が回ごとに数件「timed out after 5000 ms」になった（assert の失敗は無い）。実機の band の時間はこの負荷では測れなかった（呼ぶ側の特定の lsof も5秒を超えて止まった）。
- 導入: CJ-Plugin #20（cj-plugin の marketplace 経由、v5）は Claude が「Path escapes plugin directory」で読み込まなかった。seamless 自体を手元の marketplace にした（a7e6cc9）。CJ-Plugin #21（v6）で `extraKnownMarketplaces.seamless` と `enabledPlugins.seamless-band@seamless` を配送（wire.sh plan → apply → check、in_sync）。`claude plugin marketplace add` と `claude plugin install seamless-band@seamless --scope user` で導入。`claude plugin list` で enabled、seamless のリポジトリから直接読む。
- ターミナルの Claude（2.1.289）の記録で「hooks module seamless-band@seamless loaded」「plugin.register: admitted」。ターミナルでは band の問い合わせは0件。
- 残り（外部条件）: Desktop アプリ（2.19675.0）の同梱 Claude Code は 2.1.286 で、mod の条件（2.1.287 以上）に届かない。Desktop アプリが新しい版を入れて再起動すれば、Code タブに帯が出る。記録（~/Library/Logs/Claude/main*.log の「[CCD] Initialized with version」）では Desktop の更新ごとに上がっている（9/25 の 2.1.281 から 10/3 の 2.1.286）。Desktop には開発用の差し替え `CLAUDE_CODE_LOCAL_BINARY`（アプリの起動時の環境変数）もあるが、アプリの再起動が要り、動いている会話を止めるので使っていない。
- 気づいたこと: ターミナルの `claude -p` が「OAuth session expired and could not be refreshed」で止まる（10/5 10時ごろ）。Claude CLI のログインのやり直しが要る。

## 2026-10-05 10時台: Desktop の更新では帯は出ない（実測）

- Desktop アプリの配信の情報（https://downloads.claude.ai/releases/darwin/universal/RELEASES.json）: `currentRelease` は 2.19675.0（2026-10-01 公開）で、入っている版と同じ。アプリを更新しても Claude Code は 2.1.286 のまま。
- Claude Code の配信（https://downloads.claude.ai/claude-code-releases/）: `latest` は 2.1.289、`stable` は 2.1.285。
- Desktop の中には Claude Code だけを自動で更新する仕組み（autoUpdateCandidates、download wait、auto-update-state.json）があるが、`~/Library/Application Support/Claude/claude-code/` に状態のファイルは無く、記録（main*.log）にも自動更新の行は無い。この Mac では働いていない（条件は未確認）。
- 帯を Code タブに出す手段は、(1) 2.1.287 以上を同梱した Desktop の配信を待つ、(2) 開発用の差し替え `CLAUDE_CODE_LOCAL_BINARY`（Desktop の起動時の環境変数。例 `launchctl setenv CLAUDE_CODE_LOCAL_BINARY ~/.local/share/claude/versions/2.1.289` の後に Desktop を終了して開き直す。戻すのは `launchctl unsetenv CLAUDE_CODE_LOCAL_BINARY` と再起動）の2つ。(2) は Desktop の記録に「LOCAL OVERRIDE」と出る開発用の経路で、Desktop の再起動で動いている会話がいったん止まる。立花さんの判断。

## 2026-10-05 11時台: 開発用の差し替えは配布版では効かない（実測）

- 立花さんが `launchctl setenv CLAUDE_CODE_LOCAL_BINARY ~/.local/share/claude/versions/2.1.289` を実行し、Claude アプリを開き直した（11:30:55）。記録は「[CCD] Initialized with version 2.1.286」で、「LOCAL OVERRIDE」の行は出ず、この会話も claude-code/2.1.286 で動いた。
- app.asar の該当箇所は、初期化の最後に `process.env.CLAUDE_CODE_LOCAL_BINARY` を式として読むだけで、`initLocalBinary` を呼ぶ処理が配布版には残っていない（開発版だけの経路と見られる）。リーダーは前日、この続きを読まずに方法 B を勧めた（誤り）。
- 結論: Code タブに帯を出す手段は、Claude Code 2.1.287 以上を同梱した Desktop の配信を待つことだけ。環境変数は効果がないので `launchctl unsetenv CLAUDE_CODE_LOCAL_BINARY` で消してよい。

## 2026-10-05 12時台: Code タブに帯は出ていた（訂正）

- 立花さんの画面の撮影（12時台、この会話）: Code タブの入力欄のすぐ上に、暗い箱で「道具を使っている · Watch for 70 seconds whether the band query process runs · 23秒」と出ていた。帯の左半分（今していることと経過時間）は動いている。右半分（ロゴと回数）は出ていない。照会 `node src/cli.ts band` をこの会話から直接走らせると 2.0 秒で status ok、相手3つ、各 requests 0、inbound 0 だった。やりとりが0の会社は出さない仕様（AC3）なので、右半分が空なのは仕様どおり。
- 帯の問い合わせも動いている: この会話の Claude Code（pid 81054、claude-code/2.1.286）の子として `/Users/tachibanashuuta/.local/share/mise/installs/node/24/bin/node .../seamless/src/cli.ts band`（帯の既定の node と同じ絶対パス）を観測した。Desktop で描かれた後だけ問い合わせを始める作りなので、`e.surface` が desktop で描かれたことの裏付けにもなる。
- 原因の取り違え: 「mod は Claude Code 2.1.287 以上」（公式文書 plugins/mods overview）を、Desktop の中の 2.1.286 では mod が読み込まれないと読んだのは誤り。実測では 2.1.286 でも mod は読み込まれる。
  - アプリの中の `claude-code/2.1.286/.../claude plugin test`（mod の無い場所）は `no hooks module to load`（文書の表で「読み込める」状態）。
  - 同じ 2.1.286 で `plugin test mods/seamless-band` は 54 件 PASS、`plugin validate` も成功。
  - 同じ 2.1.286 の `claude -p --debug` の記録に `hooks module seamless-band@seamless loaded (worker, environment 2, tier user)`。
  - Desktop の記録（main.log 11:30:57）は「6 ~/.claude plugin(s) left to the CLI's own loader」。seamless-band は Desktop が渡すのではなく、中の Claude Code が ~/.claude の設定から自分で読む。
  - 2.1.287 は「mod が既定で有効になった版」（troubleshoot の「Your version predates mods being on by default」）。2.1.286 は早期利用の版で、この Mac では有効だった（理由は未確認。早期利用の切替 CLAUDE_CODE_ENABLE_FUNCTION_HOOKS の既定値か、サーバー側の設定と見られる）。
- リーダーは 10/4 から 10/5 午前まで、Code タブの画面を確かめずに「出ない」と報告していた。以後、表示の有無は実画面で確かめてから書く。
- U7（実地）は進められる。残る確認: 右半分の色と回数（相手に依頼を送った後）、開いた状態。見た目の直し（U9）の材料: 閉じた状態の前に「•」の行頭の記号が残る、箱の上下の余白が大きい。

## 2026-10-05 13時台: 第2版（立花さん「通知、進捗、目的から表示するべき情報を徹底的に洗練」、/team-design）

- 実画面の確認用の行（G〜J、写しだけに入れた）の撮影: テーマの色の名前はライトで描き分けられる（text #0e0e0e、inactive #484745、subtle #7e7c76、success #0c5712、warning #673c0f、error #822124、claude #bd553b）。地を塗らず外枠だけの枠はアプリになじむ。Svg の線と明滅は描ける。主ボタンは黒い小さな四角。
- 見本: リーダーの再現 HTML（out/design-v2/index.html、merged.html）と Ask Pro（ChatGPT 6 Pro、https://chatgpt.com/c/6ac324cb-f774-8320-ad7b-686ea991a5fc、記録 out/ask-pro/20261005-band-v2/）。統合案は Ask Pro の「目的を太字」と2列の開いた状態を取り、色付きの札の地と「確認」ボタン（帯は表示だけ、AC6）は取らなかった。
- 立花さんの指示（13時台）で右上を `↑n(未確認) ↓n(未読)` と `!` に作り替えた。
- リーダーは自分で画面を撮れない（computer-use が Claude アプリ自身の画面を拒否する）。品質の確認は、再現 HTML を内部ブラウザで撮って点検し、本物は立花さんの撮影で点検する（立花さん「自分でスクショとって品質チェックした？」への対応）。
- 実画面の撮影（第2版の初回）で分かったこと: alt が空の Svg は描かれない（印が消えた）。見出しが行の束の中ほどに浮く。「0秒」が雑音。→ alt を付け、上揃え、1秒未満は出さない。
- 判定（Codex gpt-6-astra、読み取り専用、別家系）: 1回目 FAIL（印の区別、計画の時間、計画の持ち越し、表示窓、n/m の不一致）→ 2回目 FAIL（表示窓が作業中を外す、未着手からの再開の時計）→ 3回目 FAIL（TodoWrite の不成功でも計画が変わる）→ 4回目 PASS（軽1件: 不成功の試験が拒否だけ → 拒否、失敗、中断の3つを試験に足した）。
- 試験: `bash scripts/verify.sh` 実終了コード 0（本体 379、帯 66）。並列の開始順に頼っていた本体の試験 tests/band-performance.test.ts を、並べ替えて比べる形に直した（混んだときに順番が入れ替わって落ちた）。Codex パネルの写し src/status-exchanges.ts に talliesOf を同じ形で足した（同一性の試験）。
- calls は前と同じ（ui、clock、state、agent.list、process.run）。
- 残り: ダークの実画面の撮影と、閉じた帯と開いた帯の最終の撮影。やりとりがある状態（↑1(1) など）の実画面は、確認の依頼を1件送る了承が要る。
- 実画面（ライト、64f2c45 を読み込んだ後、立花さんの撮影）: 閉じた帯が1行に収まる。▸ の右に緑の丸の ✓（alt 付きの Svg が描かれた）。開くと「手順」の見出しが先頭の行に揃い、各行に細い ✓、1秒未満の所要時間は出ない（3秒、4秒、11秒だけ）。地は塗られず、アプリのカードになじむ。目的は「前回の作業」（読み込み後に指示が無いため。次の指示から最初の文が出る）。ダークは未撮影。
- 実画面（ダーク、立花さんの撮影、Codex への疎通確認の最中）: 太字の目的は白、段と今の一手は灰、紫の点と赤の × は読める。右上に `↑1 (1)`（送って未確認）。開くと「やりとり」に Codex の行と「届いた · 未読」。見つかった問題: ロゴが灰色の線で暗い地に溶けた（立花さん「右上の codex と Claude のロゴがない」）、状態の文言が2行に折れた、目的が18字で切れた、今の一手が「seamless を使う: send」で分かりにくい。→ ロゴを会社の色の角丸の地に白の印のタイル（Codex #10a37f、Claude #d97757、14px）にし、ライトとダークの両方で見えることを再現 HTML（out/design-v2/tiles.html）で撮って確かめた。状態の文言は折り返さない、目的は28字、seamless の道具は「相手の会話に送る」などの言葉にした。verify.sh 終了 0（本体 379、帯 66）。
- 疎通確認（立花さん「codex と意思疎通できるかチェックして」）: Claude → Codex の依頼 band-check-1 は 04:46:41 に受付、04:46:42 に到達と処理開始を観測。Codex は自分の会話に「受信OK」と書いたが、seamless の send で返さなかったので、Claude 側の受信は 0 件（replied は未観測）。Codex → Claude の向きは未確認。
- 実画面（ダーク、966e4cf を読み込んだ後、立花さんの撮影）: 閉じた帯が1行。緑の丸の ✓、太字の目的「codexと意思疎通できるかチェックして」（28字の上限で全文）、「7分17秒で完了、19手順」。右上に緑の Codex のタイルと `↑1`（Codex が読み終えたので括弧が消えた）。開くと 目的、手順（細い ✓）、やりとり（Codex · seamless、緑の「既読」、1行）。白、灰、緑はどれもダークで読める。手順の「seamless を使う: send」は言い方を直す前に記録された行。
- 結論: 第2版の見た目と使い勝手は、ライトとダークの両方の実画面で確かめた（U7、U9、U11 完了）。残りは Codex → Claude の向きの疎通（立花さんの判断待ち）。

## 2026-10-06 第3版の実画面と Codex → Claude の疎通

- 実画面（ライト、立花さんの撮影）: 閉じた1行は「送るし今後この確認は不要 › 調べている 15秒」から「› 書いている 25秒」へ変わり、今の一手は出ない。開いた状態は目的と手順（印つき、失敗は赤の ✗）。やりとりはこの会話に無いので右側は空。
- Codex → Claude: `codex exec` から seamless の send を試したが `caller_unobserved`（`native_identity_unobserved`）で送れなかった。seamless は Codex アプリが持つ会話でないと送り主を確かめない作り（src/caller.ts の codexIdentity が持ち主を探す）。`codex exec` の会話は持ち主がいないので、何度試しても同じになる。
- seamless のフォルダの Codex の会話は、この時点で全件 unreachable（アプリで開かれていない）。Codex アプリを裏で操作して新しい会話を開こうとしたが、裏ではアプリが画面を描かず、画面の操作の許可は時間切れだった。

## 2026-10-06 Codex → Claude が届かなかった原因（調査中）

- 現象: 10-05 04:47 以降、Codex から Claude への send は seamless の記録では `submitted` なのに、Claude の会話の待ち行列（`queue-operation enqueue`）に入らなかった（3回）。10-04 16:34 には届いていた。
- 切り分け（この会話の窓口 /tmp/cc-socks/9810.sock へ試しの1行、Claude Code 2.1.288）:

| 送り手 | 送った後 | 届いたか |
|---|---|---|
| この Claude の子孫、すぐ終了 | 直後に destroy | 届かない |
| この Claude の子孫、すぐ終了 | end で半分閉じる | 届かない |
| この Claude の子孫、数秒生きる | 直後に destroy | 届く |
| この Claude の子孫、数秒生きる | end で半分閉じる | 届く（中身が封筒の形でも届く） |
| 親から切り離したプロセス（ppid=1）、数秒生きる | end で半分閉じる | 届かない（Claude Code は受け取って閉じ返すが、待ち行列に入れない） |

- 合言葉（受け手の `peerToken`）を先に送っても、親から切り離したプロセスの行は届かなかった。合言葉の仮説は外れ。
- 原因（Claude Code 2.1.288 の実行ファイルのコードで確認、確信度 high）: 受け手の受け入れの判定は accept、hold（利用者の承認まで保留）、refuse の3つ。送り手が受け手の子孫なら accept。受け手が「権限をバイパス」で、送り手が同じモードを名乗らなければ hold（理由 `no-mode-asserted`）。受け手が通常のモードなら accept。この会話は 10-05 から「権限をバイパス」で動いており、Codex の返信は hold になって承認待ちのまま止まった。10-04 に届いたのは、そのとき通常のモードだったためと見ている（モードの記録は未確認）。
- 直し方の候補: 利用者の設定 `crossSessionInbound` を `accept` にする（組織の設定と repo の設定が厳しくしていれば、そちらが勝つ）。seamless が送り手のモードを名乗る形は、安全の仕組みの迂回になりうるので採らない。
- 86b1c1b の「直後に destroy すると捨てる」は誤り（送り手がすぐ終了したことと取り違えた）。半分閉じて閉じ返しを待つ形は、書けたことの確かめとして残す。
- seamless に合言葉を読ませる直しは不要になった（実装していない）。設定を変えるかは立花さんの判断待ち。
- （2026-10-09 復元）この節と、上の 7 つの節（C1 の観察の見立てと次の手、C1b の準備、夜間、10〜13 時台の 4 節、第3版の実画面）は、0b12976 の編集の範囲の取り違えで消えていた。親 7e9c2be の版から本文をそのまま戻した。この節の「見立て」と「未着手」の 2 行だけは、0b12976 が本来置き換えるつもりだった行なので戻していない。

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
