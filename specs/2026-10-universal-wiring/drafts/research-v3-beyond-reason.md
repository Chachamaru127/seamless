# 調査記録 v3: seamless を Reason Network より上にするための事実（2026-10-19）

team-research（L）。リーダー: Claude（この会話は Fable 5.1。route-shift の記録上は claude-opus-5-5／high）。
応援: Codex gpt-6.1-sol（逆家系の一次資料調査。web 検索つき。chatgpt-2 契約で実行）、Grok 4.7（X 調査。required）。
問いと範囲は末尾。承認前の調査記録で、製品仕様の正本ではない。

## 結論 3 行

1. Reason を「同じ土俵で」超えることはできない。チーム名簿、10 製品、P2P 網は Reason の本体で、1 人では追えない。
2. 超えられる軸は 4 つある。届いたの正確さ、本文を持たない、常駐も名簿も中継もなし、ベンダー公式の網（Claude の cross-session、Codex の queue、Grok Bot の webhook）を**組み合わせる**配線。Reason は自前の網を作る。seamless はベンダーの網を束ねる。
3. 統合プラン v2 は 2 点を直す。Claude の主経路は Channels ではなく、公式になった cross-session messaging の socket。Codex の `codex queue` は「保存された」までしか返さないので、seamless の到達証拠が差別化になる。

## 事実（出典つき。取得日はすべて 2026-10-19）

### A. ベンダー公式の経路が増えた（統合プラン v2 の前提が古い）

| # | 事実 | 出典 | 状態 |
|---|---|---|---|
| A1 | Claude Code は v2.1.224（2026-08）から公式の cross-session messaging を持つ。同じ Mac は per-session の Unix socket、別マシンとクラウドは Remote Control 経由（Anthropic サーバーを通る。claude.ai サインイン限定、API key 不可）。 | code.claude.com/docs/en/cross-session-messaging | 確認済み |
| A2 | socket の場所は `CLAUDE_CODE_MESSAGING_SOCKET` としてフックと Bash に公開される。文書に「スクリプトやフックからセッションへ投稿したいとき」の節がある。ディレクトリは `/tmp/cc-socks-<uid>`。トークン `CLAUDE_CODE_MESSAGING_TOKEN` は macOS では任意。 | 同上「The session's inbox socket」 | 確認済み |
| A3 | 配送は「ツール呼び出しの間」に読まれ、idle なら新しいターンが始まる。「Delivery is not guaranteed」と明記。受信側は `crossSessionInbound` の accept / hold / refuse。bypass モードの組み合わせで既定が hold になる。100 件保持、50 件キュー、同一文の連投は落とす。 | 同上 | 確認済み |
| A4 | Reason の Claude への push は、この同じ socket に `{"type":"user",…}` を書く方式。Channels と asyncRewake フックは fallback。 | reason-network DESIGN.md「getting messages into agents」 | 確認済み |
| A5 | seamless 現行の Claude アダプタも同じ socket と `~/.claude/sessions/<pid>.json` を使う。 | src/adapters/claude.ts | 確認済み |
| A6 | Codex CLI 0.163.0（手元）に `codex queue --thread <UUID|名前> --message <TEXT>` がある。`--remote ws://…` で遠隔の app-server にも送れる。 | `codex queue --help` 実行（2026-10-19） | 確認済み |
| A7 | `codex queue` は保存した時点で exit 0 を返し、消費されたかは分からない。返信を読む公式手段がなく、要望 issue が未回答で open。 | github.com/openai/codex/issues/54252（2026-10-15） | 確認済み |
| A8 | Codex Desktop で `/goal` 実行中は queue が消費されず、手動 Steer が要る。Desktop の app-server は private な子プロセスで外から `turn/steer` できない。 | github.com/openai/codex/issues/52705（2026-10-09、open、bug ラベル） | 確認済み |
| A9 | Codex app-server は JSON-RPC（stdio / WebSocket / Unix socket）。`thread/resume` + `turn/start`、`turn/steer`、`thread/items/list` がある。「experimental、本番非推奨」。自分が起動した server の thread にしか効かない。 | learn.chatgpt.com/docs/app-server | 確認済み |
| A10 | Claude Code Channels は research preview。カスタム channel は allowlist 外で、`--dangerously-load-development-channels` を**対話セッションでだけ**受け付ける（`-p` では無視）。通知に ACK はなく、busy 中は次ターンにまとめて届く。 | code.claude.com/docs/en/channels-reference | 確認済み |

### B. Reason Network の構造（変えにくい点と、既に持つ点）

| # | 事実 | 出典 | 状態 |
|---|---|---|---|
| B1 | 端末ごとに 1 デーモン、iroh（ed25519 鍵、LAN → ホールパンチ → n0 の公開中継）。中継は暗号文だけを見るが、既定で n0 に接続する。 | DESIGN.md、README | 確認済み |
| B2 | 名簿は全端末に複製。誰でも招待と除名ができる。除名された端末は「暗号的に無力にはならない。this is for friends」。 | DESIGN.md | 確認済み |
| B3 | ask_user の承認署名は「speed bump, not a guarantee」。 | DESIGN.md | 確認済み |
| B4 | 不在セッションの郵便は 1 日で破棄。フルメッシュは約 50 台まで。 | DESIGN.md | 確認済み |
| B5 | 受信側の ack は `stored | delivered | held | refused`。`send_message` は `delivered / queued / held`。「delivered」が「読んだ」を意味するかは未定義。issue #24「bypass の Claude が hold しているのに送り主に delivered と言う」は 2026-10-18 に閉じられ、DESIGN は `pushed` + 「held by Claude Code」の注記に変わった。 | DESIGN.md、issues #24 | 確認済み |
| B6 | SQLite に郵便箱と状態を保存する（本文を持つ）。 | DESIGN.md | 確認済み |
| B7 | エンジンは MIT OR Apache-2.0 で、`reason-network` CLI（init / join / who / send / listen / mcp / relay / doctor）も OSS。非公開なのは製品の `reason` CLI。**アカウントなしの team link モードがある。** 前回レポートの「CLI は非公開」「アカウント必須」は、この範囲で訂正が要る。 | README | 確認済み |
| B8 | 公開 issue は 7 件、すべて 1 日以内に閉じている（Windows、OpenCode 2.x plugin、非 ASCII 名、名簿の順序バグ、ask_user の証明）。open 0。452 stars / 36 forks / 132 commits。 | github issues 一覧 | 確認済み |
| B9 | 公式サイトの速さ「短い返事は 1.5〜2 秒。大半はモデルの思考」は `reason network serve` の warm agent の話で、既存会話への配送時間ではない。 | reasonmachines.com/network | 確認済み |
| B10 | Hacker News、Reddit に独立したレビューは見つからなかった（検索 1 回）。X は公式の発表投稿のみ検索で出た。 | WebSearch 2026-10-19 | 未確認（網羅していない） |

### C. この分野で定着しなかった理由（類似製品の事例）

| # | 事実 | 出典 | 状態 |
|---|---|---|---|
| C1 | agmsg（Claude↔Codex の会話ツール）は 3 週間で手打ち 9 回、メッセージ DB に会話 1 件、7 週間後にアンインストール。「人間が手で起動するツールは死に、走っている中から呼べるものが生きた」。 | zenn.dev/kaz_hira/articles/multi-agent-env-3weeks-measured（2026-10-03） | 確認済み |
| C2 | agmsg の運用で 3 分ごとに Codex を起動し、約 3 時間で約 60 会話、メモリ不足。空振り起動のコスト。 | github.com/fujibee/agmsg/issues/163（2026-06-19） | 確認済み（Codex 応援の報告。リーダー未再確認） |
| C3 | Codex の `/goal` 中は外部 queue が待ち続け、手動 Steer が要る。公式入口でも「受理 ≠ 読んだ」。 | A8 と同じ | 確認済み |

## 応援の答え

### Codex gpt-6.1-sol（逆家系、一次資料）

採用:
- 「公式経路への移行は保守性に効くが、Reason も同じ公式経路を使うので速さの優位は断定できない」。根拠 A4、A6。
- 「Channels は ACK がなく黙って落ちるので、返信ツールでの相関が要る」。根拠 A10。
- 「`codex queue` は登録と消費が別。CLI 終了 0 を到達にできない」。根拠 A7、A8。
- 「A2A は既存 CLI 会話へ注入する口ではない。アダプタは残る」。根拠 a2a-protocol.org v1.0。
- 優先案 1（配送証拠を ID で照合）、2（今の画面から依頼と返信確認）、4（閲覧・送信・起動・承認の分離）。
- 「Reason の『CLI 非公開』は製品 CLI の話で、エンジンにも CLI がある」。B7 の訂正。

見送り:
- 優先案 5「Reason との橋渡しで獲得」。需要未検証で、二重配送と権限変換の危険が大きい。v1 では「併用の注意」までに留める（前回レポートと同じ）。

要確認:
- 「Reason の送り主ごとの hold と loop guard は 2〜5 人で弱点になりにくい」は妥当だが、本人の用途（1 人 + Bot）では評価軸が違う。

### Grok 4.7（X 調査、required。到着 18:4x。X の投稿はリーダー未再確認）

採用:
- 乗り換えの決め手は「画面操作とコピペをやめる」「同僚の枝（repo、branch）が見える」「公開エンジン」。しょうへい氏は Computer Use の遅さから乗り換え（x.com/showheyohtaki/status/2111209287460815092、2026-10-16）。焼山氏は「同じフォルダへ数秒で push、8 秒」（x.com/8kyama/status/2112065669722419260、2026-10-19。1 人の 1 計測）。
- 「受理をツール許可にするな」（hexablob 氏、x.com/hexablob/status/2111725409679355968、2026-10-18）。seamless の不変条件 3（届いた文は承認の代わりにならない）と一致。
- agmsg 作者は「公式モニターが 30 分で切れるため socket と queue を選んだ」（x.com/fujibee/status/2110875185763283324、2026-10-15）。Claude の socket と `codex queue` を主経路にする判断と一致。
- 案 4「1 日で消える郵便を真似しない。不在は未着として返す」、案 5「処理開始が無ければ成功と言わない」。v3 の軸 1 と H6 に一致。
- Claude Code 純正の cross-session でも「届かずに成功」の報告（anthropics/claude-code #25135、2026-02-12）。公式経路でも証拠が要る根拠。
- 「公式経路だけなら、より壊れにくく同等以上に速い」は 2026-10-19 の公開仕様では成り立たない（Codex 応援と同じ結論）。

見送り:
- 案 2「2〜5 人向けに repo、branch、busy の名簿を既定 hold で足す」。名簿そのものを持たず、SSH の hosts 一覧で遠隔の `who` を呼ぶ形（計画 v3 の 3 節）で代える。理由: 自前の名簿は漏洩面になる（Grok 自身の危険の指摘）。
- 「Claude の socket は暫定」。公式文書が socket と env を「スクリプトから投稿する」用途で公開しているので（事実 A2）、暫定ではなく「文書化された挙動」として扱う。ただし安定 SDK ではない点は同じ。

要確認:
- 大田原氏「Orca で足りる」（x.com/cursorvers/status/2112083831368847470）。Orca（本人も使う worktree 管理アプリ）との役割分担を README に 1 行書くか。
- Tincan 0.18 の電話承認（x.com/mvanhorn/status/2111665525768311227）は Reason への同梱が未確認。

## 食い違い

- Grok は「Claude の socket は暫定」、リーダーは「文書化された挙動」。根拠は A2 の公式文書。両者とも「安定 SDK ではない」では一致。

- 前回レポート（2026-10-19 午前）は「Reason はアカウント必須、CLI 非公開」と書いた。README はアカウントなしモードと OSS の `reason-network` CLI を明記している（B7）。前回の採点「導入 5.0」「OSS 配布 4.0」は変えないが、「アカウント不要が seamless だけの売り」は成り立たない。
- 統合プラン v2 は「Claude の主経路は Channels」とした。A1〜A4、A10 から、主経路は cross-session の socket（公式文書あり、`-p` でも動く）で、Channels は外部イベント用の補助にする。

## 問いと範囲

1. Reason が持っていて seamless が持たない価値のうち、個人と 2〜5 人に効くものは何か。Reason の設計上変えにくい弱点は何か。
2. 公式の押し込み経路で、Reason より壊れにくく同等以上に速い配線が作れるか。
3. 乗り換え、併用の決め手は何か。
調べない範囲: 実装、侵入試験、法務の確定。harness-mem の検索は CLI の引数が合わず未実施（`harness-mem search` が「Unknown option」）。repo の `.claude/memory/` は存在しない。
