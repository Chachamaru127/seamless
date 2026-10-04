# agmsg と claudex の一次資料比較

調査日: 2026-10-02 JST  
対象: claudex の現在の P1 実装と、agmsg の最新安定版 v1.5.1。  
制限: agmsg はこの Mac でインストールも実通信もしていない。X の投稿は第三者の自己申告で、実装事実の根拠には使わない。

## バージョンの固定

- agmsg 最新安定版は `v1.5.1`。annotated tag object は `141cff0f690686ef2e011c16c0046c33f58a2f2e`、実ソースを指す peeled commit は `4a712f2aeba8f0b2070f7533b827c7cac78c9fdf`。tagger 日時は `2026-09-28T23:17:13Z`。
- 調査時点の `main` は `07a67a3e33040a2cfed5ee90c882f84bb31e8a44`、commit 日時 `2026-10-02T01:25:25Z`。`VERSION` は `1.5.1` のままだが、stable tag より17 commit先であり未リリース差分として分ける。
- ローカル `agmsg` clone は `13815c1f7614a8e6b6689fda42976bce5d127fbc`、2026-06-18 の commitで、調査時の upstream `main` より1213 commit遅れていた。cloneは更新していない。古いcloneを現行版の根拠には使わない。
- 今回の pinned source は[README](https://github.com/fujibee/agmsg/blob/4a712f2aeba8f0b2070f7533b827c7cac78c9fdf/README.md)、[Architecture](https://github.com/fujibee/agmsg/blob/4a712f2aeba8f0b2070f7533b827c7cac78c9fdf/ARCHITECTURE.md)、[Codex Monitor](https://github.com/fujibee/agmsg/blob/4a712f2aeba8f0b2070f7533b827c7cac78c9fdf/docs/codex-monitor-beta.md)、[Teams](https://github.com/fujibee/agmsg/blob/4a712f2aeba8f0b2070f7533b827c7cac78c9fdf/docs/teams.md)。取得した raw source と API 照合結果は `docs/reports/agmsg-comparison-evidence/` に保存した。

## 比較できた現在機能

| 論点 | agmsg v1.5.1 | claudex の現在の P1 | 根拠と確度 |
|---|---|---|---|
| 保存するもの | SQLite の WAL モードに、agmsg 経由で送ったメッセージ、既読状態、チーム状態を保存する。履歴はセッションをまたいで残り、room 履歴を新しい agent に渡せる。既定経路はローカルで外部通信なし。別インストール間の同期を使う場合は自己ホストのremote serverを任意設定する。 | 明示 registry のセッション識別情報とgrantsを読む。会話本文や配送メッセージは保存しない。短命bindingはプロセス内だけ。 | agmsg Architecture の storage shape、README のpersistence/history/remote setup。claudex README §1、`src/mcp.ts`。高。SQLite は耐久性の利点であり減点理由ではない。 |
| Native transcript の読取り | 公開の `inbox` / `history` は agmsg room の記録。元の Claude/Codex 会話全履歴を読む機能とは記載されていない。 | 未実装。MCP が公開する tool は `sessions` のみで、説明にも「no read or send」とある。 | agmsg README usage / history、claudex `src/mcp.ts` の `tools/list` と `tools/call`。高。両方とも現行製品の native transcript read は0扱い。 |
| 送信と起床 | `send.sh` は登録済み agent 間のメッセージを保存する。Claude Code `monitor` は Monitor stream、`turn` は応答間フック。Codex monitorは任意で選ぶbeta modeで、専用手順にapp-server bridgeが記載される一方、READMEのdelivery表とsandbox節およびDESIGNにはmonitorを否定する記述がある。 | 現在の P1 に native send / wake-up はない。通常の `select` は native observer がなく `caller_unobserved` を返しbindingを発行しない。 | agmsg README §§Delivery modes/Codex/sandbox、DESIGN、Codex Monitor pinned docs。Claude Codeについて高、Codex monitorの版・設定をまたぐ一般性は中。 |
| 既存会話の連続性 | Claude Code は起動済み会話で Monitor を稼働させる設計。Codex monitorを選ぶ場合はmonitor起動経路を使い、Codexを再起動して最初のturnを送る必要がある。既に起動中のsessionは再起動まで監視されない。起動経路はshell function、任意PATH shim、`codex-monitor.sh`の直接実行がある。 | registry は native ID と実行世代を持てるが、現在の P1 には製品 native observer がない。Desktop へ常用登録する実装もない。 | agmsg `docs/codex-monitor-beta.md` §§Quick Start / Optional PATH Shim / Known limitations。claudex README §§19–27, 82–84。高。Codex Desktop 既存会話への agmsg 接続はこの文書では確認できず、未確認のままにする。 |
| 宛先と作業場所 | identity は `(agent name, team)`。同じagent名を別プロジェクトから登録すると共通inboxへ届く。Git common directoryで登録済みmain checkoutを解決し、兄弟worktreeからのプロジェクトlookupにも対応する。一方、message deliveryはprojectに関係なくidentityへ届き、worktree、branch、HEAD一致を配送条件にしない。複数roleや `actas` を扱える。 | `current_work`、`same_repository`、`any_registered` を使い、論理workspace、worktree、ローカルGit common directory、branch/HEADを区別する。同じremote URLの別cloneは別repo。古い/曖昧な観測から自動で別宛先へ乗り換えない。 | agmsg `DESIGN` §§Identity Model / Project resolution、`docs/teams.md` §§Identity/second project/actas。claudex README §相手の選び方と `specs/202610-session-discovery/spec.md`。設計とコードは確認済みだが、live native観測は未接続。高。 |
| 許可と送り主 | team と agent の登録を前提とし、`send.sh` の `from` と `to` は位置引数で渡す。送り主名は呼出側が自己申告し、`--force` は送受信先の登録確認を迂回する。接続実体から送り主を認証する仕組みや、操作ごとの双方向grantは公開仕様で確認できない。別端末間のremote syncは任意機能で、reference serverに認証がなく、標準同期は平文。E2EEは別設定。 | caller側outboundとtarget側inboundのoperation grantを両方要求する。registryのmodeは0600。ただしP1のcaller引数は認証ではなく、同じOS userがregistryを書ける前提。 | agmsg README `send.sh`、pinned `docs/remote-setup.md` §§1/3/E2EE、claudex README §§登録/CLIとMCP。`src/mcp.ts`。高。ローカル既定経路とremote opt-inの信頼境界を分ける。 |
| 導入と範囲 | `npx agmsg`、初回にteam/nameを登録し、ホストを再起動する短い導入。Bash + sqlite3が基本依存。Claude Code、Codex、Gemini CLI、Antigravity、Copilot CLI等へ広い対応を掲げ、tmux等のterminal driver、任意のremote syncもある。Codex monitorを選ぶ場合はmonitor起動経路、書込み許可、再起動が必要。 | 現在はNode.js 22.22.xで明示CLIまたはstdio MCPを実行する共通探索部。通常MCP設定の配送やDesktop導入はない。対象はCodex/Claude。 | agmsg README Quick Start / Supported agents / Codex Monitor。claudex README §§試す、CLIとMCP、P2条件。高。使いやすさは agmsg の一般導入経路が現状勝つが、Codex monitorには追加設定がある。 |

## 競合の強みと claudex の違い

agmsg はすでに使えるpeer-to-peerのCLI連絡路を持つ。既定では同じ端末のローカルDBを使い、受け手はMonitorまたはturn-end hookで拾い、対応するagentが複数実装されている。SQLite はメッセージの耐久性と履歴再生を与える。別インストール間の同期は自己ホストserverを任意で足す経路で、既定通信とは分ける。紹介記事の「ローカルのみ」はこの既定経路の説明に限る。remote syncを含めるなら条件付きの説明となる。

claudex P1の実装差は、単なる「MCPで送る」ではなく、登録済みのnative session ID/世代を参照し、両側grantとGit/worktree条件で宛先候補を限定する契約にある。ただし、そのnative live observerとread/send adapterはまだP1に繋がっていない。したがって現行製品スコアに将来のnative接続を加点しない。

v1.5.1のCodex monitorは任意で選ぶbeta modeである。専用手順はapp-server bridgeの有効化を説明し、shell functionと任意PATH shimに加えて`codex-monitor.sh`の直接起動も案内する。一方、READMEのdelivery表とsandbox節、DESIGNのProject resolution節はCodex monitorを否定する。従ってbeta手順の存在は確認できるが、対応する全環境での一般動作までは確認できない。

claudexの計画外である方式検証について、repoの記録はCLIとDesktopの会話read/sendを成功とする。これは検証記録上の強みであり、現在のP1製品が同じ機能を公開している証拠ではない。採用判断では「方式検証」と「配布可能な機能」を分けて評価する。

## スコアリング案

0–5点は品質や速さではなく、実現段階を示す。0は計画のみ、または現行資料で未搭載と確認できた機能。1は制限付きの手動実現、2は分離された中核部分の試験済み、3は公開コードと使い方の記載、4は現在のMac製品でend-to-end実証、5は反復した運用実証とする。未確認は `NA` とし、0点に置き換えない。

現在使える製品と、分離試験で到達した技術段階は別々に記録する。claudexのDesktop通信実証は `specs/202610-session-interop/evidence.md` に残るが、専用fixtureと一回限りの接続部による試験である。P1製品にはread/sendやDesktop導入がないため、分離試験の点数を製品点に加算しない。

| 利用軸 | 重み | agmsg v1.5.1 | claudex P1製品 | 分離試験のclaudex | 採点の境界 |
|---|---:|---:|---:|---:|---|
| Native既存会話の履歴読取り | 20% | 0 | 0 | 1 | agmsgの `history.sh` はteam/agentごとのmessage history。claudexは既存CLI/Desktopの可視履歴を専用接続で読んだ記録があるが、制限付き手動実験で、製品APIには未接続。 |
| 送信、返信、起床 | 15% | 3 | 0 | 1 | agmsgは公開コードと使い方を持つ。Codex monitorを選ぶ場合は再起動し、shell function、任意PATH shim、または`codex-monitor.sh`で起動する。turn modeは次の対話まで待つ。claudexはプロトタイプの往復実証まで。 |
| 既存Desktop会話への接続 | 15% | NA | 0 | 1 | agmsg v1.5.1はCLI経路を文書化し、Desktop接続は未確認なのでNA。claudexは専用fixtureによる手動実証だけで、P1製品には未搭載。 |
| 登録、発見、選択 | 12% | 3 | 2 | 2 | agmsgのteam/name joinと名簿は公開・説明済み。claudexのregistry、候補順位、bindingは実装済みだが通常のnative observerがない。 |
| Grantとscope境界 | 12% | 3 | 2 | 2 | agmsgのteam membershipと登録済み宛先確認はあるが、送り主名は自己申告で`--force`による登録確認の迂回もできる。operationごとの双方向grantはない。claudexはread/send別grantとscopeを実装するがcaller引数自体は認証ではない。 |
| Repo/worktree制御 | 10% | 0 | 2 | 2 | agmsgにはGit/worktree/branch/HEADによる選択機能が公開コードで確認できない。claudexは実Git fixtureで区別するがnative observer未接続。 |
| 耐久履歴と配達記録 | 8% | 3 | 0 | 1 | agmsgはroom記録の保存と再生を説明する。一方で対話処理完了や返信対応は記録しない。claudex P1は通信記録を持たず、selection bindingは同一processで60秒のみ。 |
| 対応経路と導入範囲 | 8% | 3 | 1 | 1 | agmsgは複数CLI/terminalの公開統合とnpx導入。Codex monitorは選択時にmonitor起動経路と再起動が必要。claudexは2製品向けの手動CLI/MCP段階。 |

Desktop接続のagmsg対応だけをNAとして除外する。残る7軸の重みは85点、正規化の分母は5 × 85 = 425。加重到達段階の参考値は、agmsgが165 ÷ 425 × 100 = 38.8、claudexが111 ÷ 425 × 100 = 26.1となる。claudexの参考値は履歴読取りと送信の分離試験を含み、他の対象軸はP1製品の値を使う。したがって現行P1製品の点数ではない。どちらも品質や総合優劣ではなく、調査範囲内の実現段階を表す。

## X の観測

Grok Build CLI `grok-4.7 / medium` が `x_keyword_search`、`x_semantic_search`、`x_thread_fetch` でX固有検索を実行。終了コード0。結果は `agmsg-comparison-evidence/grok-x-research-output.txt`。X投稿は補助的な自己申告として扱い、公式機能表の点数には反映しない。

利用例として、複数CLIの相互レビュー、SSH/tmuxやworktree間の運用、3 agentの創作利用などの本人投稿が見つかった。制限の投稿には、2026-09のWindowsパス/pid問題や2026-08のWindows同期遅延があるが、どちらもv1.5.1より前の投稿である。作者投稿では、monitor維持、複数プロセス、Windows同期の不具合修正を告知している。これは問題が継続中という証拠ではなく、実装の保守負荷が実際にあった例である。

投稿日時とURLはGrokの検索結果から取得した。各URLを別ブラウザで再確認してはいないため、個別投稿の内容と日付は中程度の確信度。検索は全期間の全投稿を網羅せず、最大10件/検索が観測上限だった。上限の理由や利用枠は不明であり、推測しない。

## 使えなかった/未確認の項目

- agmsgをMac上で実際に使う動作確認は行っていない。コードと公式README上の動作である。
- agmsgからCodex Desktopの既存会話へ接続できるかは、v1.5.1の公式ソースから確認できない。Codex TUIのmonitor起動経路による接続をDesktop実会話の接続証明にしない。比較ではこの軸だけNA。
- agmsg公開READMEは対象をCLI agentと記載し、`history.sh`をteam roomのメッセージ履歴として案内する。native transcriptを読み出すAPIや操作は文書化していない。この範囲でnative history readは未対応として0点。全実装コードの不存在までは主張しない。
- claudexのP1 native observer、read/send adapter、Desktop常用導入は現在の製品ソースで未接続。方式検証の成功記録から製品搭載へ読み替えない。
- Grok X調査は呼出し成功。投稿は自己申告の二次証拠であり、全利用者の傾向や不具合頻度は推定できない。
- 独立Claude Opus調査は `route-cli --check cc_headless:claude-opus-5-5` がavailableの後、`claude-headless`で読み取り専用、WebSearch/WebFetch、Read/Glob/Grepを指定して実行。CLI実終了コード0。報告はmain HEADを一次資料にしたため、stable v1.5.1確認では差分を別途照合した。初回の誤った `claude` 呼出しは回答前に終了コード130で中断し、結果を採用していない。

## 根拠ファイル

- agmsgのtag/commit/compareとraw primary source: `docs/reports/agmsg-comparison-evidence/`。Opus 5.5 / high の独立調査結果とX検索結果も同ディレクトリにある。
- claudex現在仕様: `README.md`、`specs/202610-session-discovery/spec.md`、`src/mcp.ts`、`src/discovery.ts`、`src/git-context.ts`
- claudex会話互換の方式検証と製品境界: `specs/202610-session-interop/Plans.md`、`spec.md`

確信度: agmsgとclaudexの文書・公開コードが示す機能範囲は高。Codex monitorの公開文書内整合性は中。実Macにおけるagmsg動作とDesktop会話対応は未検証。
