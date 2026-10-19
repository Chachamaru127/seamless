# seamless が Reason Network に挑む計画（M・統合版 v2）

作成: 2026-10-19。叩き台 v1、A2A案 v2、Haiku 5.5 の図面検査、Codex Astra の敵対、Grok 4.7 の使い心地を統合したもの。まだ承認前。

## 1. 目的

今開いているAIに、そのまま一言届く。相手が読むまで、届いたと言わない。Claude Code、Codex、Grok Botが同じ一覧に並び、製品差を意識せず1往復できる。完全OSS。Reasonのチーム網とは違う、個人と小チームの配線で勝つ。

非目的:
- Reasonと同じチーム網を最初に作ること。
- 全CLIを90日で正式対応すること。
- 新しいP2Pプロトコルを発明すること。
- 内部APIの再現を公開物の中心にすること。
- 独立した受信箱アプリを作ること。
- ユーザーにtransport、push/turn/pull、常駐かstdioかを選ばせること。

## 2. 3人の指摘で変わったこと

### 採用

1. **MCPは道具の口であり、押し込みの口ではない。ただしClaude Code Channelsは公式の押し込み。** 「MCPでは届かない」と一般化しない。
2. **公式チャネル/フックを先に使う。** Claude CodeはChannels、Codexはapp-server/queue、Grok CLIはhooks、opencodeはplugin。内部socket/IPCは最後の手段。
3. **共通化するのは依頼形式と状態の意味まで。** 配送の速さと保証は製品ごとに違う。画面に3状態を残す。
4. **v1の最初の一覧は3つ。** Claude Code、Codex、Grok Bot。Grok CLIは4つ目、opencodeはアダプタSDKの試験。8製品は90日に入れない。
5. **端末ごとに1つの常駐hub。** stdioは接続窓口に限定する。状態の所有者を1つにする。「デーモンなし」を看板にしない。
6. **依頼IDと製品側のメッセージIDを結ぶ。** 4段階の証拠だけでは往復を保証できない。不明は照会で解消する。無条件の再送はしない。
7. **権限を分ける。** 閲覧、送信、会話の起動、操作の承認を別にする。コミュニティ製フックはインストール時にコードを実行する入口なので、manifestに権限と配布元を書く。
8. **勝ち指標を決める。** 対応製品数ではなく、最初の画面までの時間、初回往復までの時間、操作回数、既存会話への復帰成功率、届いた表示の正確さ、アダプタ追加時間でReasonと比べる。
9. **最初の1週間で最难関を検証する。** Claude Code Channels、Codex app-server、Grok Bot webhookで、busy、idle、再起動、承認待ちを含む1往復。
10. **ユーザーに見せるのは宛先の一覧と送信欄だけ。** MCP、manifest、transport、push/turn/pullは、アダプタを書く人の文書にだけ残す。
11. **独立した受信箱を作らない。** 返事は送り先のCLIの画面に出る。送った側は同じ場所に1行の状態を持つ。
12. **最初の説明文で名乗る製品は、最初の一覧に出す。** v1でDotを名乗らない。Dotはphase 2。

### 見送り

1. 90日で8製品。
2. 「デーモンなし」を絶対の看板にすること。
3. 「MCPでは全製品に届かない」という一般化。
4. 「OSSだから勝つ」「アカウント不要だから勝つ」という単独の理由。
5. Remote Control、Dot、Grok Botを、宛先指定・起動・返信照合の実証前に共通transportへ数えること。
6. A2Aを最初から標準の堀と決めつけること。外部実装者が1者もいない段階で標準化を前提にしない。
7. Reasonエンジンのforkを最初の手段にすること。互換が必要なら、まずブリッジで確かめる。
8. ユーザーに配送段階や常駐方式を選ばせる質問。

### 要確認（立花さんの判断）

1. A2Aをv1に入れるか、phase 2に回すか。
2. v1の最初の一覧を Claude Code + Codex + Grok Bot にするか。
3. hubをlaunchdで常時動かすか、必要なときだけ起動するか。
4. チーム機能をv1に入れるか、個人に絞るか。
5. Reasonブリッジを「互換」と名乗るか、移行補助にするか。
6. Grok Botの玄関口など内部APIを使うアダプタを、公開物に含めるか。

## 3. 事実（出典つき）

| 事実 | 出典 | 状態 |
|---|---|---|
| Claude Code Channels は、MCPサーバーから開いている会話へイベントを押し込む。`--channels`、allowlist、Anthropic認証、組織設定の条件がある。research preview。 | code.claude.com/docs/en/channels（2026-10-19取得） | 確認済み |
| Claude Code の標準MCPは、何もセッションへ押し込まない。 | 同上の比較表 | 確認済み |
| Claude Code Remote Control は、claude.ai/Claudeアプリからローカル会話を操作する。Anthropic契約限定。API key不可。 | code.claude.com/docs/en/remote-control（2026-10-19取得） | 確認済み |
| Codex は app-server、`codex queue --thread`、hooks、MCP を持つ。Desktop IPC は非公開。 | Reason Network DESIGN.md、seamless の調査記録 | 一部未確認 |
| Grok CLI は PostToolUse/Stop hooks と MCP を持つ。`~/.grok/active_sessions.json` は内部。 | Reason Network DESIGN.md、seamless の調査記録 | 一部未確認 |
| A2A v1.0 は Linux Foundation の下で2026-03に安定版。Apache-2.0。HTTP/JSON-RPC/gRPC、AgentCard、Task、Message、push、SSE。 | a2a-protocol.org（2026-10-19取得） | 確認済み |
| Reason Network のエンジンは MIT または Apache-2.0。CLI は proprietary。アカウントなしのチーム作成もある。 | reason-network README、reason-cli README | 確認済み |
| Reason は push/turn/pull の3段を明示し、MCP通知はモデルに渡らないと書く。 | Reason Network DESIGN.md | 確認済み |

## 4. アーキテクチャ

```
[他のエージェント / A2Aクライアント / クラウド]
        │ A2A（phase 2。AgentCard、Task、Message、push、SSE）
        ▼
[seamless hub（端末に1つ）]
  - ディレクトリ（製品、native session ID、世代、cwd、repo、branch、busy/idle、doing）
  - 依頼IDと製品側IDの対応
  - 4段階の証拠と照会
  - 権限（閲覧、送信、起動、承認）
  - アダプタmanifestと配布元
        │ 公式チャネル/フック/プラグイン
        ▼
[Claude Code: Channels] [Codex: app-server/queue] [Grok Bot: webhook] [Grok CLI: hooks] [opencode: plugin]
```

- **hub**: 端末に1つ。stdioのMCPサーバーはhubへの接続窓口。状態の所有者を1つにする。
- **MCP**: ローカルのAIが使う道具。`list_agents`、`send_message`、`check_inbox`、`status`、`ask_user`。
- **channel/adapter**: 製品ごとの押し込み。公式を先に使う。manifestに発見、同一性、配送段階、証拠、権限、install手順を書く。
- **A2A**: phase 2の外部境界。hubが各セッションをA2Aエージェントとして公開する。v1ではプロトタイプ1本に留める。
- **transport**: ローカルはUnix socket。遠隔はA2A over HTTPS、SSH、Tailscale、Cloudflare Tunnel。通信路と会話操作を別層にする。

## 5. ユーザー体験（Grok 4.7の指摘を採用）

### 最初の画面

```
いま開いている相手
  Claude Code   api-claude   テストを直している    すぐ渡せる
  Codex         api-codex    差分を確認中          次の区切りで渡す
  Grok Bot      茶々丸       スリープ中            起こすと届く

  [ このテスト、落ちてる                         ] 送る
```

- 宛先の一覧と送信欄だけ。MCP、manifest、transport、push/turn/pullは出さない。
- 今渡せない行には送信ボタンを出さない。
- 送信欄の下に「移るのは、今書いた一文だけ」と固定する。

### 1つのコマンド

```sh
seamless "このテスト、落ちてる"
```

- 宛先の既定は、今開いている会話。曖昧なときだけ一覧を出す。
- `who`、`ask`、`inbox`、`status` を覚えさせない。`inbox` は独立した製品にしない。
- 返事は送り先のCLIの画面に出る。送った側は同じ場所に1行の状態を持つ。

### 状態の言葉

| 内部の段階 | 画面の言葉 |
|---|---|
| accepted | 預かりました。まだ相手には渡していません |
| reached | Claude Code に渡りました。まだ読んでいません |
| processing | 相手が処理を始めました |
| replied | 返事が来ました |
| unknown | 届いたか確認中です。二重には送りません |

「届いた」は、依頼IDと製品側のメッセージIDが結び付き、製品側の記録で確認できたときだけ出す。受理だけで「届いた」としない。

### 名乗る範囲

- v1の最初の説明文で名乗るのは、Claude Code、Codex、Grok Bot。
- Dotはphase 2。最初の一覧に入るまで、最初の説明文で名乗らない。
- 「Reasonの通知は相手のモデルに届かないことがある。seamlessは相手の画面に出るまで届いたと言わない」を移行の入口にする。チームの見回りはReasonに残してよいと書く。

## 6. v1の範囲

### 最初の一覧（3つ）

1. **Claude Code（Channels）**: 公式の押し込み。research previewの条件とallowlistを確認する。既存のsocketアダプタはlegacyとして残すが、公開v1の主経路にしない。
2. **Codex（app-server/queue）**: 公式の起動とメッセージ投入。Desktop IPCはlegacy。CLIのapp-serverを主経路にする。
3. **Grok Bot（webhook）**: 既に実会話で往復している。webhookの受理と返信照合を使う。玄関口はv1に入れない。

### 4つ目以降

4. **Grok CLI（hooks）**: 既に実会話で往復している。hooksの公式性とStop時の挙動を再確認してから正式対応。
5. **opencode（plugin）**: 公式plugin API。アダプタSDKの「コア変更なしで追加できる」実証に使う。

### 出さない

- Cursor、Gemini CLI、Copilot CLI、Pi、Amp、DeepSeek Harnessの正式対応。
- Claude Codeの内部socket、Codex DesktopのIPCを公開v1の主経路にすること。
- Grok Botの玄関口、Dotの逆方向、Reasonの独自プロトコルのブリッジ。
- チーム機能、P2P、クラウド中継、独立した受信箱。

## 7. 90日（改訂）

| 週 | やること | 完了条件（観測値） |
|---|---|---|
| 1 | 最难関の検証。Claude Code Channels、Codex app-server、Grok Bot webhookで、busy、idle、再起動、承認待ちを含む1往復。 | 3製品それぞれで、依頼IDと返信IDが一致する1往復。失敗時は「不明」と理由が出る。 |
| 2〜4 | hub、MCP道具、依頼ID対応、4段階、照会、allowlist、最初の画面、1コマンド、状態の言葉。 | 初見のMacで、最初の画面が10秒以内に出る。1コマンドで1往復。手動設定はMCP登録の1回だけ。 |
| 5〜6 | Grok CLIのhooksを再確認して4製品目。opencodeでアダプタmanifestと適合試験の最小形。 | 4製品が同じ画面で一覧・送信・状態になる。新製品の追加がmanifest + フック1枚で済む。 |
| 7〜8 | 遠隔の hardening。Grok Botのスリープ、再起動、返信照合。Dotは通知だけなら試験。 | 遠隔1製品で、宛先指定、送信、返信照合がそろう。Dotは通知のみと明記。 |
| 9〜10 | A2Aプロトタイプ。hubが1セッションをAgentCardとして公開し、外部A2Aクライアントから1往復。 | 外部クライアント1つで、AgentCard発見、message/send、tasks/getが通る。 |
| 11〜13 | 導入、README EN/JA、LICENSE、CI、アダプタ登録所、Reasonとの比較実測。 | 第三者が説明どおりに動かし、アダプタを1つ追加できる。比較指標5つの実測値がある。 |

## 8. 確かめること（Yes/No、観測値つき）

1. 初見のMacで、最初の画面が10秒以内に出る。観測値: 画面が出るまでの秒数、質問の数0、設定ファイルの変更数。
2. 最初の画面に、Claude Code、Codex、Grok Botの3つが、3状態のどれかで出る。観測値: 製品数、状態の種類、誤表示0。
3. `seamless "..."` の1コマンドで、既定の宛先に届き、返信IDが依頼IDと一致する。観測値: 依頼ID、返信ID、所要時間、操作回数。
4. 今渡せない行には送信ボタンが出ない。観測値: 送信不可の行数、押した回数0。
5. 送信後に接続を切った場合、二重送信せず「不明」と出る。その後の照会で、届いたかどうかを製品側の記録から判定できる。観測値: 送信回数1、照会回数、最終状態。
6. Grok CLIが、コアのコード変更なしでmanifest + フック1枚で追加できる。観測値: 変更したファイル数、コアの差分0。
7. 遠隔のGrok Bot webhookで、宛先指定、送信、返信照合がそろう。観測値: 受理、返信ID、所要時間。
8. A2Aの外部クライアント1つが、hub経由で1セッションを発見し、1往復できる。観測値: AgentCard、message/send、tasks/getの応答。
9. 公開物にproprietaryなコード、アカウント固有情報、秘密が含まれない。観測値: 秘密スキャン0件、ライセンス検査、アカウント情報0件。
10. Reasonとの比較指標5つ（最初の画面までの時間、初回往復時間、操作回数、復帰成功率、届いた表示の正確さ）の実測値がある。観測値: 各指標の数値と測定条件。

### ACと検証の対応

| AC | 検証コマンド/手順 | 週 |
|---|---|---|
| 1 | `setup` を実行し、画面が出るまでの秒数を3回測る。質問数を数える。`git diff --stat` で設定変更数を確認。 | 2〜4 |
| 2 | `seamless who --json` を実行し、3製品と3状態を検査する。誤表示0を確認。 | 2〜4 |
| 3 | `seamless "…"` を実行し、`seamless status <id>` で依頼IDと返信IDを比較する。操作回数を数える。 | 1〜4 |
| 4 | 3状態の行を作り、送信不可の行に送信ボタンがないことを画面検査する。 | 2〜4 |
| 5 | 送信直後にhubを止め、`seamless status` を2回。送信回数1、状態unknown、照会でreached/repliedを確認。 | 2〜4 |
| 6 | Grok CLIのmanifestとフックだけを追加し、`git diff --stat` でコア0を確認。`seamless who` にGrok CLIが出る。 | 5〜6 |
| 7 | 偽webhookで自動試験。本物はH3の承認後に1回。`seamless status` で受理と返信IDを確認。 | 7〜8 |
| 8 | A2Aの外部クライアント（a2a-sdkのサンプル）でAgentCardを取得し、message/sendとtasks/getを実行。 | 9〜10 |
| 9 | `scripts/peer-secrets.sh`、`git grep` でアカウント情報、`npm pack --dry-run` で同梱物を検査。 | 11〜13 |
| 10 | Reasonとseamlessを同じMacで同じ題材に使い、5指標を計測して表に記録。 | 11〜13 |

## 9. 停止条件（AC番号に対応）

- S1: 確かめること3が、1週間の検証で通らない。→ 製品数を増やさず、原因をPlanに戻す。
- S2: 確かめること5で、二重送信を避けながら未達を救う経路がない。→ 「不明」を許容する設計に戻すか、製品側の重複排除が使える経路だけに絞る。
- S3: 確かめること6で、コアのコード変更が必要になる。→ manifestの設計をやり直す。製品数を増やさない。
- S4: 確かめること7で、遠隔の1往復が法務・認証・製品仕様で通らない。→ 遠隔をv1から外す。
- S5: 確かめること8で、A2Aの必須項目がライブセッションの同一性と両立しない。→ A2Aをphase 2へ送る。
- S6: 確かめること9で、公開物に内部APIの再現やアカウント情報が混ざる。→ 該当アダプタを公開物から外す。
- S7: 1人+コミュニティで、4製品の保守が回らない。→ v1を3製品に減らす。
- S8: 法務・規約の確認が、公開予定日までに終わらない。→ 公開を延期する。内部APIアダプタは出さない。

## 10. Human gates

- H1: Claude Code Channels のresearch preview条件、allowlist、組織設定を確認し、v1の主経路に使ってよいと決める。
- H2: Codex app-server/queue の利用条件を確認し、v1の主経路に使ってよいと決める。
- H3: Grok Bot webhook、Grok CLI hooks、Dot MCP Events の利用規約を確認し、公開物に含めてよいと決める。
- H4: A2Aを前面に出すか、MCP hubとして地味に出すか。
- H5: 名前、ライセンス、公開β、GitHub public化。
- H6: 内部API（Claude socket、Codex Desktop IPC、Grok Bot玄関口）を使うアダプタの公開可否。
- H7: v1の最初の説明文で名乗る製品を、最初の一覧に限定すること。

## 11. Reasonとの比較指標

| 指標 | 測り方 | 勝ちの条件 |
|---|---|---|
| 最初の画面までの時間 | 導入開始から、宛先の一覧が出るまで | Reasonより短い、または同等 |
| 初回往復までの時間 | 一覧が出てから、1通の返信まで | Reasonより短い、または同等 |
| 操作回数 | 導入から1往復までのクリック/コマンド数 | Reasonより少ない、または同等 |
| 既存会話への復帰成功率 | 既に開いている会話へ送り、返信IDが一致した割合 | 3製品で80%以上 |
| 届いた表示の正確さ | 受理だけで「届いた」と表示した件数 | 0件 |
| アダプタ追加時間 | 新製品1つをmanifest + フックで追加するまでの時間 | 1日以内 |

## 12. 未決（AIが勝手に決めない）

1. A2Aをv1に入れるか、phase 2に回すか。
2. v1の最初の一覧を Claude Code + Codex + Grok Bot にするか。
3. hubをlaunchdで常時動かすか、必要なときだけ起動するか。
4. チーム機能をv1に入れるか、個人に絞るか。
5. Reasonブリッジを「互換」と名乗るか、移行補助にするか。
6. 内部APIアダプタを公開物に含めるか、別配布にするか。

## 13. 3人の指摘（要約）

### Haiku 5.5（図面検査）

- ACが判定不能。対象製品、手順、観測値を書く。
- 90日が過積載。最初は1アダプタ+hubに絞る。
- 最初の3製品が曖昧。公式hooks/pluginと現行資産で選ぶ。
- 法務・セキュリティの穴。内部APIの規約、送信先の認可、リモートの鍵管理。
- 未決を前提に使っている。仮定と明記するか、段取りから外す。

### Codex Astra（敵対）

- OSSやアカウント不要だけでは勝てない。比較指標を決める。
- MCPの限界を一般化しすぎ。Claude Code Channelsは公式の押し込み。
- transportと会話操作を混ぜている。Remote Control、Dotは実証前にtransportに数えない。
- 同じルールと、同じ保証を混同している。配送段階を画面に残す。
- 4段階だけでは往復を保証できない。依頼IDと製品側IDを結ぶ。
- stdioかhubか未決のまま見積もっている。v1は端末に1つのhub。
- 1人の保守をコミュニティで水増ししている。v1は2製品。
- 権限と承認が未決。閲覧、送信、起動、承認を分ける。
- ReasonのOSS再利用を切り捨て、標準化に根拠なく期待している。A2Aは外部実装2つで確かめる。
- 90日が製品数の拡大を優先している。1週目に最难関を検証する。

### Grok 4.7（使い心地）

- 初見の10分は、この計画のままだとReasonに負ける。
- 最初の画面は宛先の一覧と送信欄だけ。MCP、manifest、transport、配送段階を出さない。
- 名乗る製品は最初の一覧に出す。DotとGrok Botを名乗るなら、初回に入れる。
- 同じ一覧でも、同じことができると思わせない。3状態を出し、今渡せない行は送信不可にする。
- 「届いた」と言われたのに相手が知らないのが一番信用を壊す。画面の言葉を3つにする。
- 独立した受信箱を作らない。返事は送り先のCLIの画面に出す。
- 最初に捨てるのは、独立した受信箱と、届き方を選ばせる質問。
- 説明文の候補: 「今開いているAIに、そのまま一言届く。相手が読むまで、届いたとは言いません。」
