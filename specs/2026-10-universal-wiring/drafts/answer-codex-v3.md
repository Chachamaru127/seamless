公式経路への移行は有効ですが、「Reason以上の速さ」は未実証です。Reason自身も同じ公式経路を使います。  
勝ち筋は、既存会話への一言を少ない操作で届け、受理と処理を取り違えないことです。  
統合プランv2は、Channelsの認証条件とCodex queueの保証を修正すべきです。確信度：medium。

**1．Reasonの価値と弱点**

事実の確認日は、特記以外すべて2026-10-19。seamlessの指定3文書を読み、コードとファイルは変更していません。

個人には、複数端末の会話を探せることと、離席中の通知が効きます。2〜5人には「誰が、どのrepoとbranchで何をしているか」が見える名簿が効きます。問い合わせ先を人間が探す手間を減らすためです。オフライン配送もseamless現行との差です。ただし、有用性は仮説で、利用効果の比較測定はありません。[README](https://github.com/reason-machines/reason-network)

設計上の制約は次のとおりです。[DESIGN](https://github.com/reason-machines/reason-network/blob/main/DESIGN.md)

| 制約の事実 | 判断 |
|---|---|
| 全メンバーが招待と除名を行える | 友人同士には簡単。役割別管理への変更は名簿設計に及ぶ |
| 承認署名は端末上の鍵に依存。「speed bump」と明記 | 端末を操作できるソフトウェアから人間承認を隔離できない |
| 消えた会話の未読郵便は原則1日で破棄 | 保存期間は変更可能。構造的な弱点とは言い切れない |
| 全端末間を接続し、約50台までを想定 | ハード上限ではない。2〜5人では弱点になりにくい |
| Claudeは内部socketが主経路。公式fallbackもある | 依存は存在するが、撤去不能ではない |

補足：「CLI非公開」は`reason`製品CLIの話です。公開エンジンには`reason-network` CLIがあります。「OSSだから乗り換える」だけでは差が弱いです。[README](https://github.com/reason-machines/reason-network)

**2．公式経路で壊れにくくできるか**

| 経路 | 公式性、制約、配送段階 |
|---|---|
| Claude Code Channels | 公式だがresearch preview。`--channels`で会話ごとに有効化し、Anthropicまたは組織の許可リストが必要。独自開発用flagあり。**claude.ai認証に加えConsole API keyも対応**。Bedrock等は対象外。開いている会話へpushする。[公式](https://code.claude.com/docs/en/channels) |
| Channelsの確認応答 | 通知の書込み成功は処理成功ではない。ClaudeからACKがなく、設定不適合では黙って破棄される。busy時は次turnでまとめて処理。返信用toolによる相関確認が必要。[reference](https://code.claude.com/docs/en/channels-reference) |
| Codex app-server | 公式のプログラム用インターフェース。`turn/start`、実行中への`turn/steer`、`turn/started`と`turn/completed`で開始と終了を観測できる。モデル認証が別途必要。WebSocketはexperimentalで、公開時は接続認証が必要。**自分が接続したserverと、既存Desktop会話の所有serverは区別する**。[公式](https://learn.chatgpt.com/docs/app-server) |
| `codex queue` | 公式repoに実装。ただしqueue登録と消費は別。既存会話の返信取得を求めるissueが未解決。CLI終了0を「到達」にできない。[src](https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs)、[要望、10/15](https://github.com/openai/codex/issues/54252) |
| OpenCode plugin | 公式の拡張口。SDK clientと会話イベントを利用でき、`session.prompt`は通常AI応答を返す。`noReply`は文脈追加のみ。中央許可リストは文書上なく、モデル認証はprovider次第。busy中の割込み保証は未確認。[plugin](https://opencode.ai/docs/plugins/)、[SDK](https://opencode.ai/docs/sdk/) |
| A2A v1.0 | エージェント間通信の標準。タスク状態、ストリーム、認証方式を定義する。認証情報の取得は別手続き。**既存CLI会話へ注入する口ではない**ため、各製品adapterは残る。[v1.0仕様](https://a2a-protocol.org/v1.0.0/specification/) |

推測：内部仕様への依存を減らせば保守しやすくなります。ただしReasonもCodex queue/app-serverとOpenCode pluginを使用しています。Channelsはbusy時に次turnまで待つため、速度優位は断定できません。[Reasonの経路表](https://github.com/reason-machines/reason-network/blob/main/DESIGN.md#getting-messages-into-agents)

**3．公開された不満と乗り換え条件**

Reasonの公開issues一覧は確認時点でopen 0件。閉鎖済み全件とXの網羅確認は未完了です。Reasonからの移行需要は確認できず、以下は類似製品の事例です。[一覧](https://github.com/reason-machines/reason-network/issues)

- **導入後も人間が司会する負担**：agmsg利用者は会話が1通で止まり、双方の起動、参加、受信確認が重かったと報告。「動いている会話から呼べる」が定着条件。2026-10-03公開。[記事](https://zenn.dev/kaz_hira/articles/multi-agent-env-3weeks-measured)
- **空振り起動の資源消費**：agmsg関連運用で3分ごとにCodexを起動し、約3時間で約60会話を生成。メモリ不足を報告。通信層そのものの欠陥とは区別されている。2026-06-19。[#163](https://github.com/fujibee/agmsg/issues/163)
- **環境差による導入失敗**：Windowsでinstaller、`ps`、`uuidgen`等が動かず、対応を要望。2026-06-06。Mac製品への直接需要とは限らない。[#88](https://github.com/fujibee/agmsg/issues/88)
- **受理しても読まれない**：Codexの`/goal`中に外部queueが待ち続け、手動Steerが必要という報告。2026-10公開。公式入口でも配送証拠が必要な根拠です。[#52705](https://github.com/openai/codex/issues/52705)

**優先案**

1. **本質：配送証拠。** 前→後：書込み成功→受理、到達、開始、返答をIDで照合。根拠：ChannelsのACK不在とqueue報告。危険：モデルの自己申告を実観測と混同する。
2. **本質：既存会話の維持。** 前→後：両画面を監視→今の画面から依頼と返信確認。根拠：定着しなかった利用者事例。危険：同じ履歴の別プロセスを元会話と誤認する。
3. **本質：接続の保守性。** 前→後：内部接続中心→公式adapter優先。根拠：上表。危険：previewとDesktop所有serverの制約。まず既存会話で比較実測する。
4. **本質：権限の分離。** 前→後：通信参加→閲覧、送信、起動、承認を別許可。根拠：Reasonの対等な名簿。危険：設定負担が初回往復を遅らせる。
5. **本質：併用から獲得。** 前→後：Reason全面代替→Mac内はseamless、端末間はReasonとの橋渡し。根拠：Reasonの強みを再実装せず試せる。危険：二重配送と権限変換。需要は未検証。

調査は完了。製品優位の判定は未完了です。次の検証は、同じ既存会話でidle、busy、承認待ちを比較し、往復時間と誤った成功表示を測ることです。
