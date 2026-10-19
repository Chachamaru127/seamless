# seamless が Reason Network に完全OSSで挑むための計画（M・叩き台）

作成: 2026-10-19。これは計画の叩き台で、承認前の spec ではない。

## 0. 立花さんの問い

> 「このMCPを作るより、そもそも今GrokBotがあってDotがあって、リモートコントロールのClaude Codeがあって、みんなそういうので使ってる。そこにMCPを繋いでサーバーを組む方が分かりやすいのかな。もうそこで繋がる仕組みはできてるから、あとはローカルのCodex、Claude Codeが全部同じ共通ルールで繋がれば、対応表は言ってるか言ってないかの違いで、Reasonが書いている全CLIを使えると思う。保守的すぎるのでは。めちゃめちゃチャレンジングにReasonに対抗し、完全オープンソースで勝つ方法を検討してほしい。」

> 「シームレスという名前の通り、ユーザーが壁を感じることなくDot、GrokBot、Claude Codeなどの各CLIが連携できることを想定している。」

## 1. 事実（2026-10-19時点）

### Reason Network

- 1行インストール + `reason network setup`。10以上のエージェントを検出してMCPとフックを書く。
- チーム、人、マシン、セッションの階層。repo@branch、busy/idle、doing まで出す。
- 1台1デーモン。P2P（iroh）、LAN直結、relay、オフラインの郵便箱、hold/refuse、ask_user、doctor、メニューバー。
- エンジンは MIT または Apache-2.0。CLI は proprietary。公開から3日で432 stars、v0.10.7。
- 配送は push / turn / pull の3段。MCPの通知はモデルに渡らないと明記（2026-10の実測）。

### seamless 現行

- Claude Code、Codex Desktop、Grok CLI の3製品。1台、デーモンなし、アカウントなし。
- 4段階の証拠（受理、到達、処理開始、返答完了）。同じIDは再送しない。不明なら送らない。
- 内部API依存（Claude socket、Codex IPC、Grokの内部ファイル）。互換表は 2.1.284/286、26.930 で停止。
- 非公開。LICENSEなし。npmの `seamless` は取得済み。

### 既にある接続（立花さんの言う「もう繋がる仕組み」）

- Claude Code: hooks、MCP、`--remote-control`（Anthropic APIへoutbound HTTPSで登録し、pollする。公開のメッセージAPIではない）、`--cloud` の既存セッションへメッセージをqueueするCLI。
- Codex: app-server、hooks、MCP、`codex queue --thread`。DesktopはIPC。
- Grok CLI: hooks（PostToolUse、Stop）、MCP。
- Grok Bot: webhook、玄関口（内部API）、routine、SSHでログ。
- Dot: MCP Events（webhook購読）、Tunnel。
- opencode: plugin API、MCP、session events。
- Cursor、Gemini CLI、Copilot CLI、Pi、Amp: hooksまたはplugin、MCP。DeepSeek HarnessはMCPのみ（pull）。

### 技術的な制約

- MCPは「AIアプリがサーバーの道具を呼ぶ」方向。サーバーからAIへ能動的に本文を押し込む道ではない。MCP通知をモデルに渡すクライアントは、2026-10時点で確認されていない。
- したがって「MCPサーバーを1つ置けば全CLIに届く」は成立しない。届けるには、各製品のフック、プラグイン、またはその製品のリモートチャネルが要る。
- ただし、その差は「共通ルール + 薄いアダプタ」で吸収できる。アダプタをコアのコードではなく、宣言（manifest）と薄いフックにすれば、対応表は「言ってるか言ってないか」に近づく。
- セッションの同一性（製品、native ID、世代、cwd、repo、branch、busy/idle、doing）と、配送段階（push/turn/pull）、証拠の取り方は製品ごとに違う。ここを共通の型に正規化するのが core の仕事。

## 2. 仮説

**MCPサーバーを「共通の入口」にし、配送は各製品の既存チャネルに委ねる。アダプタは manifest + 薄いフックにし、コミュニティが追加できるようにする。コアは「同一性、配送段階、証拠、権限」の4つだけを持つ。**

これなら、ユーザーから見た壁は「1つの一覧、1つの送信、1つの受信箱、1つの状態」に減る。製品ごとの違いは、アダプタの能力表に隠れる。

## 3. 選択肢

### A. Universal MCP hub + adapter manifest + existing transports（推奨）

- `seamlessd`（stdio MCP でも、ローカルhubでも動く）が、一覧、送信、受信箱、状態、権限を持つ。
- 各製品のアダプタは `adapter.json`（発見、同一性、配送段階、証拠、能力、install手順）と、薄いフック1枚。
- 遠隔は新しいP2Pを作らず、SSH、Tailscale、Cloudflare Tunnel、MCP Tunnel、Claude Remote Control、Grok Bot webhook、Dot MCP Eventsをtransportとして使う。
- チームは任意。自前のhubをVPS/Piに置ける。アカウント不要。
- 長所: 立花さんの直感に合う。実装が小さい。全OSSにできる。既存の接続を捨てない。
- 短所: 製品ごとのフックの保守。pushできない製品はturn/pullになり、UXに差が出る。

### B. Open protocol + reference implementation（长期の堀）

- 封筒、同一性、配送段階、証拠、能力の仕様を公開し、適合試験キットを配る。
- seamless は参照実装になる。他社が「seamless-compatible」を名乗れる。
- 長所: 標準を取ると、Reason も無視できない。OSSの堀はコードではなく仕様と試験。
- 短所: 標準は自然には広がらない。最初の実装とコミュニティが要る。Aと同時にやる必要がある。

### C. Reason互換のfork/embed（速いがderivative）

- ReasonのApache/MITエンジンを取り込み、CLIとアダプタを完全OSSにする。
- 長所: 10以上の対応とP2Pを最短で手に入れる。
- 短所: 上流の劣化コピー。保守が二重。ライセンスは許しても、コミュニティの支持は得にくい。

### D. 既存のリモートチャネルだけに乗る（最も差別化、最も狭い）

- Grok Bot、Dot、Claude Remote Controlだけをtransportにする。新しいネットワークを作らない。
- 長所: 「アカウントもデーモンも新しい網もない」。Reasonが持たない日常アシスタントへの道。
- 短所: 一般のCLIには届かない。製品のリモート機能に依存する。APIが非公開。

## 4. 推奨

**A + B。Dは差別化の入口、Cはベンチマークと移行の参考。** 最初の90日はAに集中し、Bの仕様と適合試験を同時に育てる。DはGrok Bot、Dot、Claude Remote Controlの3つで実証する。Cはやらない。

理由:
- Reasonの強みは「チームの網」と「最初の10分」。正面から同じものを作ると負ける。
- seamlessの勝ち筋は「壁のなさ」と「既存の接続を使うこと」。新しい網を覚えさせない。
- 全OSSの堀は、コードの量ではなく、アダプタの数と標準の採用で作る。
- 1人で10製品を抱えない。manifestと適合試験でコミュニティに渡す。

## 5. 最初の90日（案）

| 段 | やること | 完了条件 |
|---|---|---|
| 0〜2週 | manifest仕様、hub MVP、Claude Code / Codex / opencodeの3アダプタ、`setup`/`who`/`ask`/`inbox`/`status` | 初見のMacで1コマンド、3製品が一覧に出て、1往復できる |
| 3〜6週 | Cursor / Gemini CLI / Copilot CLI / Grok CLI / Piのアダプタ、push/turn/pullの段階、適合試験キット | 8製品が同じ操作で一覧・送信・状態になる。新製品はmanifest追加だけで動く |
| 7〜10週 | Grok Bot / Dot / Claude Remote Controlのtransport、Reasonブリッジ、自前hub（SSH/Tailscale） | 遠隔の1製品と1往復。Reason利用者が移行または併用できる |
| 11〜13週 | 公開β、README EN/JA、ライセンス、CI、アダプタ登録所 | 第三者が説明どおりに動かし、アダプタを追加できる |

## 6. 確かめること（Yes/No）

1. 初見のMacで、アカウントなし、手動設定なしで、3製品が一覧に出る。
2. 生きている会話へ送り、返事を受け取り、4段階の状態を返せる。
3. 新しい製品の追加が、コアのコード変更なしで、manifest + フック1枚で済む。
4. 遠隔の1製品（Grok Bot、Dot、Claude Remote Controlのどれか）と1往復できる。
5. 公開物に proprietary なコード、アカウント固有情報、秘密が含まれない。
6. 適合試験キットが、対応を名乗る各製品で通る。
7. Reason利用者が、エージェント設定を変えずにseamlessへ移行または併用できる。

## 7. 停止条件

- 通常のユーザーが取得できない秘密やアカウントがないと、アダプタが動かない。
- 製品の内部APIを逆コンパイルする以外に道がなく、法務リスクを説明できない。
- push配送が信頼できず、「届いた」と表示することが嘘になる。
- チーム機能に中央のホスト型サービスかアカウントが必須になる。
- アダプタが増えるたびにコアが大きくなり、1人では維持できない。
- 90日で3製品の1往復が通らない。

## 8. 人間の判断（Human gates）

- Grok Bot、Dotなど内部APIを使うアダプタの公開。
- 名前、ポジショニング、ライセンスの最終決定。
- 公開βとGitHubのpublic化。
- Reasonブリッジを「互換」と名乗るか、単なる移行補助にするか。

## 9. 未決（AIが勝手に決めない）

- 遠隔の第一transportはSSH、Tailscale、Cloudflare Tunnel、Claude Remote Control、Grok Bot webhookのどれか。
- hubを常駐デーモンにするか、stdioのみにするか。
- チーム機能をv1に入れるか、個人に絞るか。
- Reasonブリッジを作るか、競合に徹するか。
- v1の最小製品セットは3か5か8か。

## 10. 応援への依頼

この計画を、次の観点で厳しく見てほしい。賛成意見は不要。穴、矛盾、危険、見落とし、もっと強い別案を出す。

- 立花さんの「壁を感じない」に照らして、どこで壁が残るか。
- 「MCPサーバー + manifest + 既存transport」は技術的に成立するか。成立しないなら、どこが無理か。
- 全OSSでReasonに勝つ筋はあるか。あるなら、どの順番で何を捨てるか。
- 1人+コミュニティで維持できるか。できないなら、範囲をどこまで削るか。
- 90日の段取りは現実的か。最初の3製品はどれか。
- 法務、セキュリティ、製品の内部API依存の危険。
