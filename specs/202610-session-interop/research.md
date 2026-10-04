> 2026-10-01更新: 現行の判断はPlans.md。以前のagmsg採用推奨、SQLite中心案、Channels優先案は最新依頼で取り下げた。以下の旧調査結果は履歴として保持する。

# セッション間通信の調査

Status: RESEARCH FINDINGS RECOVERED（動作実証は未実施）
Observed: 2026-10-01 JST
Local/source investigation: read-only。通信対象への試験送信、アプリ設定変更、既存会話本文と秘密値の読取りは未実施。
Ask Proへの公開情報による調査と敵対検査の依頼は、同skillの事前承認範囲で送信した。

## 判断

共通のメッセージ管理に、製品と実行主体ごとの接続部を付ける案が成立候補である。
通信の受理と返答の完了を別に扱う必要がある。
MCPを登録しただけでは、停止中の会話を起こせない。
現在の公式仕様には、Claude Channelsという外部イベントを既存会話へ押し込む入口がある。
Codex CLIには、既存会話へ送るqueueと、既存app-serverへのremote接続がある。
両入口がこのMacの対象会話で実際に動くかは、まだ試験していない。

## 実測した版

| 対象 | 版 | 根拠 |
|---|---|---|
| Codex CLI | 0.159.3 | `codex --version` |
| Codex Desktop | 26.928.31416 / build 12553 | `/Applications/ChatGPT.app/Contents/Info.plist`。bundle ID `com.openai.codex` |
| Desktop同梱Codex CLI | 0.159.2 | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/codex-package.json:3` |
| Codex app-tools plugin | 0.1.5 | ローカルplugin.json |
| Claude向けCodex plugin | 1.0.6 | ローカルplugin.json |
| Claude Code CLI | 2.1.286 | `claude --version` |
| Claude Desktop | 2.16120.0 | `/Applications/Claude.app/Contents/Info.plist` |

公開Codexの固定版は、tag `rust-v0.159.3`、実コミット `01fc69f4026735edfdf6789820549727a4867b11`。
`8e46774a94a745ffdf676bd7a8aa36466bbd4f99`は注釈付きタグのオブジェクトであり、実コミットではない。
`git ls-remote https://github.com/openai/codex.git 'refs/tags/rust-v0.159.3*'`で両者を照合した。

## 通信を7種類に分ける

| 種類 | 宛先 | 届け方 | 返信と待機時の扱い |
|---|---|---|---|
| Codex Desktopの通常会話 | hostId + threadId | app-toolsからアプリの会話管理へ渡す | 受理と完了は別。read_thread / wait_threadsで観測 |
| Codexのnative子エージェント | agent ID / task path | runtimeのmailbox | send_messageは待機中の新規処理を開始しない。followup_taskは非rootを開始できる |
| Codex app-server / CLI | 接続先runtime + threadId | thread/resume、turn/start、turn/steer、CLI queue | steerはactive turn IDを照合。完了はturn/completed |
| Claude Codeの通常会話 | 表示名 + 必要時ref / uds住所 | セッションごとのUnixソケット | 処理中は呼出し境界で読む。idleなら新規turn。返信は別のSendMessage |
| Claude agent teams | team + agent name | 検証されるJSON mailbox | 書込み成功と回答は別。チーム内の構造化制御を外部へ流用しない |
| Claude DesktopのCode会話 | local_…のsession ID | ccd_session_mgmt / SendMessageからアプリ管理へ | deliveredは開始、queuedは現在作業の後。無人、開始中、archived等は制限 |
| Claude Channels | 起動時に選択したMCP接続 | notifications/claude/channelをstdioでpush | 開いている同じ会話へ通知。返信toolを別に用意。通知書込みだけでは配信確認にならない |

## Codex側のローカル実装

app-toolsは独立の会話管理を持たず、アプリホストへ転送する。
経路はstdio MCP → Unix socket → ホストのtools/call → 会話管理である。
ソケットの形式は4 byte little-endian長さ + JSON-RPC。
app-serverのJSONL形式とは異なる。

`server.mjs`の24849〜24925行で、executor由来の呼出し元thread/turnを取り、宛先argumentsとは別に渡す。
呼出し元メタデータがなければ拒否する。
ソケット入口は`CODEX_APP_TOOLS_PIPE_PATH`。
この値の読取り、表示、再利用による外部接続はしていない。

根拠ファイル:
`/Users/tachibanashuuta/.codex/plugins/cache/openai-bundled/codex-app-tools/0.1.5/server.mjs:24849`、`:24861`、`:24903`、`:25015`、`:25150`。

DesktopのASAR内の処理は、`webview/assets/app-initial-8a7b00193cb6.js:4595`の`jQs → kQs → sendFollowUpMessage`。
同`:4595`、offset 9438815でnative子から祖先へ通常会話送信する経路を拒否する。
`/.vite/build/bootstrap-B7ariqxX.js:693`、offset 1012682の`Sle`は、アプリ管理経由でresumeし、turn coordinatorへ渡す。
同`:693`、offset 1054433の`sue`は、通常textならsteer、toolOutputならinputを空にしたturn/startを使う。
これらは`/Applications/ChatGPT.app/Contents/Resources/app.asar`をメモリ内で読んだ位置である。
ASAR内のパスは普通のファイルとして存在しない。行は内部本文の1-based行。

Claude向けCodex pluginは、標準では別app-serverを起動する。
`scripts/lib/app-server.mjs:190`と`scripts/app-server-broker.mjs:68`が根拠。
brokerの`:170`はstreamを単一接続に寄せ、別接続はbusyを返す。
このpluginの成功を、Desktop既存会話への接続証明にしない。

Desktopの起動設定も独立に調査した。
通常local経路はapp-serverをstdioの子プロセスとして起動し、`--listen`を指定しない。
既存daemonを共用する分岐はあるが、config overridesが空であることなどの条件がある。
主factoryはplugin設定のoverrideを常に追加するため、このfactoryを通るlocal接続はその条件を満たさない。
明示WebSocket接続は、Desktopが指定されたendpointへ接続する処理である。
Desktop自身が外部client向け入口を発行する証拠にはしない。
現会話が実際に使うtransportは未確認。

ASAR内根拠は`.vite/build/application-network-startup-D74LEWDz.js:32`、
文字offset 252484、254950、258779〜260174、264661。
主factoryは`.vite/build/main-BbeJ4AAR.js:1271`、offset 3251000。
常にoverrideを返す`Hpe`は同`:565`、offset 918209。
この静的調査はsocket接続、daemon起動、秘密値の読取りを含まない。

CLI `codex queue --help`には`--thread`（UUIDまたは正確な会話名）、`--message`、`--remote unix://PATH`がある。
`codex agents --help`はshared local app-server daemonの会話を対象にする。
queueは`thread/queue/add`へ`UserInput::Text`と`clientUserMessageId`を渡す。
peerの作者やtoolOutputは渡さない。
loadedでidleの会話は次の処理を開始できる。runningなら永続キューへ入り、通常は次のidleで開始する。
Interruptedはenqueueで起きず、unloadedは保存だけでresumeしない。
archived、ephemeral、MAv2の子への直接入力は拒否される。
返るqueue IDは受理の識別子であり、返答の完了ではない。

固定版根拠は`codex-rs/tui/src/session_queue_commands.rs:27-81,111-124`、
`codex-rs/ext/queue/src/service.rs:265-279,472-481,549-565`、
`codex-rs/app-server/src/request_processors/thread_queue_processor.rs:292-308`。
公開版では`codex agents`の通常起動がdaemonを開始するため、本実行を読み取り専用調査に使わなかった。

`codex app-server daemon version`を実行した結果はexit 1。
control socketへの接続が`No such file or directory`で失敗した。
この観測はCLI共有daemonの入口に限る。Desktopの実行状態は判定しない。
`codex daemon version`は正しいコマンドではなくexit 2になる。

追加のprovenance（送り主と入力の由来）調査では、公開`turn/start`の`toolOutput`がuser入力を作らない候補と判明した。
独自namespaceと中継の作者記録を使う。native peerの作者欄は公開schemaでは未確認。
`codex_app`、`codex_tui`の`send_message_to_thread`を外部中継が名乗る案は採用しない。
固定版がこの予約済み組合せを人間の指示取得に扱うためである。
busy時の保持は中継側で行い、通常のuser queueへ落とさない。
schemaは`name`、`namespace`、`output`だけで、source、author、callIdはない。
serverは`call_id=None`のFunctionCallOutputを作る。
idleなら開始し、busyなら同じturnのpending inputへ追加する。reviewやcompact中は拒否される。
RPC応答のinProgressは受理であり、個別依頼の処理確認ではない。
中継の属性はCodexが認証したnative authorにならない。
入力型だけで人間承認への昇格防止を保証できないため、実tool側の検証を必須にする。
固定版根拠は`app-server-protocol/src/protocol/v2/turn.rs:153-181`、
`app-server/src/request_processors/turn_processor.rs:541-550,597-620,672-715`、
`core/src/session/turn_input.rs:289-371,660-718`、
`core/src/agent/control/sender_context.rs:22-75`。

MCPの標準接続はthreadが所有するMcpRuntimeへ生成される。
再利用は同じruntimeのprevious接続集合から行う。
共有tool catalog cacheを、複数thread共通のstdio接続poolとは扱わない。
hostは`params._meta`にthreadId、sessionId、callIdと`x-codex-turn-metadata`を生成する。
modelのargumentsとは別の引数でRMCPへ渡す。
接続部はこの正規metadataを毎callで照合できる候補である。
これは署名された会話証明ではなく、信頼したhostのstdio経路を前提にする。
Desktop同梱0.159.2の実metadataは未確認。
固定版根拠は`core/src/session/session.rs:1572-1575`、`codex-mcp/src/runtime.rs:99-102,311-355`、
`core/src/mcp_tool_call.rs:523-534,1327-1343,1421-1439`、
`core/src/turn_metadata.rs:429-453`、`rmcp-client/src/rmcp_client.rs:844-888`。

## Claude側のローカル実装

DesktopのASAR `/.vite/build/index.chunk-Des3qCSt.js`、文字offset 184589に送信の説明、185538に入力schema、214347にhandlerがある。
handlerは自分自身、無人の送り主、無人の宛先、archived、startingを拒否する。
peer由来の包みに送り主を付け、`sendPeerMessage`へ渡す。
`delivered`、`queued`、`undelivered`とmessage_idを返す。
根拠は`/Applications/Claude.app/Contents/Resources/app.asar`の静的読取り。

CLIの通常会話通信は、team JSONとは別である。
CLI 2.1.286の埋込みJavaScriptを静的読取りした。
byte offset 204166807付近の`ze`は`type:user`の`message.content`を読み、originを`peer`にしてqueueへ入れる。
session_id不一致は拒否する。
受信文中のslash commandは実行しない。
同204168996付近の`be`は`type:user`と`type:control`を分ける。
同204170581付近は、idle通知の返信先をUnixソケットの名前空間と接続側のPIDで検査する。
根拠バイナリは`/Users/tachibanashuuta/.local/share/claude/versions/2.1.286`。

この静的証拠から「Codex以外のプロセスは必ず拒否される」とは結論できない。
「返事の宛先には検査がある」は確定している。
外部プロセスによる正規の往復は未検証。
公式文書は、scriptやhookが自セッションのsocketへ投稿する用途を明記している。
Mac/Linuxの認証行は任意であり、Claude以外の送り主を一律に禁じてはいない。
一方、投稿、返信、受理確認を含む外部向けwire契約の全体は確認できない。
直接socket書込みは、版を固定した実験的な接続部として扱う。

`claude --help`で、stream-json、resume、background、restricted、session IDの入口を確認した。
`claude attach --help`はbackground画面への接続であり、返信本文だけを返すAPIではない。
別プロセスのresumeは会話間通知とは区別する。

## 公式な外部入力の候補

Claude Channelsは標準MCPの上に、Claude固有の通知を付ける。
普通のMCP登録に加え、起動時のchannel選択が必要である。
独自channelのpreview試験には、開発用channelの明示選択と警告承認が必要になる。
個人Pro/Maxと、管理組織の設定条件を分けて確認する。
permission relay（外部から権限承認を返す機能）は通信に不要であり、候補仕様では使わない。

Channelsのnotificationは受信ACKを返さない。
書込みの完了を、Claudeが通知を読んだ証明にしない。
claudex側に明示的な受信確認toolと、依頼IDに対応する返信toolを用意する。

Codexは対象runtimeへ正規に接続し、threadとactive turnを観測する。
busy時の既定はqueueとし、無断interruptは行わない。
主候補は独自namespaceのtoolOutputである。
普通のCLI queueはuser入力であり、外部AI由来を保持する主経路には使わない。
toolOutputの元作者と呼出し元は中継監査に記録する。native peerの身元と同一だとは表示しない。

## 未確認

1. Codex Desktopの会話を、別の正規clientが同じlive runtimeで扱えるか。
2. Claude Desktopが独自Channelsの起動を許すか。CLI対応をDesktop対応へ読み替えない。
3. 既存会話へ追加する際に、再起動や一度の接続切替が必要か。
4. channelがこのアカウントと版で有効か。ツール一覧の存在だけでは確認しない。
5. 相互通信の実ターンと元の会話への返信。現時点では一度も送信していない。
6. queue、通知、peer入力の受理後に、相手が拒否または保留した場合の結果回収。

## 応援と採否

| 担当 | モデルと状態 | 採否 |
|---|---|---|
| Codex内の独立調査 | GPT-6.1 Sol / high。queue、toolOutput、Desktop起動経路を回収 | 輸送形式、各通信の分離、queueのuser入力分類、toolOutputの認証限界とDesktopの未確認を採用 |
| Grok Build CLIの独立調査 | Grok 4.7 / medium。終了コード0、確定回答回収 | Claude通常通信とDesktopの分離を採用。「送り主もClaudeである必要がある」は未証明の推定として保留 |
| Ask Pro | ChatGPT 6 Pro。固定版とweb検索付き比較回答を回収 | 同じ実行体への再接続と別実行体のresumeの分離、Channels、未実証のDesktop境界を採用 |
| Claude Opus / Haiku | route-cliの利用枠停止。起動せず | Grokで調査を代行。Claudeで独立検査できたとは数えない |
| 別Codex CLI | account fingerprint mismatch。required check後も未確認 | 起動せず。現会話内のnative応援と別に扱う |

Ask Proの会話: https://chatgpt.com/c/6abddbc1-3c88-83a7-8690-1bad3d365590
第1依頼はGitHub connectorを実選択。第2依頼はweb検索を実選択し、送信後の投稿を確認した。
第1回答で、`agent/control/api.rs`のQueueOnly/TriggerTurn分岐、`turn_processor.rs`のexpectedTurnId検査を確認したと報告された。
第2回答は12分10秒で確定した。書込みと通信実験はしていないとの回答である。
「共通brokerと製品別adapterは成立する構成がある」が結論。
管理下のapp-serverと常駐Agent SDKの組合せは設計上の候補だが、既存Desktopのlive接続証明ではない。
Claude Channelsと、Claude自身を中継にしてSendMessageする候補も挙がった。
独立回答も、socketの存在だけでは外部向けwire契約の完成としないと判定した。
中継するClaudeを追加すると推論費用と会話が増えるため、初期の主案はChannelsとする。
受信時だけでなく、実行tool側にも権限検査が必要との指摘を採用する。
SDKのcanUseToolだけで全操作を検査できるとは扱わない。
第3回答の計画敵対検査は10分40秒で確定した。
登録を会話認証と同一視しないこと、受信側の強い権限への委譲、依頼ごとの返信認可、
同期待ちの循環、Desktopの入場条件、wire型、channelの交渉版、期限後の実行、
配送前intent、異なるIDによるループが指摘された。
採否と計画変更はplan-review.mdへ記録した。合格判定は依頼していない。
取得した公開版の固有内容と、ローカルで照合できるタグ情報を分けて残す。

## 2026-10-01追補：共通機能への限定とagmsg比較

本人の追加条件は「片方にしかない機能はなくていい」。これは仕様や実装計画の承認とは別の、通信範囲の明確化である。
共通部分の候補は宛先一覧、文章送信、受信、元の依頼への返信。モデルと履歴は各製品が保持する。
既存の純正送信ツールへ他社セッションを無改造で登録できる公開契約は、今回確認できていない。
共通操作の接続部によって、利用者の自然言語による依頼と返信をそろえる案を検討する。
Desktop対象を取り下げる指示とは解釈しない。

紹介記事 https://zenn.dev/yamamoto666999/articles/agmsg-cross-agent-messaging と公開実装を読んだ。
比較時のagmsg mainは `2971913fa73c852d7d1573692a0c72c52ef1b3ee`。インストールと実通信はしていない。
agmsgはローカルの共有保存先と製品別の受信処理を使い、同じ目的の共通通信を既に実装している。
Claude CodeではMonitorによる受信、Codexではapp-server接続による同じthreadへのturn/startを使う。
Codex側にapp-serverを使う点は前案と共通であり、独自案だけが製品の機能を使うとは説明しない。
agmsgのCodex monitorは起動経路の変更と再起動が必要。既存Desktop会話への無変更接続を証明するものではない。
コードでは `codex-bridge.js:1513-1517` が通常text入力を使用する。
前案の独自toolOutputとは入力の由来の扱いが異なるが、どちらの実行安全性も入力型だけで保証しない。
agmsgのsend.shは保存後に送信結果を返す。返事の完了とは別である。
前案は依頼と返信の対応、段階別状態、接続由来の送り主確認をさらに必須化していた。
共通通信に絞るなら、agmsgの適合性を実証して不足だけを加える方針が第一候補。全面的な新規実装の必要性は未証明。

根拠：
- https://github.com/fujibee/agmsg/blob/2971913fa73c852d7d1573692a0c72c52ef1b3ee/ARCHITECTURE.md
- https://github.com/fujibee/agmsg/blob/2971913fa73c852d7d1573692a0c72c52ef1b3ee/docs/codex-monitor-beta.md
- https://github.com/fujibee/agmsg/blob/2971913fa73c852d7d1573692a0c72c52ef1b3ee/scripts/drivers/types/codex/codex-bridge.js
- https://github.com/fujibee/agmsg/blob/2971913fa73c852d7d1573692a0c72c52ef1b3ee/scripts/send.sh

## 元の調査の一次資料

- [Codex App Server](https://developers.openai.com/codex/app-server/)：接続初期化、thread、turn、イベント。
- [Responses Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent)：native send_messageとfollowup_taskの意味。
- [Claude cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)：通常会話通信、inbound controls、Mac内のsocket。
- [Claude agent teams](https://code.claude.com/docs/en/agent-teams)：team mailboxの形式検査と書込み結果。
- [Claude Desktop](https://code.claude.com/docs/en/desktop)：Code会話間通信とCLIとの違い。
- [Claude Channels](https://code.claude.com/docs/en/channels)：外部入力を開いた会話へpushする用途と起動条件。
- [Channels reference](https://code.claude.com/docs/en/channels-reference)：通知、返信tool、通知にACKが無いこと。
- [Claude MCP](https://code.claude.com/docs/en/mcp)：v2 runtime、交渉revisionとChannelsの制限。
- [固定版Codex](https://github.com/openai/codex/tree/01fc69f4026735edfdf6789820549727a4867b11)：公開実装の版。

過去の記憶は責任分離の参考だけに使った。
memoryの「実行、閲覧、記憶を分ける」（source: MEMORY.md:11706-11714）は、現行通信の仕様の根拠ではない。
現作業先のdecisions.mdとpatterns.mdは見つからず、harness-memの対象検索は過去の通信設計を返さなかった。


## 小型検証後の採否

- 採用: 元のapp-server/peer socketへ接続する発想。会話を別プロセスへ移さないため。
- 採用: 両製品から使える薄いMCP窓口。純正一覧への他社登録は公開拡張点を確認できていないため。
- 採用: 公式SDKの登録ID限定read。固定fixtureでIDとページ指定を確認したため。
- 見送り: agmsg forkと共有SQLite。最新の本人指定による。
- 要確認: peer/tool出力の実配送、元の文脈による返信、既存Desktopとの接続。小型試験はそこまで証明していない。
- Ask Pro再調査: gpt-6-proへ送信したがUnknown error。再試行1回も再生成失敗。内容の採用なし。


## Grok独立調査の回収（native-first再調査）

Grok Build grok-4.7 / medium / permission-mode plan。実終了コード0。
調査担当は実装や通信試験をしていない。回答の確信度はmedium。

回答原文抜粋:
> 薄い共通 MCP が、送信側のモデルに相手の ID を見せる面として必要です。MCP を登録しただけでは、相手の会話は起きません。

> ソケットへ書けたことは配信ではありません。

> toolOutput に著者欄がありません。未対応の関数出力を、モデルが無視するか、ユーザー発言と同じに扱うかは未測定です。

リーダーの採否:
- 採用: 一覧と通信を別面として扱う。共通MCPだけで受信が完成したとは判定しない。
- 採用: native peer表示とChannels表示を区別。既存Desktopの成功を別に要求する。
- 採用: toolOutputの由来と扱いをモデル実試験で確かめる。schemaだけで承認境界を保証しない。
- 見送り: 別app-serverのresumeを主経路として試す案。採るなら所有プロセスでは届かないことの対照試験に限定する。
- 保留: Claude socketのwireは公開文書だけで確定できないとの指摘。今回のローカルbinary調査と空本文接続は追加証拠だが、非空配送の公開契約を証明しない。
- 保留: Xの例示は本文に個別URLが無く、この計画の成立根拠には採らない。

Ask Proはリーダーが別途呼んだがサービスエラー。GrokがAsk Proを呼ばなかった説明は、親側の実施記録とは別である。

## 2026-10-01 実会話検証後の補足

現行の結論と実測は evidence.md と Plans.md を正本とする。以前のquota待ち、Desktop読取り未検証、相互配送未検証という記述は過去時点のもの。

TypeScriptで製品実装する場合にも履歴読取APIが存在することを公式SDK文書で照合した。`listSessions/getSessionMessages` とPythonの `list_sessions/get_session_messages` が提供されている。今回の実測はPython SDK。TypeScript製品コードの検収はP2で同じfixtureを使う。
出典: [Claude SDKのセッション文書](https://code.claude.com/docs/en/agent-sdk/sessions)。2026-10-01読取、行461–462相当。
