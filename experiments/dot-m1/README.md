# M1 測定用スタブ（T3-12）

ChatGPT の Dot と通常の Chat から 1 回ずつ呼ばれたとき、何が届いたかを記録するだけの MCP サーバー。stdio の JSON-RPC で動き、tunnel-client の `--mcp-command` から起動される。本体 `src/`、CLI、常用設定からは呼ばれない。

この版は単体試験を通しただけで、一度も ChatGPT にも tunnel-client にもつないでいない。実行は T3-14（立花さんの go の後）。

```sh
node --test experiments/dot-m1/stub.test.ts
```

## 起動

記録の場所は必ず明示する。無い、相対パス、symlink、ディレクトリ、親が無い、のどれでも exit 2 で起動を拒否し、何も作らない。既定の場所は無い。

```sh
# 道具あり（項目 1〜5）
node /絶対パス/experiments/dot-m1/stub.ts --log /絶対パス/m1-tools.jsonl
# 認証なし・道具なし（項目 6）
node /絶対パス/experiments/dot-m1/stub.ts --no-tools --log /絶対パス/m1-notools.jsonl
```

tunnel-client の `--mcp-command` には、この「実行ファイル、スクリプト、`--log <絶対パス>`」の並びを渡す。`M1_LOG=/絶対パス/m1.jsonl node …` の形は、シェルを通して起動するときだけ使える。tunnel-client の configuration.md には、子プロセスへの環境変数の継承も、引数をシェルで解釈するかも書かれていない（判定役が取得して確認した内容で、この作業では再取得していない）。シェルを通さない場合、先頭の `M1_LOG=…` は実行ファイル名として扱われて起動に失敗する。

| 指定 | 意味 |
|---|---|
| `--log PATH` または `M1_LOG` | 記録ファイル。両方あれば `--log` が勝つ。0600 で作り、既存なら 0600 に直す |
| `--no-tools` | `tools` を宣言せず、`tools/list` と `tools/call` は -32601 |
| `--accept-subscribe` | `events/subscribe` に受理の応答を返す（既定はエラー）。どちらも callback へは POST しない |

tunnel-client に渡す `node` は絶対パスで書く（子プロセスの PATH に依存させない）。

T3-14 では、立花さんが自分の端末で `bash experiments/dot-m1/run-m1.sh tools`（項目 1〜5）か `notools`（項目 6）を実行する。このスクリプトは次を守る。

- 鍵と tunnel ID は Keychain（サービス名 `seamless-dot-m1`、項目 `runtime-key` と `tunnel-id`）から読む。読むのは環境を `env -i` で空にした後のシェルの中で、環境変数で tunnel-client にだけ渡す。鍵はどのコマンドの引数にも載らない。
- 記録の置き場は本線の `.local/dot-m1/`（0700、本人、symlink でない）。検査してから中に作る。tunnel-client の設定の置き場は空の `.local/dot-m1/profiles` で、pro-review 用の `~/.config/tunnel-client` は読まない。
- 同じ tunnel ID で 2 台動かさない（configuration.md の「Stdio deployment limits」）。置き場の `run.lock` を `lockf` で tunnel-client の終了まで持つので、どの作業フォルダから起動しても 2 本目は止まる。
- tunnel-client は `/opt/homebrew/bin/tunnel-client` の 0.0.15 以上だけを使う。tunnel ID の形は本体の検査（`tunnel_` と 32 文字、または 4 文字の名前空間付き）に合わせる。
- 健康の URL（`/readyz` など）は `.local/dot-m1/health-<tools|notools>.<pid>.url` に書かれる。

## 返すもの

| method | 応答 |
|---|---|
| `server/discover` | `supportedVersions: ["2026-07-28"]`、`capabilities`（`events: {}`、`extensions["io.modelcontextprotocol/events"]`、道具ありなら `tools: {}`）、serverInfo、`ttlMs: 60000`、`cacheScope: "private"` |
| `initialize` | 同じ `supportedVersions` と `capabilities`、`protocolVersion: "2026-07-28"` |
| `tools/list`、`tools/call` | `ping` が 1 個。常に `pong` を返す定数。`tools/list` の結果には `ttlMs: 60000`、`cacheScope: "private"` がある。道具なしなら -32601 |
| `events/list` | イベント 1 種 `m1.probe.created`（説明は「Probe event. Fires when a probe item is created.」）。購読の引数は必須なし。`ttlMs`、`cacheScope` を足してある |
| `events/subscribe` | 記録してから、既定は -32602 のエラー。`--accept-subscribe` なら `{id, refreshBefore, cursor: null, truncated: false}` |
| `events/unsubscribe` | 記録して `{resultType: "complete"}` |
| `ping`、通知 | `ping` は `{}`。通知には返さない |
| それ以外 | -32601。壊れた JSON は -32700、1 MiB を超える行は -32600。1 行の処理中に想定外の例外が出たときは、id があれば -32603（定数の文言 `Internal error`）を返して次の行へ進む |

`ttlMs` と `cacheScope` を付けた理由: 2026-07-28 の schema（schema.ts を取得して確認）では `DiscoverResult` と `ListToolsResult` が `CacheableResult` を継承し、この 2 つが必須。付けないと、schema を検証する client は最初の `server/discover` で弾くかもしれず、その場合は `events/list` も `events/subscribe` も来ない。その「届かなかった」を「Dot は非対応」と読む偽陰性を避けるために付けた。ChatGPT が検証するかは未確認。`events/list` の結果の型は拡張の側にあり、schema.ts では確かめていない。足しても害は無いはず（未確認）の追加の項目なので、同じ 2 つを入れた。60 秒にしたのは、Dot と Chat の呼び出しの間を 1 分以上空ける手順のため。購読の `ttlMs`（購読の希望の期限、OpenAI の手順にある）とは別物。

購読を拒否するコードを -32602 にした理由: 以前の -32001 は、この Mac にある MCP の TypeScript SDK（1.x、types.d.ts の ErrorCode）で RequestTimeout と同じ値で、client がタイムアウトとして自動再試行する作りなら、購読の方針ではなくコードの解釈を測る可能性があった。ChatGPT の client がそう作られているかは未確認。-32602 は Invalid params で、これも client の解釈に影響しうる。どのコードを選んでも再試行の観測にはコードの影響が残るので、項目 6 の結果は「返したコード（記録の `error_code`）での観測」として読む。

## 記録（1 行 1 件の JSON）

共通: `v`、`run`（実行ごとの乱数 4 バイト）、`seq`、`t`（ISO 時刻）、`kind`（`lifecycle`、`request`、`notification`、`response`、`invalid`、`internal_error`）、`method`、`reply`（`result`/`error`/`none`）、返したエラーの `error_code`。

試験は、記録の全ての行について「宣言した欄だけがある」「各欄の値が決まった形のどれかに合う」「64 桁の 16 進（salt や完全なダイジェストの形）が無い」を確かめる許可名簿を持つ。欄を足すときは試験の名簿にも足す。

`method` は既知の名前と、小文字の単語だけでできた名前だけを書く。それ以外は `(other)`。

| 欄 | 中身 |
|---|---|
| `meta_keys` | `params._meta` と最上位 `_meta` のキーの名前（昇順）。`authoriz`、`secret`、`token`、`passw`、`cookie`、`credential`、`bearer`、`signature`、`api_key` を含む名前は `(redacted-key)`、変な文字を含む名前は `(unsafe-key)`。同じ置換は 1 個にまとまる |
| `redacted_key_count`、`redacted_key_fp` | 名前を伏せたキーの個数と、その名前の HMAC-SHA256（同じ salt）の先頭 8 桁の列（昇順）。Dot 専用のキーの名前が `attestationToken` のような認証らしい語を含んでいても、「伏せたキーが何個あるか」と「Dot と Chat で名前が同じか違うか」は読める。値の指紋は取らない |
| `subject`、`session` | `openai/subject`、`openai/session` の値の HMAC-SHA256 の先頭 8 桁。salt は実行ごとの乱数でメモリにだけあり、記録しない。無ければ null |
| `meta_fp` | 上の 2 つ以外の `_meta` の値の、同じ HMAC の先頭 8 桁（キー名ごと）。`openai/userAgent` などが Dot と Chat で違うかを、値を出さずに比べるため |
| `protocol`、`client`、`client_caps` | `_meta` の protocolVersion（日付の形のものだけ）、clientInfo の name と version（英数字と少数の記号だけの短い文字列で、認証らしい語を含まないものだけ平文。他は null）、クライアントの capabilities のキーの名前 |
| `tool` | `tools/call` の道具の名前。`ping` 以外は `(other)` |
| `event`、`delivery_mode`、`callback_host`、`has_secret`、`accepted` | subscribe と unsubscribe だけ。`callback_host` は `delivery.url` のホスト名だけ（ユーザー情報、ポート、パス、クエリは落とす。解釈できなければ `(invalid)`）。`has_secret` は secret の有無だけ |
| `(start)`、`(stdin_end)` | 起動と stdin の終了。`pid`、フラグを書く |
| `(internal_error)`、`(uncaught)` | 1 行の処理中の想定外の例外（`kind: "internal_error"`、`error_code: -32603`）と、処理の外へ漏れた例外（`error_name` に例外の名前だけ。メッセージとスタックは書かない。その後 exit 1） |

書かないもの: Authorization、secret の値、callback の URL の全体、引数の値、本文、JSON-RPC の id、応答の中身、`subject` と `session` の元の値。

## 6 項目を記録のどこで読むか

| # | 項目 | 読む場所 |
|---|---|---|
| 1 | Dot が呼べたか | `method: "tools/call"`、`tool: "ping"`、`reply: "result"` の行が、Dot を呼んだ時刻にあるか |
| 2 | 呼び手の指紋が Dot と Chat で同じか違うか | その 2 行の `subject`、`session`、`meta_fp`、`client` を比べる |
| 3 | `_meta` に Dot 専用の項目があるか | その 2 行の `meta_keys` の差 |
| 4 | `events/subscribe` が来たか | `method: "events/subscribe"` の行。下の「購読を引き出す手順」で頼んだ時刻の後にあるか |
| 5 | callback の宛先のホスト名 | その行の `callback_host` |
| 6 | 認証なしで道具なしの入口でも subscribe が来るか。エラーの後に再試行されるか | `--no-tools` の記録の `events/subscribe` の行の数と `t`。エラーの後に同じ行が増えるかが再試行。この結果は、返したコード（その行の `error_code`、既定は -32602）での観測 |

## 購読を引き出す手順（T3-14 で守る）

OpenAI の Events の手順（developers.openai.com/plugins/build/mcp-events、取得して確認）では、ChatGPT が `events/subscribe` を送るのは「ユーザーが監視を頼んだとき」で、場所は Work chat（web、Cloud を選んだデスクトップ、dot）。頼まなければ購読が来ないのが正常で、記録だけでは「ChatGPT が送らない」と「誰も頼んでいない」を区別できない。そのため次を守る。

1. Dot でも通常の Chat でも、「イベント `m1.probe.created` を監視して」と明示的に頼む。ping を呼ぶ依頼とは別に頼む。
2. 頼んだ時刻（分まで）と、頼んだ場所（Dot、Work chat、素の Chat のどれか）を控える。記録の `t` と突き合わせる。
3. 通常の Chat は、Work chat の場合と素の Chat の場合を分けて試す。
4. `--no-tools` の入口（項目 6）でも同じ頼み方をする。
5. 頼んだのに購読の行が無ければ「頼んだが来なかった」と書く。頼んでいない場合の「来なかった」とは別に書く。

イベントの説明（`events/list`）は、モデルが監視の依頼に応じるかを決める材料になる。「出ない」と読める文言にしない。

## 読むときの限界

- `subject` は利用者単位、`session` は会話単位の匿名 ID（公式の Apps SDK の説明）。Dot の会話と通常の Chat の会話は別の会話なので、`session` は Dot かどうかに関係なく違うはず。`subject` は同じ利用者なら Dot でも同じはず。この 2 つだけでは「Dot を区別できる値が届いたか」は決まらない。区別の根拠になるのは `meta_keys` の差、`meta_fp` の差（`openai/userAgent` など）、`client` の差。
- 指紋が比べられるのは同じ `run` の中だけ。tunnel-client は stdio の子プロセスを全ての論理接続で共有するので、Dot の呼び出しと Chat の呼び出しは同じ `run` になるはず。`run` が違う 2 行は比べない。
- 記録の行は誰が呼んだかを書かない。呼んだ順番と時刻を控えておき、`t` と突き合わせる（Dot を先に 1 回、次に Chat で 1 回、間を 1 分以上空ける）。モデルが ping を 2 回呼ぶ、tunnel-client が先に呼ぶ、といったときは行が混ざる。行数が期待と違えば、その区間は呼び手を決めない。
- stdio の子プロセスには JSON-RPC の本文しか届かない。stdio の子プロセスに HTTP ヘッダは届かない（stdio の構造）。tunnel-client は MCP への HTTP ヘッダを poll command の headers から付ける設計だという判定役の取得結果（この作業では再取得していない）が正しければ、Dot 専用の信号が HTTP ヘッダにあっても、このスタブでは原理的に見えない。`_meta` に差が無くても、Dot に専用の信号が無いとは言えない。
- 呼び手の判別を強くする案として、ping に enum の任意引数 `caller`（dot、chat、unknown）を足し、値が許可名簿のどれかのときだけ記録する方法がある。これは「引数の値を書かない」方針の例外になるので、入れていない。入れるかは立花さんの判断。
- 「届かなかった」と「届いたが記録できなかった」は区別できない。`(start)` の行が無ければスタブは起動していない。

## 既知の限界

- `initialize` の `protocolVersion` は常に `2026-07-28` を返す。古い版（2025-06-18）で `initialize` を送るクライアントは、ここで切断するかもしれない。切断も観測のうち。
- events の能力は `events: {}` と `extensions["io.modelcontextprotocol/events"]` の両方に宣言した。SEP-3415 の本文は取得に失敗した（503）ので、ChatGPT がどちらを見るかは確かめていない。
- `--accept-subscribe` は callback の確認をせずに受理する。測定専用で、製品の挙動ではない。購読の `ttlMs` を読まず `refreshBefore` を常に 1 時間にし、同じ購読の再送にも毎回新しい `id` を返し、検証の challenge を付けた POST も送らない（OpenAI の手順は、期限が `ttlMs` 以下、作成が冪等、検証してから有効にする、を求める）。したがって accept が測るのは、購読の到着と宛先のホスト名の確認まで。検証の POST が無いので、その後の ChatGPT の挙動（検証待ちの失敗、unsubscribe、再購読）は、仕様どおりの server に対する挙動の証拠にならない。unsubscribe は記録されるので、その連鎖があったかは見える。
- `ttlMs` と `cacheScope` は `server/discover`、`tools/list`、`events/list` に付けた（上の「返すもの」の理由）。ChatGPT が schema を検証するかは未確認。
- 通信しない保証は、source に net、http、dns、child_process などの import と `fetch` が無いこと（試験 6b）と、ローカルの待受へ POST が 0 回であること（試験 6）で確かめる。
