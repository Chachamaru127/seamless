# decisions（seamless）

## D1 【本人判断】オンライン機能は製品として持たない。2026-10-19
SSH 遠隔案、P2P、中継、郵便箱を取り下げ。Grok Bot の webhook だけが Mac の外へ出る。
Why: Reason と同じ網を作ると 1 人で保守できず、「持たない」が seamless の売り。採点上はオンラインで下がる（13 項目 3.82 対 Reason 4.14）が、思想として受け入れた。

## D2 【本人判断】v1 の相手は Claude Code、Codex、opencode、Cursor CLI、Antigravity CLI、Grok CLI、Grok Bot（webhook まで）。2026-10-19
Why: 手元に入っている製品は検証できる。Antigravity は実行ファイルが PATH に無く（evidence.md）、S5 で phase 2 へ送る条件つき。

## D3 【本人判断】Codex Desktop の内部 IPC を読取りに使い続ける。2026-10-19
Why: 公式の読取り口（openai/codex #54252）が無い。内部 API の再現として docs/release.md に列挙し、H6 の確認を公開条件にする。

## D4 【本人判断】Reason の比較導入は同じ OS ユーザー。2026-10-19
Why: 同じエージェント、同じ版で測るのが公平。backup の確認、順番に計測、終わったら leave → setup --remove で戻す。「別の OS ユーザー」案は設定分離が目的で、サンドボックスの意味ではなかった。

## D5 【本人判断】GitHub Issues + 30 分ループで実装を進め、施工は opencode の deepseek-v4.1-flash:1017。2026-10-19
ループは verify.sh 0 で作業ブランチに commit し loop:review まで。閉じるのは別家系の判定の後。push、PR、公開は H5、H6 の後。
Why: 閉ループ運用で止まらず進めるため。条件付き自走の契約（CI/CD 未整備なら commit 前で止まる）に対し、本人が「作業ブランチへの commit まで」を明示的に許した扱い。

## D6 【AI の判断（戻せる）】Claude の主経路は Channels ではなく公式の cross-session messaging socket。2026-10-19
Why: 公式文書が socket と env を「スクリプトから投稿する」用途で公開した。Channels は research preview で ACK が無く、カスタム channel は対話セッション限定。

## D7 【本人判断】名前は seamless、npm は @chachamaru127/seamless、MIT、repo を public に切り替える。2026-10-20
Why: npm の `seamless` は他人の 1.4.2 が取得済み。`@chachamaru127` は harness-mem を出している scope で説明が要らない。既存の repo、URL、Nestra の packages/seamless の参照を捨てない。

## D8 【本人判断】規約は、公式経路は文書引用、内部依存 2 件（Grok Bot webhook、Antigravity）は本人が目視。専門家は phase 2 の玄関口で。2026-10-20
Why: 公式経路は公開文書の範囲で争点が無い。内部依存は v1 で 2 件に絞ってあり、1〜2 時間で終わる。全経路を専門家に回すと公開が日数単位で延びる。

## D9 【本人判断】Reason との比較実測（#20）は AC7 の 15 往復の後。2026-10-20
Why: Reason の setup が各エージェントの hooks と plugin を書き換えるので、seamless 単体の正確さを先に実測し、欠陥と配線の干渉を切り分ける。
