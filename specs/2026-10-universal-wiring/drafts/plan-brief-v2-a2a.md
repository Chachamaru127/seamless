# seamless が Reason Network に完全OSSで挑むための計画 v2（A2Aを軸にする）

作成: 2026-10-19。v1（plan-brief.md）の応援結果を待つ間に、A2A標準を調べて更新した案。まだ承認前の叩き台。

## 0. v1からの変更

v1は「MCPサーバー + manifest + 既存transport」を軸にした。v2は、そこに **A2A（Agent2Agent）v1.0** を足し、遠隔の共通言語にする。

- MCPは「エージェントと道具」の標準。A2Aは「エージェントとエージェント」の標準。役割が違う。
- A2A v1.0は2026-03にLinux Foundationの下で安定版。Apache-2.0。HTTP、JSON-RPC、gRPC、SSE、webhook push、AgentCard discoveryを持つ。
- Reason Networkは独自プロトコル（iroh/tincan）で、A2Aではない。ここが最大の差になる。
- seamlessは「A2Aと、実際に動いているコーディングセッションの間の橋」になれる。標準を守り、独自網を作らない。

## 1. 立花さんの問い（再掲）

> 既にGrokBot、Dot、リモートコントロールのClaude Codeなど、繋がる仕組みはある。そこにMCPを繋ぎ、ローカルのCodex、Claude Codeなど全CLIが同じ共通ルールで繋がれば、対応表は「言ってるか言ってないか」の違いに近づく。保守的すぎる。Reasonにめちゃめちゃチャレンジングに対抗し、完全OSSで勝ちたい。ユーザーが壁を感じない体験にしたい。

## 2. v2の仮説

**seamlessは、A2Aを外側の共通言語にし、MCPを内側の道具の共通言語にし、各製品のフック/プラグインを最後の1マイルに使う。コアは「ディレクトリ、同一性、配送段階、証拠、権限」だけを持ち、製品差はmanifestに閉じ込める。**

これで、ユーザーから見た壁は「1つの一覧、1つの送信、1つの受信箱、1つの状態」になる。外部のA2Aクライアントからは、各セッションがA2Aエージェントとして見える。Reasonの独自網に乗らなくても、標準の網に参加できる。

## 3. 三層のアーキテクチャ

```
[A2A client / 他のエージェント / クラウド]
        │  A2A (HTTP/JSON-RPC/gRPC, AgentCard, Task, Message)
        ▼
[seamless hub (A2A server)] ── ディレクトリ、同一性、配送段階、証拠、権限
        │  manifest + 薄いフック/プラグイン
        ▼
[Claude Code] [Codex] [Grok CLI] [opencode] [Cursor] [Gemini] [Copilot] [Pi] ...
        │
        └─ Grok Bot / Dot / Claude Remote Control（既存のリモートチャネル）
```

- **A2A層**: 外部から見た共通の顔。各セッションにAgentCard（名前、能力、repo、branch、busy、配送段階）を出す。TaskとMessageで仕事をやり取りする。pushはwebhook、streamはSSE。
- **MCP層**: ローカルのAIが使う道具。`list_agents`、`send_message`、`check_inbox`、`ask_user`、`status`。MCP 2026-07-28の`subscriptions/listen`が使えるクライアントには通知も出す。
- **アダプタ層**: 各製品のセッション発見、同一性、配送、証拠。manifestと薄いフック1枚。コアは製品名を知らない。
- **transport層**: ローカルはUnix socket/stdio。遠隔はA2A over HTTPS。下回りはSSH、Tailscale、Cloudflare Tunnel、MCP Tunnel、製品のリモートチャネルを選べる。新しいP2Pは作らない。

## 4. なぜこれがReasonに強いか

| 軸 | Reason | seamless v2 |
|---|---|---|
| 外部との共通言語 | 独自プロトコル | A2A v1.0（Linux Foundation、Apache-2.0） |
| 道具の共通言語 | MCP | MCP（同じ） |
| 実装の公開範囲 | エンジンはOSS、CLIはproprietary | サーバーもCLIもアダプタも全部OSS |
| チームの参加 | Reasonワークスペース | 自前hub。アカウント不要。SSH/Tailscaleで参加 |
| 既存の接続 | 新しい網に参加させる | 既存のGrokBot、Dot、Claude Remote Controlをtransportに使う |
| 対応製品の増やし方 | 各製品のアダプタを本体が持つ | manifest + 適合試験。コミュニティが追加 |
| ユーザーの壁 | チーム、招待、デーモン、アカウント | 1つの一覧、1つの送信、1つの受信箱。裏は隠す |

**勝ち筋は「より多くの製品」ではなく「標準で開いていること」と「既にある接続を捨てないこと」。**

## 5. 選択肢（v2）

### A. A2A-native bridge（推奨）

- 上記の三層。A2Aを外側、MCPを内側、manifest+フックを最後の1マイル。
- 最初の90日で、ローカル5製品 + 遠隔1製品 + A2A conformance。
- 長所: 標準、全OSS、既存接続、拡張性。Reasonの独自網に対する明確な対抗軸。
- 短所: A2AはHTTP前提で、ライブセッションへの割り込みは規定しない。最後の1マイルは自前。AgentCardの粒度とセッション同一性の設計が要る。

### B. MCP hub + manifest（v1）

- A2Aを入れず、MCPとmanifestだけで進める。
- 長所: 小さい。早い。ローカルに強い。
- 短所: 遠隔の共通言語がない。Reasonの「網」に対抗する物語が弱い。

### C. Reason互換fork

- ReasonのApache/MITエンジンを取り込む。
- 長所: 対応とP2Pが最短。
- 短所: derivative。上流の劣化コピー。全OSSの物語が弱い。

### D. 既存リモートチャネルだけ

- GrokBot、Dot、Claude Remote Controlだけに乗る。
- 長所: 最も差別化。新しい網がない。
- 短所: 一般CLIに届かない。製品の非公開APIに依存。

**推奨: A。Bをローカル実装の内部に使い、Dを遠隔の入口に使い、Cはやらない。**

## 6. 最初の90日（v2）

| 段 | やること | 完了条件 |
|---|---|---|
| 0〜2週 | A2AのAgentCard/Task/Messageの最小実装、MCP hub、Claude Code / Codex / opencodeの3アダプタ、`setup`/`who`/`ask`/`inbox`/`status` | 初見のMacで1コマンド、3製品が一覧に出て、1往復できる |
| 3〜6週 | Cursor / Gemini CLI / Copilot CLI / Grok CLI / Piのアダプタ、push/turn/pull、A2A conformance kit | 8製品が同じ操作で一覧・送信・状態になる。A2Aクライアントから1セッションに届く |
| 7〜10週 | Grok Bot / Dot / Claude Remote ControlのA2Aブリッジ、自前hub（SSH/Tailscale）、Reasonブリッジ | 遠隔1製品と1往復。A2AクライアントからGrokBotに届く |
| 11〜13週 | 公開β、README EN/JA、LICENSE、CI、アダプタ登録所、A2A AgentCardの公開 | 第三者が説明どおりに動かし、アダプタを追加できる |

## 7. 確かめること（Yes/No）

1. 初見のMacで、アカウントなし、手動設定なしで、3製品が一覧に出る。
2. 生きている会話へ送り、返事を受け取り、4段階の状態を返せる。
3. 新しい製品の追加が、コアのコード変更なしで、manifest + フック1枚で済む。
4. A2Aクライアントが、seamless経由で生きているClaude Codeセッションを発見し、1往復できる。
5. A2Aの適合試験（AgentCard、message/send、tasks/get、push notification）が通る。
6. 遠隔の1製品（Grok Bot、Dot、Claude Remote Controlのどれか）と1往復できる。
7. 公開物にproprietaryなコード、アカウント固有情報、秘密が含まれない。
8. Reason利用者が、エージェント設定を変えずにseamlessへ移行または併用できる。

## 8. 停止条件

- A2Aの必須項目（AgentCard、message/send、tasks/get）が、ライブセッションの同一性と両立しない。
- 通常のユーザーが取得できない秘密やアカウントがないと、アダプタが動かない。
- 製品の内部APIを逆コンパイルする以外に道がなく、法務リスクを説明できない。
- push配送が信頼できず、「届いた」と表示することが嘘になる。
- チーム機能に中央のホスト型サービスかアカウントが必須になる。
- アダプタが増えるたびにコアが大きくなり、1人では維持できない。
- 90日で3製品の1往復とA2Aの1往復が通らない。

## 9. 人間の判断（Human gates）

- A2Aを前面に出すか、MCP hubとして地味に出すか。
- Grok Bot、Dotなど内部APIを使うアダプタの公開。
- 名前、ポジショニング、ライセンスの最終決定。
- 公開βとGitHubのpublic化。
- Reasonブリッジを「互換」と名乗るか、移行補助にするか。

## 10. 未決（AIが勝手に決めない）

- A2AのAgentCardをセッション単位にするか、マシン単位にするか。
- A2AのTaskと、seamlessの依頼IDをどう対応させるか。
- 遠隔の第一transportはSSH、Tailscale、Cloudflare Tunnel、Claude Remote Control、Grok Bot webhookのどれか。
- hubを常駐デーモンにするか、stdioのみにするか。
- チーム機能をv1に入れるか、個人に絞るか。
- v1の最小製品セットは3か5か8か。

## 11. 応援への依頼

次の観点で厳しく見てほしい。賛成意見は不要。

- A2A v1.0を軸にするのは、技術的にも事業的にも正しいか。過大評価か。
- 「A2A + MCP + manifest + 既存transport」で、Reasonに勝てるか。
- ライブセッションへの配送とA2AのTaskモデルの相性。
- 1人+コミュニティで維持できるか。v1の最小セット。
- 完全OSSのライセンス、標準化、コミュニティの進め方。
- 90日の段取りで、最初に失敗しそうな箇所。
