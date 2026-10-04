# 探索共通部の実装計画

承認範囲: 2026-10-02、本人の概ねOKとteam-plan / team-build指定。既存計画P1を具体化する。初版の通信本体を完成と報告しない。
作業規模: L。対話中のモデルと推論量は維持。

## 実装とパス

- Node.js 22.22.x / TypeScript。外部パッケージ追加なし。Nodeの型除去で実行、利用可能なtscは補助チェック。実行試験はnode:test。
- `src/protocol.ts`：共通型と入力検査。
- `src/git-context.ts`：引数配列でread-only gitを呼ぶ。実pathと共通git場所を照合、URL / .env / 履歴本文を読まない。失敗はunknown。
- `src/registry.ts`：1つの正本bootstrapを要求ごとに読み直すメモリ名簿。登録キー、native ID、世代、向き付き許可を保持。資格情報と本文の項目、保存APIは持たない。
- `src/discovery.ts`：対称の候補分類と選択、同順位の曖昧性、binding発行と再照合。時刻、live observationを注入可能にしてテストする。
- `src/mcp.ts`：stdio JSON-RPC、initialize、tools/list、tools/callのsessions。read/sendは今回登録しない。未実装操作を成功させない。
- `src/cli.ts`：単発contextとsessions、およびJSON Linesを受ける持続serveモードを提供。serveの同一プロセス内でselectとrevalidateを共通部へ接続する。単発select / revalidateは提供しない。名前を実行せずJSON結果として返す。
- `tests/`：先に契約試験を失敗させ、実Git fixtureと実子プロセスで検査。
- `scripts/verify.sh`：ローカルの新規試験。元の実モデル試験を自動再実行しない。
- `README.md`, `docs/reports/`：操作、metadata正本、未導入、次のP2以降を明記。

名簿を読むことは相手への通信開始ではない。MCP起動ごとにcallerの登録キーを--caller引数から固定し、tool引数のsenderは拒否する。metadataであり認証の証明ではないGit作業場所と、認証された登録主体を分離する。任意のJSONを渡せる同じOSユーザーが名簿を書き換えれば設定を変えられる。これを別OSユーザーとの認証保証と呼ばない。

候補のmetadataは毎回観測部を経由し、freshnessの上限60秒。bindingはメモリ内で保持し60秒で失効。再照合は明示的に最新観測を呼ぶ。プロセスの起動時刻とnative会話の世代は信頼したnative観測器の結果で照合する。bootstrapの世代値だけでは観測済みとしない。今回はnative観測アダプター未接続ならunknownとして選択できない。試験専用observationを製品の稼働証明にしない。

bootstrapにstatus / timestampの項目はない。入力されたら未知項目として拒否する。信頼した観測アダプターだけがnative IDと世代を照合して稼働状態を返す。今回は製品用アダプター未接続なのでunknownが正常な結果。試験専用の注入はテスト内だけに置き、CLI / MCPの入力から有効化できない。

bindingはserveプロセス内にだけ存在する。発行callerのIDと世代、要求操作、scope、双方の観測作業場所を保持する。別プロセスに渡して復元しない。再照合は有効期限、双方の登録と認可、世代、最新観測を検査する。

## 検証

`bash scripts/verify.sh`がD1〜D6を検証する。実Git fixtureはOSの一時ディレクトリ内だけに新規作成。fixture内のgit commitは試験データの準備に限り、製品や親repoのcommit / push / deployはしない。作業ツリーの元ファイルを削除しない。

## Human gates

今回のローカル実装と一時fixture試験は承認済み。既存業務会話を実際に登録して本文を公開すること、試験送信、グローバルMCP設定配送、外部公開、親repoのGit境界変更は含めない。

## 体制

Haiku4.5 medium：必須の図面検査。Opus5.5 xhigh：逆家系の計画穴探し。施工はGit作業場所の読取部と名簿/選択部を別ファイルに分ける。最終は逆家系の独立判定でD1〜D6の証拠を見る。本人が指定したスキルと現行intent.jsonを優先し、旧CLI-routingに残るFable推奨やMac全体の保守ルールをこのrepoの承認済み実装へ拡張しない。

## 状態と定数

観測の有効期限とbinding寿命はprotocol.tsの60,000ms定数へ集約する。discoveryはdisplayNameを表示用投影にだけ使い、条件、順位、認可へ使わない。会話本文は入力として受け取らない。

bindingはissued → checking → consumed / invalid、およびissued / checking → expired / supersededの状態を持つ。同じcaller-targetの新bindingは旧bindingをsupersededにする。revalidate成功時はconsumedとして一度だけ利用できる。P1の結果は送信済みを意味しない。停止や世代変更などの再照合失敗はinvalidにして再利用しない。

## Opus指摘の実装条件

- gitは--no-optional-locks、core.fsmonitor=false。GIT_*環境変数を除去し呼出し5秒timeout、出力上限1MiB。dirtyにuntrackedを含め、失敗はunknown。
- createServe({observer, clock, registry})を製品入口と試験専用入口で共有する。製品入口にはunknown observerだけを渡す。tests/supportの試験プロセスだけが観測を注入する。環境変数、引数、bootstrapからobserverを切り替えない。
- serveもcallerを起動時に固定。JSON行のcaller / senderは拒否。要求idを応答に返し、逐次処理し1行64KiB上限。
- MCP P1は一覧だけ。select / bindingは出さない。D6で一致を検査するのはsessionsの公開候補と理由だけ。P2でMCP内の選択と送信を接続するまで実会話の送信を使えるとはしない。
- binding再照合は観測await前にissuedからcheckingへ予約。並行要求は拒否し、成功1件だけ。一度成功でconsumed、失敗でinvalid。
- 名簿に書く資格情報はない。許可はdirection付きgrantsと登録のoperationsで検査。bootstrapの未知項目を拒否する。

## 最終補足の施工方法

入口はcli MODE --registry FILE --caller ID。Registry loaderを要求ごとにawaitし、callerの起動時native ID / 世代と一致を検査する。試験子プロセスにも同じloaderを注入しファイル変更と読込み失敗を検証。MCPも同じ名簿を利用する。

実Gitの観測はrealpathを使う。configured clean / process filterはconfigの値を出力せず名前だけ取得し、status呼出し時に無効化する。submodule内の外部filter実行を避けるためignore-submodules=all。dirtyはworkspace全体の未追跡を含むbest-effort metadataだが観測失敗はunknown、timeoutはプロセスをkillする。実フィルターを実行しないfixture試験を追加する。

revalidateは最後のawait後に単調時計の期限とchecking状態をcompare-and-set相当の同期区間で検査する。成功数が1件を超えないことを並行試験で確認する。

名簿は各要求の開始時だけでなく、select / revalidateの観測await終了後にも再読込みし、発行またはconsumedへ移す直前に双方の登録と認可を同期検査する。ファイルはsymlinkを拒否しO_NOFOLLOWで開きfstatした同じファイルを最大64KiBだけ読む。

## 最新の検証状態

P1の66試験PASS、verify実終了0。最終版のstrict型検査は実終了0。最終66試験版のHaiku / Opus独立判定PASS。T5完了。旧64試験版の独立判定は更新版に流用しない。

Observation.sourceはnative観測器の識別子。P1のGit取得元は固定のobserveGit関数で、製品のnative稼働観測器は未接続。native / Gitの独立したsource識別子はP2の実アダプター接続前の契約とする。
