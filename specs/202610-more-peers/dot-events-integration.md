# Dot と MCP Events の内包案

更新: 2026-10-09 JST。
状態: 10月9日の追加分を含む非接続試作21試験と独立判定PASS。本体と実機は未検収。
Q5 の具体案は判断待ち。
本体の Dot 実装と接続設定は未変更。

## 2026-10-09 の方針連絡と今回の範囲

Claude の担当会話から `dot-decision-20261009` で、次の3点を推奨どおり進めるとの連絡を受けた。
元会話の本人の発話は2026-10-09T04:46:22.648Zの「まだできないこと 進めて」。
これはreadで確認したが、3点それぞれへの直接回答は確認できていない。
その後、10月9日に本人から「Dot の作業をコミットして」と直接指示を受けた。
以下は担当会話からの方針連絡であり、この文書で本体実装や実接続の承認を発行しない。

1. seamless は Mac から Dot への通知だけを持つ。Dot から Mac への流れはseamlessに追加せず、「自分のパソコン」の許可によるローカルCodexタスクの作成と継続を使う案。Q5は購読できる主体の識別に絞り、以下の旧HTTP＋OAuth推奨は進めない。
2. 測定M1は第1段の画面の読み取り確認、非接続スタブ、tunnel-clientの版の特定まで。ダウンロード、tunnel作成、実行は第2段の明示的なgoまで行わない。
3. H10: Dotへの配送は事前承認に含めず、初期は1件ごとに本人が確かめる案。既存の同じMacの会話間の承認と混同しない。

Dotと通常のChatGPTの会話を区別できる認証値が届くかは未観測。
Dotが作ったローカルCodexタスクをseamlessが扱えるかも未確認。
M1の実測で埋める。
AC11aの「受ける意思の確認」は、callbackが署名されたchallengeに応答できることの確認。
これは人が内容の送信を承認した証拠ではない。

今回進めるのは非接続試作の4点の修正と検証だけ。
同じsecretの購読更新失敗、DNSの危険な解決先と再解決、10秒での通信打切り、宛先なしで予約を消費しないことを対象にする。
`src/`、実通信、設定、M1、Codexプラグインのファイルは触らない。
本体への統合は未実施。非接続試作と文書は10月9日の本人指示でローカルコミットに保存する。
新しい検証記録は `.local/dot-events/20261009-fixes/` に残し、10月8日の判定原文を上書きしない。

追加した4場面を含む試作21件と型検査は実終了0。
本体464件と帯99件も実終了0。
今回の全コマンド、実終了コード、試作コードの前後hashは `.local/dot-events/20261009-fixes/checks.json` にある。
Claude Opus 5.5 highは試作の判定PASS、Claude Haiku 5.5 mediumは範囲と記録の照合PASS。
判定役の範囲外だった出力hashと現在のコードhashはリーダーが再計算し、全件一致した（同フォルダの `integrity.json`）。
原文は `review.out`、`drawing.out`、`drawing-recheck.out`。
記録の保存先を1か所誤ったが、10月8日の `checks.json` は保存済みの原文から完全一致で復元した。
訂正経緯は `record-path-correction.md` に記録した。
DNSの拒否と接続先の照合は注入した偽物での検証であり、実DNSやTLSソケットの実装ではない。
10秒の打切りは実タイマーでAbortSignalを発火し、未応答のmockが中断したことを確認した。
同じsecretの再確認失敗では既存の有効期限を延ばさず購読を保ち、secret変更の失敗では停止を維持する。
宛先が無くPOSTしていないときは予約を消費しない。POST後の成否不明は再送しない。

[公式説明](https://learn.chatgpt.com/docs/dots/computers-and-apps)の2026-10-09取得版で、許可したパソコンにDotがローカルのWorkまたはCodexタスクを作り、既存のローカルCodexタスクを続けられることを確認した。
これはseamlessでそのタスクを認証できた証拠ではない。

以下の10月8日の往復構成とHTTP＋OAuth案は検討経緯として残す。
現在の実装指示として扱わない。

## 10月8日の検討案: 完成後の使い方

Claude、Codex、Grok の会話から登録された Dot へ依頼を送り、Dot が通知で動き、元の会話へ返信する。
依頼 ID と replyTo で対応を追う。
seamless は配送を担い、担当選びと仕事の実行は Dot が担う。
100% はローカル実装、回帰試験、別の家系の判定、実機での発見と購読と両方向の返信がそろった状態。

今回の依頼は [AI駆動経営ラボの記事](https://x.com/yoshio_nocode/status/2108111375704695191) を読んで Dots を MCP Events に対応させ seamless に内包すること。
記事全文をブラウザーで読んだ。
記事の配布プロンプトは LINE 登録と送信が必要なので取得していない。
記事内の動画の稼働をこちらの製品の実証として扱わない。

| 記事の要素 | seamless での扱い | 理由 |
|---|---|---|
| MCP Events で Dot を起こす | 採る。Dot 用入口にイベントの発見、購読、解除と署名つき HTTPS 配送を追加 | 人が毎回 Dot に確認を頼む手間を減らす |
| Dot が担当へ依頼する | 採る。Dot が既存の sessions/read/send を呼ぶ | 不変条件3の「配線だけ」を保つ |
| 元の会話へ追加指示する | 既存機能を利用。Dot の認証済み呼び手を同じ配送核へ接続 | 元会話と別の実行体を取り違えない |
| 進捗と成果物を受け取る | 既存の4段と replyTo を利用 | webhook の 2xx を処理完了にしない |
| カンバン UI と別セッションの自動起動 | 今回の内包範囲に含めない。必要なら別仕様 | 本体の目的は会話間の接続。記事のUIと指揮機能を配送核へ混ぜない |

## 10月8日時点で確認できた現在地

調査対象の本体の版: `af9df0e14106fb072ac3ba5d44be34146233f972`。
10月8日時点の成果物は未commitのローカル変更だった。
最新の回帰試験は別作業のGrok hook修正が入った `d784be843153737d6edd47aa9771dc79b5e10bb7` で実行した。
今回の試作コードのhashは試験前後で一致した。
本体454件と帯98件がPASSし、`bash scripts/verify.sh` はexit 0。
試作17件と型検査と独立Python署名計算もexit 0で、実行コマンドと出力hashは `.local/dot-events/checks.json` にある。

`node .local/dot-events/probe.mjs` は exit 0。
createMcp に会話を見ない試験用 automatic を渡し、実会話、実宛先、秘密、外部 POST を扱っていない。
証拠は `.local/dot-events/probe.out`。

| 呼び出し | 観測 |
|---|---|
| initialize で `2026-07-28` を要求 | `2025-06-18` が返る。Events の能力宣言なし |
| server/discover | -32601 unknown_method |
| events/list、events/subscribe、events/unsubscribe | 3 件とも -32601 unknown_method |
| tools/list | sessions/read/send/limits/status_panel の5つが返る |

これは未対応の確認であり、Dot 機能の合格試験ではない。
既存の機能仕様では AC11a〜c は承認済みだが、Q5 を決めるまで Dot 実装を始めない。
根拠は [spec.md](spec.md) の状態欄、AC11c、Q5 と [evidence.md](evidence.md) の T3-3。

## 10月8日のQ5案: 呼び手を確かめる方法

固定の環境変数キーを渡す stdio 方式は採らない。
OpenAI の Tunnel client は stdio の全論理接続で同じ子プロセスを共有する。
そのキーは起動時の設定を示すだけで、どの遠隔接続から来たかを示さない。
Tunnel の制御面 API キーも、Dot が名簿の登録に対応する証拠にはならない。

推奨案は、Dot 専用の Streamable HTTP（HTTPでMCPを運ぶ入口）に OAuth 2.1（利用者がログインして接続の権限を認める方式）を付ける構成。
入口は loopback に置き、Secure MCP Tunnel が外へ運ぶ。
接続元の Authorization ヘッダーは HTTP の入口へ転送される。
Claude と Codex の stdio 入口は引き続き 2025-06-18 を使う。

認証された接続の扱いは次のとおり。

1. OAuth token の issuer（発行元）、audience（対象サーバー）、期限、権限、失効を検証する。
2. 検証済みの利用者と認可 grant（その接続へ与えた権限の識別子）を、本人が認めた名簿登録1件に結び付ける。道具の引数や _meta の名乗りで登録を選ばせない。
3. 購読の作成、更新、解除と Dot → Mac の read/send のすべてで同じ束縛を使う。権限と範囲は名簿と既存 limits の交差にする。
4. 名簿失効と接続解除で購読と送信を止める。更新された token は同じ認可 grant の登録を引き継ぐ。
5. Standard Webhooks の購読 secret は seamless → ChatGPT の署名にだけ使う。呼び手の認証に使わない。

DCR（接続時に OAuth client を登録する方式）の client_id は接続ごとに再利用される。
一方 CIMD（公開文書で client を識別する方式）の client_id は ChatGPT 共通の識別子になりうる。
client_id だけを Dot の登録 ID にしない。
OAuth の発行元と認可 grant の実装を定めてから、別接続の分離を検証する。

### 本人に確定してもらう仕様

**OAuth で認証した ChatGPT 接続と名簿登録を結び、「Dot の登録への配送」として実装する案を推奨する。**

何が変わるか: ローカル祖先プロセスで呼び手を特定する現行方式に、HTTP 接続の OAuth 認証を足す。
Dot へ通知し、認証された登録から元会話へ返信できるようになる。

本人から見た変化: 最初に接続の認可と名簿登録を行う。
その後は会話から依頼と返信を扱える。
Mac が offline の間の受信と、期限切れイベントの再生は保証しない。

仕様への影響: 「特定の Dot の既存会話 ID への配送」は保証しない。
公開資料で認証された Dot 会話 ID を確認できないため。
別アカウントと別の認可 grant が他の登録に混入することは拒否する。
盗まれた bearer token の再利用まで通常の OAuth で防げるとは宣言しない。
token 自体の盗難も防ぐ要件なら、送信者を鍵で拘束する追加方式の対応確認が必要になる。
実装を差し替えることはできるが、OAuth認可とTunnel設定は本人の操作として別に扱う。

認証方式の名称だけで Q5 を済みにしない。
OAuth 発行元、本人の認可画面への到達経路、認可 grant を登録に結び付ける実装、実機での接続分離が未確認。
Tunnel は OAuth のブラウザー用認可サーバーを自動では中継しない。
この案の HTTP 待受と Tunnel 設定は、機能仕様の停止条件「待受サーバー、公開 URL、常駐処理、接続設定の変更」に該当する。
方式の承認と実際の入口を有効にする承認を区別し、有効化の前に対象と設定を確定する。

## 10月8日案の実装順と検収

先行できるローカル試作は [experiments/dot-events](../../experiments/dot-events/README.md) に置いた。
署名の固定ベクトル、発見の応答形、偽のprincipalが無いときの拒否、署名されたchallenge、購読の再起動後の保持、購読IDの再利用、期限と失効、secret更新時の再確認、POST前の予約、同時送信と再起動後の再送防止を試験した。
`node --test experiments/dot-events/events.test.ts` は17件PASS、exit 0。

これは本体からimportしない試作で、実OAuthとHTTP transportを持たない。
callbackは `.invalid` の固定の試験URLだけを受け、postはテストの偽物。
試験で使う公開の署名値以外の鍵は扱わない。
AC11a〜cの実装進捗と実機合格には数えない。

この先行試作で触るパス: `experiments/dot-events/{README.md,events.ts,events.test.ts}`、この内包案、ルート `spec.md` と `Plans.md` の参照と現状、`specs/202610-more-peers/spec.md` の Q5 表記訂正。
Q5 の表記は既存の「AC11a〜c 全体を止める」という承認条件に合わせ、条件は緩めない。
製品実装の候補パスとは別で、`src/` と `scripts/verify.sh` は変更しない。

| 工程 | 作るもの | 完了条件 |
|---|---|---|
| 1. Q5 の確定 | 認証付きHTTP入口、名簿と認可 grant の束縛、失効、利用範囲 | 別アカウント、別grant、名乗り、失効、誤audienceを拒否。発行元と認可経路を確定 |
| 2. Events の核 | 2026-07-28 discovery、events/list/subscribe/unsubscribe、私有購読保存 | AC11a。再起動、期限切れ、secret更新、callback確認を検証 |
| 3. Dot の配送 | Standard Webhooks署名、POST前の永続予約、replyTo照合 | AC11b/c。1回配送、5xx/timeoutで成否不明、再送なし、4段を混同しない |
| 4. 既存配送との接続 | 本人が名簿に登録した Dot の登録を配送核へ追加、Dotから元会話へread/send | scopeとlimitsを適用。Claude/Codexの旧入口の版を維持。verify.sh exit 0 |
| 5. 独立判定と実機 | 別家系の読み取り専用判定。本人が許可したTunnelとDot購読 | 発見、購読、callback確認、Claude/Codex→DotとDot→Claude/Codexの返信を別々に実測 |

触るパスの候補: `src/dot-auth.ts`、`src/dot-mcp.ts`、`src/dot-events.ts`、`src/dot-webhook.ts`、`src/external-peers.ts`、既存の `src/{cli,mcp,automatic,protocol,request-store,status}.ts`、対応する `tests/` とこの機能のspec/Plans/tasks/evidence。
候補であり、現行 tasks.md の実装承認範囲に自動追加しない。
Q5 を決めた時点で同じ機能の計画に統合する。

安全な callback 配送は AC11a の承認済み条件を維持する。
HTTPS、公開IPの検証と接続先固定、TLS の元hostname照合、redirect拒否を確認と配送の両方へ適用する。
イベント本文は 256 KiB 以下。
署名は本文を一度だけ直列化し、その同じバイト列を送る。
本文を保存する新しい待ち行列は今回追加しない。

試作のJSONに入る署名値は公開のfixtureだけである。
本体の購読JSONへ本物のsecretをそのまま移す仕様にはしない。
本体では本人が認めた秘密管理の場所にsecret本体を置き、購読側は版と参照だけを保持する案とする。
MacのKeychain（OSが管理する秘密の保管場所）を候補にするが、実際の登録と読取りは今回行っていない。
この保管方法も、本体へ取り込む前に確定する。

公式ガイドには一時失敗の再試行推奨があるが、seamless の不変条件6は成否不明の自動再送を禁止している。
本件では後者を維持する。
2xx は callback の受理だけを示す。
処理開始と返答は別の証拠が必要。

## 出典と確信度

### Codex 内の状態パネル（2026-10-08 の追加意向）

本人の「これ使ってCodex側もUI出したいよね」を受け、Dotの配送とCodexの表示を同じseamlessの構成として扱う案を追加する。
プラグインの公開申請、インストール、接続設定変更の承認としては扱わない。

| 部分 | 役割 | 次の確認 |
|---|---|---|
| MCP Events | Dotへ通知を届ける | Q5の認証方式を確定してから本体と実機を検証 |
| MCP Apps | Codex内で状態を見るHTML画面を提供する | 既存の `ui://seamless/status` を再利用し、実機で入口と道具呼出しを確認 |
| Plugin package | MCPと必要な手順をCodexが認識できる単位にまとめる | ローカル配布面で表示を確認してから公開の要否を決める |

現在の `src/status-panel.ts` は読み取り専用の道具 `status_panel`、UI資源、会話ごとのパネルの入口 `thread` を宣言している。
2026-10-09の追加確認: Codex向けの包み `codex-plugin/seamless-status` はコミット `b5f3352` で作られている。
このコミットは現在の本線の祖先で、manifestに `.mcp.json` と読み取り専用UIの説明があることを確認した。
今回この包みを変更、インストール、有効化していない。
これはコードで確認した事実であり、今回のCodexアカウントで画面が出るという実証ではない。
既存のC1記録では2026-10-05の実機でタブが出なかった。
現在の実機表示は再確認していない。
パネルからの呼出しでも元会話を認証できることを確認し、名乗りによる回避を入れない。

推奨する最初の表示は相手の会話、依頼ID、受理、到達、処理開始、返信、観測時刻。
既存仕様どおり表示と照会だけにする。
送信、再送、承認のボタンを追加する場合は、状態UIの仕様変更として別に確定する。

公式の[Package your plugin](https://developers.openai.com/plugins/build/plugins)は、ローカルmarketplaceでの開発と私有配布を公開ディレクトリと分けている。
[Extensions](https://developers.openai.com/plugins/build/extensions)は会話横パネルの `thread` 入口を定義する。
[Add UI](https://developers.openai.com/plugins/build/chatgpt-ui)は `_meta.ui.resourceUri` とMCP Appsの橋渡しを定義する。
本人のリンク先[Upload and submit](https://developers.openai.com/plugins/deploy/submission)はChatGPTとCodex共通の公開ディレクトリへZIPを申請する手順。
公開申請は最初の表示試験の前提にしない。
将来公開する場合は、公開HTTPS入口など公開申請の要件を別に評価する。

### Dot 調査の出典

- 記事は2026-10-08に全文読取り。設計の原理だけを採る。著者の成果物はこちらで検証していない。
- [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events): Dot 対応、MCP 2.0、webhook、認証、署名、購読、callback検証。2026-10-08取得版。草稿の拡張は既存specが固定する [SEP-3415 の commit 6859def4ba24ab41678d0e6799fe3f4c84228f9a](https://github.com/pja-ant/modelcontextprotocol/blob/6859def4ba24ab41678d0e6799fe3f4c84228f9a/seps/0000-events-extension.md)を参照。
- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels): Tunnelの認証境界とOAuthのブラウザー経路。
- [OpenAI Authentication](https://developers.openai.com/plugins/build/auth): OAuth、DCR/CIMD、ChatGPTがcustom API keyを提示できないこと。
- [Tunnel共有stdio](https://github.com/openai/tunnel-client/blob/d8e4929cf3f30bdb2794b245facca199b2848160/pkg/mcpclient/shared_connection_transport.go#L47)、[認証ヘッダー転送](https://github.com/openai/tunnel-client/blob/d8e4929cf3f30bdb2794b245facca199b2848160/docs/connectors.md#L124)。commit固定。
- 実機の既存Tunnel clientは `0.0.9+62b9b42f698ec5319d2115e0c0ff1dcf6557d7ae`。起動と設定変更はしていない。

確信度: Eventsの必要性とstdio認証の限界はhigh。
OAuth構成の実機適合とDotの返信は未検証でmedium。
製品の内包完了は主張しない。

独立調査: Codex explorer。
独立の設計相談: Claude Opus 5.5 high、読み取り専用。
Q5は判断待ち、HTTP/OAuthへの変更は本人が確定する必要ありとの結論。
stdio固定キーを採らない点と、Dotの個体ではなく接続登録を扱う点は一致。
非接続試作は条件付きで先行可と判定した。

試作の独立判定は Claude Opus 5.5 high が条件1〜6をPASSとした。
図面の再判定は Claude Haiku 5.5 medium が前回のF1〜F3をPASSとし、新規FAILなしとした。
再判定の根拠は実終了コード、独立Python署名計算、文書の訂正と試作コードの版の記録。
証拠は `.local/dot-events/{recheck.out,drawing-recheck.out,checks.json,vector.out,legacy-verify.out}`。
判定の対象は非接続試作と文書の整合であり、実OAuth、HTTP入口、本物のcallback、Dot実機は未検証。
これは10月8日の判定時点の残件。10月9日の非接続試作では、送信先が無くPOSTしていないときは予約を消費しない扱いを検証した。
本体へ取り込む前には、その扱いの採用と秘密の保管方法を機能仕様で確定する。

相談の未読だった公式資料は、独立調査で補った。
HTTPのAuthorization転送は対応している。
OAuthのブラウザー認可サーバーをTunnelが自動で公開するという前提は採れない。
公開URLや新しい運用が要る場合は、既存の外部公開の停止条件に従う。
AC6はseamless自身が依頼を自動増殖させない検証として維持し、Dotの自律的な追加依頼まで許可済みにしない。
