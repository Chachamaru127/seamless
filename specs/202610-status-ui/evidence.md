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
