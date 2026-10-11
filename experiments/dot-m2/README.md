# M2 測定用サーバー（notify.ts）

M1 のスタブと同じ入口のまま、`events/subscribe` を受理し、OpenAI の手順どおりに callback を確認し、通知を 1 件だけ送る MCP サーバー。stdio の JSON-RPC で動き、tunnel-client の `--mcp-command` から起動される。測定は「ChatGPT の Dot に、Mac からの通知が届くか」を見る。本体 `src/`、CLI、常用設定からは呼ばれない。

この版は単体試験を通しただけで、一度も ChatGPT にも tunnel-client にもつないでいない。実行は立花さんの端末から。

外へ出る通信は、`connectors.api.openai.com` への POST だけで、全部で次の 2 種類。

| 種類 | 回数 | 中身 |
|---|---|---|
| 確認（verification） | 購読の作成ごとに 1 回（同じ購読の更新では出さない） | `{"type":"verification","challenge":<乱数>}` |
| 通知（delivery） | 最大 1 件。記録ファイルの隣の印（`<log>.sent`）で、再起動や 2 回目の起動をまたいでも守る | `{"eventId":"evt_m2_…","name":"m1.probe.created","timestamp":…,"data":{"id":"m2-test-1"},"cursor":null}` |

```sh
node --test experiments/dot-m2/*.test.ts     # 34 件。うち 2 件は本物のタイマーで 5 秒ずつ待つので約 12 秒かかる
```

## 起動

M1 と同じ。記録の場所は必ず明示する。無い、相対パス、symlink、ディレクトリ、親が無い、未知の引数のどれでも exit 2 で起動を拒否し、何も作らない。環境変数 `M1_LOG` は読まない。

```sh
node /絶対パス/experiments/dot-m2/notify.ts --log /絶対パス/m2-notify.jsonl
```

立花さんの端末からは、M1 と同じ手順でモード `notify` を使う（Keychain の読み方、空の環境、ロック、置き場の検査は M1 のまま）。

```sh
bash experiments/dot-m1/run-m1.sh notify      # 止めるときは Ctrl-C
```

記録は `.local/dot-m1/m2-notify.jsonl`（0600）。起動のたびに追記される。

通知を送る直前に、記録の隣に空の印 `.local/dot-m1/m2-notify.jsonl.sent`（0600）を作る。印があれば通知は送らない。Ctrl-C で止めて起動し直しても、ChatGPT 側の購読が生きていて更新が来ても、2 件目は出ない。**もう一度測りたいときは、この印を消す。** 消すことが、2 回目の外部送信への承認になる。送らずに終わった場合（5 秒の間に解除された、期限が切れた、入力が閉じた）は印を作らないので、そのまま起動し直せる。

## 返すもの

| method | 応答 |
|---|---|
| `server/discover`、`initialize`、`tools/list`、`tools/call`（`ping`）、`events/list`、`ping`、通知、壊れた行 | M1 のスタブ（道具あり）と同じ。試験 11 が、同じ入力を M1 の `stub.ts` と `notify.ts` に流して全ての返事の一致を確かめる。`serverInfo.name` も M1 のまま（`seamless-dot-m1-stub`）。ChatGPT が登録の時に読んだ能力を使い回したので、名前も形も変えない |
| `events/subscribe` | 下の表の条件を満たせば確認して受理。違えば `-32602`（`Invalid params`）。確認に失敗すれば `-32015`（`Callback endpoint error`、`data.reason` に理由） |
| `events/unsubscribe` | 購読を消して `{resultType: "complete"}`。見つからなくても同じ（冪等） |

M1 の `--accept-subscribe` と `--no-tools` はこのサーバーには無い（付けると未知の引数として exit 2）。

### events/subscribe を受ける条件

| 項目 | 条件 | 違うときの `reason`（記録にだけ書く） |
|---|---|---|
| イベント名 | `m1.probe.created` | `bad_event` |
| delivery.mode | `webhook` | `bad_delivery` |
| delivery.url | `https://connectors.api.openai.com` で始まり、直後が `:443`（既定のポートの明示）、`/`、`?`、`#` か終端。`:443` 以外のポート（`:4430`、`:0443` も）、ユーザー情報、空白、制御文字、バックスラッシュ、大文字のホスト名、末尾の `.` は不可。2048 文字まで | `bad_url` |
| delivery.secret | `whsec_` で始まり、base64 が 24〜64 バイトに復号でき、その鍵の base64 の正しい書き方（`=` の詰め物あり、または無し）と一致する。詰め物の数が違うもの、末尾のビットが 0 でないものは不可 | `bad_secret` |
| ttlMs | 無い、`null`、または 1 以上の数 | `bad_ttl` |
| arguments | 無い、`null`、またはオブジェクト | `bad_arguments` |

これら以外の欄（`cursor`、`_meta`、知らない欄）は見ない。ChatGPT が実際に何を送るかは M1 で見えた範囲（名前、mode、url、secret）しか分かっていないので、必須でない欄では弾かない。

## 購読の流れ

1. **確認**: 応答を返す前に callback へ POST する。ヘッダは `Content-Type: application/json`、`webhook-id: msg_verification_<乱数>`、`webhook-timestamp`（Unix 秒）、`webhook-signature`（Standard Webhooks の `v1,<base64>`、`events.ts` の `signature` と同じ計算）、`X-MCP-Subscription-Id`。redirect は追わない（`redirect: 'manual'`）。上限は 10 秒で、`fetch` が signal を無視しても 10 秒で打ち切る。
2. **受理の条件**: 応答が 2xx で、本文の JSON の `challenge` が送った値と一定時間の比較で一致したときだけ。
3. **失敗**: `-32015` と `data.reason`。理由は `challenge_failed`（2xx だが challenge が違う、無い、JSON でない）、`timeout`、`http_<状態>`（2xx 以外。3xx も）、`network`（接続の失敗）、`too_large`（確認の返事が 16 KiB を超えた）。
4. **受理の応答**: `{resultType: "complete", id, refreshBefore, cursor: null, truncated: false}`。`refreshBefore` は「今 + 要求の ttlMs と 1 時間の小さいほう」（`ttlMs` が無い、または `null` なら 1 時間）。
5. **更新**: 識別子（callback の URL、イベント名、arguments を並べ替えた JSON から作る `sub_…`）が同じで期限内なら、同じ ID を返す。secret が同じなら確認をやり直さず期限だけ延ばす。secret が変わったときは、新しい secret で確認し直し、通れば入れ替え、通らなければ購読を消す（古い secret で署名しても受け手が受けない可能性があるため。`events.ts` の試験と同じ扱い）。
6. **同時の要求**: 同じ識別子の subscribe と unsubscribe は 1 つずつ順に処理する。確認の最中に同じ購読が来たとき、確認が成功すれば確認は 1 回で済む（失敗したときは購読が消えるので、後ろの要求がそれぞれ確認をやり直し、返事は 10 秒ずつ遅れる。Dot の再試行は M1 で 17 秒間隔だったので、観測された動きでは起きない）。確認の最中に来た unsubscribe は確認の後に効く。他の識別子や ping は止めない。

購読は Mac のメモリにだけ置く。プロセスが終われば消える。

## 通知

- 最初の受理から 5 秒後に 1 件だけ、受理した購読の callback へ POST する。更新、別の購読の受理、時間の経過があっても 2 件目は出さない。
- 送る直前に印のファイル（`<log>.sent`）を `O_EXCL` で作る。作れたときだけ送る。もう印があれば `already_sent`、作れなければ `reserve_failed` で、どちらも送らずに記録する（印が取れないときは送らない側に倒す）。購読の受理は、印があっても通常どおり返す（ChatGPT に失敗と見せないため）。
- ヘッダは `Content-Type`、`webhook-id`（本文の `eventId` と同じ値）、`webhook-timestamp`、`webhook-signature`、`X-MCP-Subscription-Id`。本文のバイト列は 1 回だけ作り、その同じ文字列に署名して、その同じ文字列を送る。
- 送り直さない。失敗（2xx 以外、タイムアウト、接続の失敗）は記録して終わり。10 秒で打ち切る。
- 送らない場合: 5 秒の間に unsubscribe された（`no_subscription`）、購読の期限が 5 秒より先に切れた（`expired`）、入力が閉じた（`stdin_end`。仕掛け中の通知を取り消す）、印がある（`already_sent`）、印が取れない（`reserve_failed`）。
- 2xx は「OpenAI が受け取った」ことを示す。OpenAI の手順では ChatGPT が非同期で処理するので、Dot の会話に出たかは Dot の画面で別に確かめる。

## 記録（1 行 1 件の JSON）

M1 と同じ共通欄（`v`、`run`、`seq`、`t`、`kind`、`method`、`reply`、`error_code`、`has_id`）。M1 の `_meta` の指紋（`meta_keys`、`subject`、`session` など）は M2 の問いに要らないので持たない。M1 の記録と同じ読み方ができるのは共通欄と購読の欄まで。

| 行 | 欄 |
|---|---|
| `events/subscribe` | `event`、`delivery_mode`、`callback_host`（ホスト名だけ）、`has_secret`、`accepted`、更新なら `renewal: true`（期限内の同じ識別子の更新と secret の入れ替え）、`reply`、`error_code`、失敗なら `reason` |
| `events/unsubscribe` | `event`、`delivery_mode`、`callback_host`、`has_secret`、`removed`（消えたか） |
| `kind: "verification"` | `method: "(verification)"`、`callback_host`、`result`（`ok` か `failed`）、失敗なら `reason`、`http_status`（応答が無ければ null）、`duration_ms`（確認にかかった時間。10 秒の上限で切れたら 10000） |
| `kind: "delivery"` | `method: "(delivery)"`、`callback_host`、`result`（`attempt`、`delivered`、`failed`、`skipped`）、`failed` と `skipped` なら `reason`、`http_status`。送ったときは、要求を出す前に `attempt` の行、答えが返ってから `delivered` か `failed` の行の 2 行になる。`attempt` だけで終わっていたら、要求の最中にプロセスが終わった（送ったかどうかは不明）。`skipped` は要求を出していない |
| `(start)`、`(stdin_end)`、`(uncaught)` | M1 と同じ（pid、node の版、例外の名前だけ） |

書かないもの: secret、URL のパスとクエリ、challenge、署名、`webhook-id`、`eventId`、購読 ID、本文、応答の本文、Authorization。試験 9 が、これらの値を実際に流して、記録に 1 つも出ないことを確かめる。試験は M1 と同じ許可名簿（宣言した欄と決まった形の値だけを通す）も持つ。欄を足すときは試験の名簿にも足す。

## 結果の読み方

| 知りたいこと | 読む場所 |
|---|---|
| Dot が購読を送ったか、受理されたか | `events/subscribe` の行。`accepted: true` なら受理。false なら `reason` |
| callback の確認が通ったか | `verification` の行。`result: "ok"` と `http_status` が 2xx。失敗なら `reason` と `http_status` で、OpenAI 側が拒否したのか、時間切れか、challenge が合わないのかを分ける。`duration_ms` が 10 秒に近いなら、tunnel-client の待ち時間の上限（下の「迷った点」）を疑う材料になる |
| 通知が OpenAI に受け取られたか | `delivery` の行。`delivered` と `http_status`（2xx）。`attempt` の行があって `delivered` や `failed` が無ければ、答えが返る前に終わった |
| 通知を送ろうとしたか | `delivery` の `attempt` の行があるか、印のファイル（`.local/dot-m1/m2-notify.jsonl.sent`）があるか。どちらも「要求を出す直前まで行った」ことを示し、届いたかは `delivered` / `failed` の行で見る。`skipped` の行は要求を出していない |
| 受理の後に Dot が片付けたか | `events/unsubscribe` の行（`removed: true`）。M1 では、断ったあとに Dot が直後に unsubscribe した |
| Dot の会話に出たか | 記録には出ない。Dot の画面で見る。通知の中身は `data.id` が `m2-test-1` |

## 守りの先送り（理念: ニーズ先行、守りは後）

測定のために入れていない守り。支払期日は「この仕組みを `src/` に取り込む日」と「宛先の名前を増やす日」の早いほう。

| 入れていないもの | 理由 | 期日 |
|---|---|---|
| 名前を引いた IP が公開の住所かの確認、その IP への接続の固定（`events.ts` の試験が確かめた形） | 宛先は `connectors.api.openai.com` 1 つに固定していて、利用者や ChatGPT が宛先を選べない。接続先の IP を固定するには `fetch` の外の接続の部品が要り、この版は `fetch` を注入してネットワークの部品を直に import しない形にしている | 宛先の名前を増やす前。本体へ取り込む前 |
| 購読の保存（再起動で消える） | 1 回の測定で、プロセスが生きている間だけ持てばよい | 本体が購読を受ける日 |
| 認証（誰が購読してよいか） | tunnel の入口に届いたものだけを受ける形（Q5 の推奨）で、専用の tunnel を測定にだけ使う | 本体へ取り込む前 |
| 再送、指数バックオフ | 測定では 1 回の結果を見たい | 本体へ取り込む前 |
| 確認の POST の回数の上限（処理中の件数、1 プロセスの総数） | 引数だけが違う購読を同時に送ると、署名つきの確認が購読の数だけ出る。宛先は OpenAI 1 つで、購読を送れるのは専用の tunnel 経由の Dot だけ | 本体へ取り込む前 |
| 失敗した確認の合流（同じ識別子の購読が確認の失敗の後ろに並ぶと、確認をやり直す） | M1 の Dot の再試行は 17 秒間隔で、10 秒の上限を超える。観測された動きでは起きない | 本体へ取り込む前 |
| 鍵の入れ替えで古い鍵と新しい鍵の両方で署名する（OpenAI の手順の Refresh の節） | 5 秒の間に鍵が変わる場面が無い。代わりに、新しい鍵で確認し直し、通らなければ購読を消す | 本体へ取り込む前 |
| `notifications/cancelled` で確認を中断する、id の無い `events/subscribe` を断る | tunnel-client が待ちきれずに取り消しても、確認は続き、購読は受理される。id の無い形の subscribe も同じ処理が走る。どちらも送る通知は最大 1 件のままで、宛先も変わらない | 本体へ取り込む前 |
| 5 秒の間に解除された購読の後、再度の受理で通知を仕掛け直す | 送らずに終わった通知は再び仕掛けない（`no_subscription`、`expired`）。仕掛け直しが要るのは、受理の直後に Dot が解除して出し直す場合だけで、その場合は記録の `skipped` で分かり、起動し直せば足りる（印は作られていない） | 本体へ取り込む前 |

通知を 1 件に絞る「配送の予約」は、先送りにせず入れた（`<log>.sent`）。再起動をまたいだ 2 件目は、外部送信の承認を超えるため。

## 迷った点と置いた仮定

- 通知の本文に `cursor: null` を足した（指示は `eventId`、`name`、`timestamp`、`data`）。OpenAI の手順の本文の例と `events.ts` に入っていて、無いと受け手の検証が落とす可能性が、あると落とす可能性より高いと見た。外すなら `notify.ts` の本文の 1 か所と試験 6。
- ホスト名の判定は、URL を解析した結果ではなく元の文字列で行う。解析結果だけを見ると、`:443` も `:0443` も既定のポートとして消えて、書き方の違いを見分けられないため。`:443` の明示は、同じ宛先に同じ 443 で接続するので通す（M1 の記録はポートの有無を書かなかったので、Dot が付けるかは未確認。弾くと外部送信の測定を 1 回やり直すことになるため、通す側に倒した）。`:443` 以外、ユーザー情報、IP の直書きは弾く。
- secret は、`=` の詰め物が無い base64 も通す（OpenAI の手順は「24〜64 バイトに復号できる」としか書かない）。署名は復号した同じバイト列から作るので、詰め物の有無で変わらない。詰め物の数が違うもの、末尾のビットが 0 でないもの（同じバイト列の別の書き方）は弾く。
- 同じ購読でも secret が変わったときは確認をやり直す。「同じ callback と同じイベントの更新は確認をやり直さない」からの意図的な逸脱で、受け手が持っていないかもしれない鍵で署名して送らないため（`events.ts` と同じ扱い）。戻すなら `notify.ts` の `register` の `live&&live.secret===secret` を `live` にする。測定では 5 秒の間に secret が変わる場面は無く、結果に影響しない。
- 通知を送る購読は「最初に受理された購読」で、その購読が 5 秒の間に消えたら、別の購読が後から受理されても送らない。「最大 1 件」と「消えた購読には送らない」を、どちらも文字どおりに守るため。
- unsubscribe の返事は、同じ識別子の処理の順番を待つので、他の要求の返事より後に返ることがある（JSON-RPC は id で対応するので問題ない）。
- 購読と解除の結果に `resultType: "complete"` を付けている。OpenAI の手順の例には無い（例は `{id, refreshBefore, cursor, truncated}` と `{}`）。M1 の unsubscribe の返事は `resultType` つきで、Dot はそのまま進んだ。購読の結果を厳密に検証する側があるかは未測定。記録では `accepted: true` なのに Dot が購読を失敗と言うときの疑い先の 1 つ。
- 通知の `redirect` は `manual`（OpenAI の手順の例と `events.ts` は `error`）。どちらも追わない。`manual` だと 3xx が `http_302` として記録に残り、`error` だと例外になって `network` に混ざる。測定には `manual` の方が情報が多い。
- 「最大 1 件」は印のファイルが守る。ChatGPT 側の購読は Ctrl-C で止めても残るので、印が無いと、止めてから最大 1 時間のうちに起動し直したとき、生きている購読の更新が来て、新しいプロセスが 5 秒後に別の 1 件を送る。印があればこれは起きない。再測定のために印を消すのは、意図した 2 回目の送信。
- tunnel-client が、stdio の子プロセスへ送った要求に応答を待つ上限を持つかは未確認。購読の確認は最大 10 秒かかるので、上限がそれより短いと、確認が通っても ChatGPT 側が購読を失敗として扱う可能性がある。記録の `verification` が `ok` で `events/subscribe` が `accepted: true` なのに、Dot が購読を失敗と言うときは、この可能性を疑う。
- 入力（stdin）が閉じたとき、確認の最中のものは終わるまで待つ（最大 10 秒）。仕掛け中の通知は取り消す。tunnel-client が止まると callback への通知も止める、という扱い。
