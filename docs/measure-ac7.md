# AC7 の計測手順（実相手で 15 往復）

状態: 2026-10-20 起草（Issue #32、T15 の手順書）。正本は `specs/2026-10-universal-wiring/spec.md` の AC7 と、`specs/2026-10-universal-wiring/Plans.md` 8 章、S1、S2。実行する人は立花さん。施工役はこの文書を書くだけで、実相手への送信は行わない。

この文書は 4 つを決める。何を 15 往復するか、各製品で 4 つの状態をどう作るか、`scripts/measure.ts batch` の記録をどう読むか、`evidence.md` にどう転記するか。

## 0. 最初に読む: Grok Bot への送信の承認

`--plan` に `grok-bot:5` を入れると、Grok Bot（茶々丸）へ本物の webhook が飛ぶ。これは Mac の外への送信で、取り消せない。実行には H3 相当の本人承認が要る（2026-10-19 の H3 決定と同じ扱い）。

- 承認が無い間は `grok-bot:5` を外し、`claude:5,codex-desktop:5` の 10 往復だけを行う。10 件で止めた記録は AC7 の合格にしない（AC7 は送信済み 15 件が条件）。
- 承認したら、承認者、日時、対象（製品と件数）を `evidence.md` の AC7 の行に書く。承認の口頭記録だけを証拠にしない。
- 送信本文は 5 章の 1 文を接頭辞にする。各送信には `#<連番>/<総数> <依頼 ID の先頭 8 桁>` が付き、本文は 1 件ずつ変わる。6 章の「本文が残らない」確認は接頭辞で検索する。

## 1. 何を 15 往復するか

| 製品 | 待機中 | 作業中 | hold または目標実行中 | 休止中または再起動 | 合計 |
|---|---|---|---|---|---|
| Claude（Claude Desktop の対話セッション） | 2 | 1 | 1（hold） | 1 | 5 |
| Codex（Codex Desktop のスレッド） | 2 | 1 | 1（目標実行中） | 1 | 5 |
| Grok Bot（茶々丸） | 2 | 1 | 0（hold に当たる設定が無い） | 2（休止中と再起動直後） | 5 |
| 合計 | 6 | 3 | 2 | 4 | 15 |

Grok Bot には Claude の `crossSessionInbound` や Codex の目標に当たる設定が無い。hold の 1 枠は休止中に、休止中または再起動の 1 枠は再起動直後に割り当て、合計 5 を保つ。

合否は 2 つで決まる。集計行の `submitted`（`delivery` が `submitted` の件数）が 15、かつ `falseReached` が 0（書込みの成功だけで「渡った」と出した件数 0）。`entries` が 15 なだけでは合格にしない。`entries` は失敗した記録も数えるので、`scope_conflict`、`duplicate`、`no_candidates` が並んだ 15 件でも 15 になる。合否は集計行の `submitted` と `falseReached` だけで読む（6 章）。

## 2. 前提

1. リポジトリは統合ブランチ `loop/integration` の worktree。リポジトリの根元から実行する。
2. `node --version` が 22.22.0 以上。
3. Claude Desktop の対話セッションを 5 つ以上、Codex Desktop のスレッドを 5 つ以上用意する。どちらも「実行元の会話は宛先にならない」ので、実行元とは別に 5 つ要る（4 章）。
4. Grok Bot 茶々丸が登録済みで起きている。`~/.seamless/peers.json` の登録と、webhook の宛先と鍵の環境変数が要る（`scripts/peer-setup.sh`）。起きているかは `grok-bot-power` で確かめる。
5. 実行するシェルは、Claude の会話プロセスの子孫（Claude Code、または Claude Desktop の Code タブのシェル）か、Grok の TUI にする。理由は `src/caller.ts` が呼び出し元を祖先プロセスの署名と `~/.claude/sessions/<pid>.json` で同定するため。素の Terminal から直に走らせると `caller_unobserved`（終了コード 2）で止まり、送信は起きない。Codex CLI からは `codex_cli_unsupported` で止まる。
6. 待ち秒 N は 20 秒（`~/.seamless/limits.json` の `heldAfterSec`。未設定なら 20）。`--wait` は N より 5 秒以上長くする。既定は 25 秒。
7. `~/.seamless/limits.json` の `exclude` に入れた相手は候補から外れる。計測の前に、対象の会話が `exclude` に無いことを確かめる。

## 3. 送らない確認を 3 つ先に行う

この 3 つは送信しない。1 つ目と 2 つ目は記録も作らない。

```sh
node scripts/measure.ts --help
node scripts/measure.ts batch --plan claude:5,codex-desktop:5,grok-bot:5 --dry
node src/cli.ts who --json
```

2 つ目は計画だけを検査する。期待する出力は `planParts` に `claude`、`codex-desktop`、`grok-bot` が `known: true` で並び、`entries` が 15、`recordFile` が `null`、`scope` が `any`、終了コード 0。綴りを間違えた名前は `known: false` になる。名前が誤ったまま本番を走らせると、その製品の記録が `no_candidates` で埋まり、送信は起きない。

3 つ目は宛先の id と状態を出す。`id` は `provider:nativeId`。`state` は `ready`、`next_turn`、`wake_needed`、`unreachable` のどれか。`who` は呼び出し元を同定できないときも終了コード 0 で `{"status":"caller_unobserved",...}` を出す。このときは実行シェルが違う（2 章 5）。`measure.ts` の本番実行は同じ条件で終了コード 2 になる。

`scripts/measure.ts` の副コマンドとこの手順書の対応。

| 手順書のコマンド | `--help` の行 | この手順書での用途 |
|---|---|---|
| `batch --plan ... [--out] [--wait] [--text] [--scope] [--dry]` | 使い方の 3 行目 | 15 往復の本体。`--dry` は計画の検査だけ |
| `compare --dry [--file]` | 使い方の 5 行目 | 5 指標の空の表（AC13 の下準備） |
| `roundtrip --target <id> [--wait] [--text] [--scope] [--log]` | 使い方の 1 行目 | 1 件だけ確かめ直すとき |
| `hold --target <id> [--wait] [--held-after-sec] [--text] [--scope] [--log]` | 使い方の 2 行目 | 保留の理由だけ確かめ直すとき |

## 4. 状態の作り方（製品 3 × 状態 4）

表の「送信時に見る印」は、`who --json` の `state` と、記録の `delivery`、`state`、`reason` に現れる値。

| 製品 | 状態 | 作る操作 | 送信時に見る印 |
|---|---|---|---|
| Claude | 待機中 | 会話を開き、応答が終わって `~/.claude/sessions/<pid>.json` の `status` が `idle` に戻るまで待つ | `who` が `ready`。記録は `delivery: submitted`、`reached` が観測される |
| Claude | 作業中 | 長い処理を走らせ、応答が返る前に送る | `who` が `next_turn`。依頼 ID はそのターンの後に出る |
| Claude | hold | `~/.claude/settings.json` の `crossSessionInbound` を `{"allow":false}` にする（または `permissions.defaultMode` を `bypassPermissions` にする） | N 秒で依頼 ID が出ないとき `state: held`、`reason: claude_hold` |
| Claude | 休止中または再起動 | その会話のプロセスを終了させる。または Mac をスリープさせて起こす | `who` が `wake_needed`。送れないので、起こした直後の往復を 5 件目に数える |
| Codex | 待機中 | スレッドを開き、turn が走っていない状態にする | 記録は `delivery: submitted`。Codex は queue 書込みなので `who` は `ready` を出さない（`src/discovery.ts` 3 章） |
| Codex | 作業中 | turn を実行させ、終わる前に送る | 依頼 ID は次の turn に載る |
| Codex | 目標実行中 | goal を走らせる | N 秒で依頼 ID が出ないとき `state: held`、`reason: codex_goal`。goal の情報が読めないと `unknown_reason` |
| Codex | 休止中または再起動 | Desktop を終了し、スレッドを未ロードにする。または起動し直す | `who` が `wake_needed`。送れないので、起こした直後の往復を 5 件目に数える |
| Grok Bot | 待機中 | `grok-bot-power` で起きていることを確かめる | `who` が `wake_needed`（登録済みの Bot は常にこの値。`src/discovery.ts` の判定）。記録は `delivery: submitted` |
| Grok Bot | 作業中 | 茶々丸に別の作業を走らせておく | 返事が遅れる。`delivery` は `submitted` のまま |
| Grok Bot | 休止中 | クラウド PC を休止させる | webhook が起こすので送信は通る。返事は遅れる |
| Grok Bot | 再起動直後 | 休止から起こした直後に送る | `delivery: submitted`。返事は次の起床後 |

補足 3 つ。

- Claude の hold は設定を変える。計測が終わったら `crossSessionInbound` を元の値に戻し、`diff` で戻ったことを確かめる。戻す前の値を控えておく。
- 休止中の相手は `batch` の候補に入らない（`src/automatic.ts` が `status` が `online` 以外の会話を一覧から外す）。したがって「休止中」は送信では作れない。`who --json` の `wake_needed` を証拠に残し、起こした直後の往復をその枠に数える。休止中の相手へ単発で送ろうとすると `roundtrip --target <id>` は `target_unavailable` を返す（終了コード 1）。この値も「送れない」ことの確認に使える。
- 実行元の会話は候補から外れる。Claude を 5 往復するなら、実行元とは別に 5 つの会話を用意する。製品ごとに、使わない会話は閉じておく。候補が 5 つより多いと、送信の順番が状態の割り当てとずれる。

## 5. 15 往復を実行する

状態を作り終えてから、リポジトリの根元で 1 回だけ走らせる。

```sh
node scripts/measure.ts batch \
  --plan claude:5,codex-desktop:5,grok-bot:5 \
  --out "$HOME/.seamless/measurements/ac7-$(date +%Y%m%d-%H%M%S).jsonl" \
  --wait 25 \
  --scope any \
  --text 'seamless AC7 measurement: reply with one short line.'
```

- `--out` は毎回新しいパスにする。既存のファイルを指定すると上書きする（`scripts/measure.ts` の既知の残件）。
- `--scope any` は一覧と送信の両方に効く。既定も `any` なので省略しても同じ。`current_work` にすると、実行元のフォルダの外にいる相手は一覧から消え、送っても `scope_conflict` で止まる。15 往復では `any` のままにする。一覧と送信は同じ値を使うので、片方だけ別の scope になることはない。
- `--text` は接頭辞。各送信の本文は `<接頭辞> #<連番>/<総数> <依頼 ID の先頭 8 桁（measure- を除く）>` になる。たとえば 1 件目は `... #1/15 3f9a1c02`。同じ本文を同じ相手へ送ると内容ハッシュの重複抑止が働き、2 件目以降が `duplicate` で送信前に止まる。連番と依頼 ID が本文を 1 件ずつ変えるので、15 件が同じ相手に並んでも重ならない。
- 6 章の「本文が残らない」確認は接頭辞を探す。本文の後半（連番と ID）は毎回変わるので、検索語にしない。
- 送信順は製品ごとに、`who --json` の行順（休止中と受信不可を除く）を 1 件ずつ循環する。1 件目が 1 行目の相手、2 件目が 2 行目の相手という順。
- 1 件あたり最大 `--wait` 秒待つ。15 件で最長 6 分 15 秒に、送信と読取りの時間が加わる。
- 実行中に状態を変えない。変えると、どの送信がどの状態に当たったか記録から読めなくなる。
- 終了コードは通常 0。記録には失敗も残る（`error: scope_conflict`、`error: duplicate`、`error: no_candidates` など）。送信そのものが例外で止まったときだけ 1 か 2 になる。

`roundtrip` と `hold` は 1 件だけ確かめ直すときに使う。15 往復の記録には数えない。本文の扱いは `batch` と同じ（接頭辞 + 連番 + 依頼 ID）。

```sh
node scripts/measure.ts roundtrip --target <id> --wait 25 --scope any --text 'seamless AC7 measurement: reply with one short line.' --log "$HOME/.seamless/measurements/ac7-single.jsonl"
node scripts/measure.ts hold --target <id> --scope any --log "$HOME/.seamless/measurements/ac7-single.jsonl"
```

## 6. 記録ファイルの読み方

1 行目は集計、2 行目以降は 1 送信 1 行。1 行目だけ `kind` が `batch`、以降は `kind` が `roundtrip`。

```text
{"kind":"batch","plan":"claude:5,codex-desktop:5,grok-bot:5","at":"...","entries":15,"submitted":15,"notSent":{},"falseReached":0,"mode":"real"}
{"kind":"roundtrip","id":"measure-...","target":"claude:<id>","at":"...","mode":"real","delivery":"submitted","stages":[{"stage":"accepted","status":"observed","evidenceCount":1}],"state":"...","reason":"...","replyId":null,"match":false,"seconds":..,"operations":1,"falseReached":false}
```

| 欄 | 意味 | AC7 での見方 |
|---|---|---|
| `entries` | 記録した送信の数（集計行）。失敗した記録も数える | 15。ただし 15 だけでは合格にしない |
| `submitted` | 送信できた件数（集計行）。`delivery` が `submitted` の行の数 | 15 |
| `notSent` | 送信しなかった件数の内訳（集計行）。キーは `error` の値、無ければ `delivery` の値 | `{}`（空） |
| `falseReached` | 書込みが `submitted` でないのに「渡った」段階を観測した件数（集計行） | 0 |
| `error` | 送信しなかった理由（`scope_conflict`、`duplicate`、`no_candidates`、`target_unavailable` など） | この欄がある行は送信していない。1 行でもあれば不合格 |
| `delivery` | 書込みの結果（`submitted`、`unknown`、拒否の名前） | `submitted` だけを送信済みとして数える |
| `state` | 保留などの状態（`held` など） | hold の枠で `held` を期待 |
| `reason` | 状態の理由（`claude_hold`、`codex_goal`、`unknown_reason`） | 製品の観測だけで決まる |
| `match` | 返信 ID を観測したか | AC7 の合否には使わない。返事は相手が seamless 経由で `replyTo` を付けて返したときだけ `true` |
| `seconds` | 依頼から観測までの秒数 | 参考値 |
| `falseReached`（各行） | その 1 件の判定 | すべて `false` |

`error` の 3 つは、どれも送信が起きていないことを示す。

- `scope_conflict`: 一覧の scope と送信の scope が違うか、`--scope current_work` で実行元のフォルダの外を指した。`--scope any` で走らせ直す。
- `duplicate`: 同じ本文を同じ相手へ送ろうとした。Bot への送信は送信済みの内容を 1 日保持するので、固定の本文を繰り返すと 2 件目以降がここで止まる。本文は連番で変わるため、通常の `batch` では出ない。
- `no_candidates`: その製品の相手が一覧に居ない。製品が休止中か、`--plan` の綴りが違う。

集計の確認。

```sh
head -1 <記録ファイル>
rg -c '"falseReached":true' <記録ファイル>
rg -n '"error":"' <記録ファイル>
```

1 つ目で `"submitted":15`、`"notSent":{}`、`"falseReached":0` を読む。`entries` が 15 でも `submitted` が 15 でなければ不合格。

2 つ目は 0 件のとき何も出力せず終了コード 1 になる。件数（`1` 以上）が出力されたら、その件数を 8 章の手順に送る。

3 つ目も 0 行で終了コード 1 なら合格。1 行でも出たら、その行の `error` を見て 8 章の表に従う。送信は起きていないので、件数を `submitted` に足さない。

1 件ずつの表。

```sh
node -e 'const fs=require("fs");for(const line of fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse)){if(line.kind==="batch"){console.log(`summary plan=${line.plan} entries=${line.entries} submitted=${line.submitted} notSent=${JSON.stringify(line.notSent)} falseReached=${line.falseReached}`);continue}console.log([line.target,line.delivery??"-",line.error??"-",line.state??"-",line.reason??"-",`match=${line.match}`,`falseReached=${line.falseReached}`,`seconds=${line.seconds}`].join("\t"))}' <記録ファイル>
```

### 6.1 本文が残らないことの確認

```sh
rg -F -- 'seamless AC7 measurement' <記録ファイル>
rg -F -- 'seamless AC7 measurement' ~/.seamless/measurements ~/.seamless/reservations
```

どちらも 0 行で終了コード 1 なら合格。記録に残るのは依頼 ID、相手、段階、状態、理由、秒数、操作回数だけ。予約は本文のハッシュだけを持つ。

検索語は接頭辞（`--text` に渡した文字列）だけにする。本文の後半の `#<連番>/<総数>` と依頼 ID は送信ごとに変わるので、検索語にすると取りこぼす。

製品側の会話には本文が残る。それは製品自身の記録で、seamless の記録ではない。AC7 の確認対象は上の 2 つ。

## 7. evidence.md への転記

`specs/2026-10-universal-wiring/evidence.md` の「AC の証拠」表に 1 行足す。

```text
| AC7 | 2026-10-20 | node scripts/measure.ts batch --plan claude:5,codex-desktop:5,grok-bot:5 --out <path> --wait 25 --scope any --text 'seamless AC7 measurement: reply with one short line.' | 0 | submitted 15 かつ falseReached 0。error 0 行。本文 0 件（rg 終了コード 1）。各製品 5 件 | <commit> |
```

その下に内訳の表を置く。依頼 ID は記録の `id` から取る。

```text
| 製品 | 状態 | 依頼 ID | delivery | state / reason | falseReached |
|---|---|---|---|---|---|
| Claude | 待機中 | measure-... | submitted | - | false |
| Claude | 待機中 | measure-... | submitted | - | false |
| Claude | 作業中 | measure-... | submitted | - | false |
| Claude | hold | measure-... | submitted | held / claude_hold | false |
| Claude | 再起動直後 | measure-... | submitted | - | false |
```

最後に 3 つを添える。記録ファイルのパス。`rg` の終了コードと行数。実行した commit（`git rev-parse HEAD`）。

`evidence.md` は `specs/` の下にある。施工役は触らない。転記は立花さんが行う。

## 8. うまくいかないとき

| 症状 | 見る場所 | 次 |
|---|---|---|
| `caller_unobserved`（終了コード 2） | 実行したシェルの祖先 | Claude の会話の子孫か Grok TUI から実行し直す |
| `codex_cli_unsupported` | 同上 | Codex CLI から実行している。Claude 側のシェルへ移る |
| `error: scope_conflict` の記録 | 送信した scope（`--scope`、既定 `any`） | 実行元のフォルダの外の相手へ送っている。`--scope any` で走らせ直す。送信は起きていない |
| `error: duplicate` の記録 | `--text` と依頼 ID | 同じ本文を同じ相手へ送った。接頭辞だけを `--text` に渡し、連番はスクリプトに付けさせる。送信は起きていない |
| `error: no_candidates` の記録 | `who --json`、`--plan` の綴り | 休止中か受信口なし。起こすか、別の会話を用意する |
| `target_unavailable` の記録 | `who --json` の `state`、登録の `status` | 登録が revoked か scope_unset、または limits の send が false |
| `delivery: unknown` | 記録の 1 行 | 成否不明。同じ依頼 ID で送り直さない（不変条件 6）。記録は `unknown` のまま残す |
| `falseReached: true` が 1 件でも | 記録の該当行 | S2。その製品は「渡った」「処理中」を出さず受理止まりにする。Issue を起こす |
| `held` が想定より多い | `limits.json` の `heldAfterSec` と製品の状態 | N と `--wait` の関係を確かめる。状態を作り直す |
| 15 件そろわない | 集計行の `submitted` と `notSent`、`--plan` | 製品を増やさず原因へ戻る（S1） |
