# universal-wiring: どうやって作るか（Plans）

状態: 2026-10-19 起草、同日 図面検査（Haiku 5.5）と敵対（Codex Astra）を反映して改訂 3。承認 2 回目（Plans.md）待ち。spec.md の AC1〜AC16、S1〜S8、H1〜H7 に対応する。
製品の不変条件（ルート spec.md 1〜8）は定義し直さない。段階の名前は spec.md の用語に従う。

## 1. 作りの方針

1. **公式経路を先に、内部依存は互換表で囲う。** Claude は `~/.claude/sessions/<pid>.json` の `messagingSocketPath`、`kind`、`status`、`name`、`peerProtocol`（2026-10-19 実測。公式文書の socket と env に対応する）。Codex の書込みは `codex queue --thread`。Desktop IPC の書込みへ切り替えるのは、queue が予約の状態 `submitted` に進む前に失敗を返したときだけ（成否不明では切り替えない。不変条件 6）。読取りは rollout と Desktop IPC（H2）。
2. **「渡った」は相手の記録で。** 書込みの成功（受理）と、相手の記録への出現（渡った）を分ける。「渡った」を生成するのは各アダプタの証拠の読み手だけで、書き手は生成しない。証拠の読み手は製品ごとに違う（Claude と Codex は記録ファイル、opencode は plugin が session に受け付けた応答、hooks の製品は hook の受領記録）。記録を読めたのに出現しないまま Open decision 1 の秒数が過ぎたら状態「保留中」。読めなければ「読取り失敗」、公式経路が拒否を返せば「拒否」。理由は製品ごとの観測で付ける。Claude: `~/.claude/settings.json` 系の `crossSessionInbound`、または sessions JSON と自分の権限モードから hold の既定に当たるか。Codex Desktop: IPC の状態が目標実行中。それ以外: 理由不明。
3. **アダプタは manifest + 1 ファイル。** 発見、同一性、書込み、証拠、権限、install 手順を manifest に書き、コアは manifest を読むだけ。
4. **常駐なし。** 照会のたびに読む。予約は `~/.seamless/reservations/`（現行）。
5. **公開面を削る。** 旧 `--registry` 方式、Claude Desktop の band mod、status panel、Dot の実験は npm の同梱物から外す（内部と試験には残す）。
6. **検証は hermetic。** `scripts/verify.sh` を、Keychain と Claude CLI を要する部分と要しない部分に分け、CI は後者だけ。Nestra V2 の AC27（一時のホーム、外への通信なし）と同じ条件。
7. **人の確認の印。** `markUnapproved` は現行の limits の仕組みを維持し、manifest 基盤へ移すときも「名簿なしの経路だけが付ける」を変えない（不変条件 3）。

## 2. 構成（新規 / 改修）

| 場所 | 新規 / 改修 | 役割 |
|---|---|---|
| `src/core/manifest.ts` | 新規 | manifest の schema と loader |
| `src/delivery.ts`、`src/status.ts`、`src/limits.ts` | 改修 | 段階 5 つ + 状態「保留中」、`heldAfterSec` |
| `src/adapters/claude.ts` | 改修 | sessions JSON の文書化された欄を使う。受信口なしの表示 |
| `src/adapters/codex.ts` | 改修 | 書込みを `codex queue` へ。IPC は読取りと fallback |
| `src/adapters/grok.ts`、`src/grok-hook.ts` | 改修 | manifest + hook 1 枚へ寄せる |
| `src/adapters/opencode.ts`、`cursor.ts`、`antigravity.ts` | 新規 | 各製品の発見と書込み |
| `src/manifests/*.json` | 新規 | 製品ごとの定義 |
| `src/setup.ts`、`src/doctor.ts` | 新規 | 導入と診断 |
| `src/cli.ts`、`src/mcp.ts` | 改修 | 1 コマンド、`who --json`、`status --json`、`setup`、`doctor` |
| `packages/opencode-plugin/` | 新規 | opencode の plugin（公式 API） |
| `hooks/cursor/`、`hooks/antigravity/`、`hooks/grok-cli/` | 新規 | hook 1 枚ずつ（turn 配送） |
| `scripts/verify.sh`（改修）、`verify-live.sh`（新規）、`measure.ts`（新規）、`status-html.ts`（新規）、`loop-step.sh`（新規、済み） | | 検証、計測、表示、ループ |

## 3. 経路（製品ごと）

| 製品 | 発見 | 書込み | 証拠（渡った / 処理中 / 返事） | 保留中の判定 | 段 |
|---|---|---|---|---|---|
| Claude Code | `~/.claude/sessions/*.json`（`messagingSocketPath`、`kind`、`status`、`cwd`、`name`） | socket に `{"type":"user",…}` | `~/.claude/projects/…/<sessionId>.jsonl` に依頼 ID / そのターン開始 / replyTo | 受理後 N 秒で jsonl に未出現。理由: `crossSessionInbound` が hold、または権限モードの組み合わせ（文書の既定: 片方が bypass）→ `claude_hold` | push |
| Codex CLI / Desktop | rollout（`~/.codex/sessions`）、Desktop は IPC の owner 照会 | `codex queue --thread <id> --message <本文>`（本文の上限は Open decision 2） | rollout に依頼 ID / turn 開始 / replyTo | 受理後 N 秒で未出現。Desktop の IPC が目標実行中 → `codex_goal` | push |
| opencode | plugin が書く `~/.seamless/peers/opencode-<session>.json` | plugin の `session.prompt`（公式） | plugin の応答と session event | plugin が busy を返した → 「次の区切り」 | push |
| Cursor CLI | hooks（sessionStart / stop / afterAgentResponse）が peers ファイルを書く。`~/.cursor/chats/<ws>/<session>/meta.json` は補助 | 受信箱ファイル + stop hook で次ターンに注入 | hook receipt、次の発話 | 待機中は人が起こすまで待つ、と表示 | turn |
| Antigravity CLI | hooks（S5: 実行ファイルと hooks の確認が先） | 受信箱 + hook | hook receipt | 同上 | turn |
| Grok CLI | `~/.grok/active_sessions.json`（内部）+ hooks | 受信箱 + Stop hook（現行） | hook receipt、次の発話 | 同上 | turn |
| Grok Bot | 名簿（本人登録、鍵で署名確認。不変条件 8） | webhook（HTTPS、署名）（現行） | 受理記録、返信 replyTo | 休止中は「起こすと届く」 | push + reply |

## 4. T3 Code との相性（Nestra V2 への接続）

Nestra V2（T3 Code 日本語版 + Nestra 層）は、routecli と seamless（botress を含む）を `packages/` に履歴ごと取り込む（Nestra の specs/2026-10-nestra-fork/spec.md O5、AC24。リーダーが 2026-10-19 に読んだ）。その前提で、公開版 seamless が守ること。

1. **Nestra 専用の部分を境界の外に置く。** 玄関口（gateway）は `~/.seamless/gateway.json` の有無で道が決まる任意アダプタ（Nestra の o3-gateway.md 2 章）。公開版のコアは gateway を知らず、manifest の仕組みで後から足せる。
2. **判断の受け皿に流せる形。** `seamless status --json` と、受信した依頼の記録（本文なし。ID、相手、段階、時刻、replyTo）を決まった形で出す。Nestra は「外の入口の判断を受け皿に並べ、答えを seamless で返す」（Nestra spec 7 章）。
3. **T3 のスレッドから送れる。** T3 の会話は seamless の MCP（4 道具）を呼べる（AC14）。
4. **T3 のスレッドを宛先にできるかは実機で判定する。** 2026-10-19 の実測（evidence.md）: T3 が起動する `claude --output-format stream-json` のプロセス（pid 10142、88557）には sessions JSON も socket も無い。観測した範囲で受信口を持つのは Claude Desktop の対話セッション（`kind: interactive`、`entrypoint: claude-desktop`、11 件）。v1 では T3 のスレッドは「受信不可（受信口なし）」と一覧に出す（AC16）。T3 側へ届けるのは Nestra が自分の口（T3 の `t3_thread_send`）で行う。
5. **検証が hermetic。** Nestra の AC27 と同じ条件で seamless の試験が通る。
6. **返信内の表示。** `status --json` から 5 段階を描く template を同梱し、T3 の `html_render` で出せる（AC15）。

## 5. 順番と週（AC の対応つき）

| 週 | 作業（tasks.md） | 対応 AC | 完了条件 |
|---|---|---|---|
| 1 | T12（最初）、T01、T02、T03、T04、T15、T19。未決 3（Antigravity の実行ファイル）を本人に確認 | AC4、AC5、AC6、AC7、AC11 | 計測の記録（本文なし）。誤って「渡った」0。人の作業: AC7 の 15 往復 |
| 2〜4 | T05、T06、T20、T11 | AC1、AC2、AC3、AC8 | 一時ホームで 10 秒以内。1 コマンドで 1 往復（人の作業）。CI 緑 |
| 5〜6 | T07、T08、T09、T10、T17 | AC9、AC10、AC15、AC16 | 共通部分の差分 0。AC10 と AC14 は人の作業 |
| 7〜8 | T16、T13 | AC12、AC13 | 秘密 0、同梱物一覧、5 指標の表（人の作業） |
| 9〜10 | T14、T18 | AC12 | H5、H6 の後に公開 |
| 11〜13 | 公開 β、issue 対応、互換表の月次追従 | AC11 | 第三者の issue に 1 週間以内に応答 |

## 6. 実装の回し方（H7、S8）

- 統合ブランチ `loop/integration` を main から作る。main は H5 まで触らない。
- tasks.md の各タスクを GitHub Issue にする。本文に `Depends-on: #番号` を書く。ラベル: `loop:ready`、`loop:in-progress`、`loop:blocked`、`loop:human`、`loop:review`（判定待ち）。
- 30 分に 1 回、T3 のスケジュールがこの会話を起こす。リーダーは `bash scripts/loop-step.sh` を走らせる。中身: 排他ロック（`.local/loop/lock` の mkdir）を取れなければ何もしない。休止の印（`.local/loop/paused`）があれば何もしない。`loop:in-progress` が 90 分を超えていれば `loop:blocked` に落とす。`loop:in-progress` があれば何もしない。`loop:ready` のうち `Depends-on` の全 Issue が閉じている最も番号が若い Issue を取り、作業ブランチ `loop/<番号>` を `loop/integration` から作り、施工役 opencode（Ollama Cloud、`deepseek-v4.1-flash:1017`、`--agent build --auto`）に依頼する。依頼文には Done when、触ってよいファイル、禁止（`~/` の設定、Keychain、本物の送信、外部通信、commit、specs/ の変更）を書く。
- 施工の後、`bash scripts/verify.sh`。終了コード 0 なら commit して `loop:review`（判定待ち）。非 0 なら wip commit して `loop:blocked`。連続 3 回 blocked で休止の印を置く（S8）。
- 判定（team-review、別家系）は、同じ commit で Issue の Done when を確かめる。PASS なら Issue を閉じ、`loop/integration` へ merge する。FAIL なら `loop:blocked`。判定はリーダーが 30 分ループとは別に、`loop:review` が溜まったときに回す。
- T12（hermetic CI）を最初の Issue にする。それまでの verify は Keychain と Claude plugin に依存するため、T12 より前の Issue は `loop:ready` にしない。
- push、PR、公開はしない（H5 の後）。main には commit しない。
- S8: 連続 3 回 blocked、作業ツリーが汚れて着手できない、着手中が 90 分超のときは、休止の印を置いて止まり、人が印を外すまで取らない。

## 7. Open decisions（案。AI が決めない。tasks は「Open decision の値」を参照し、値を固定しない）

1. 「保留中」と判定するまでの秒数 N。案: 20 秒。
2. `codex queue --message` の本文の長さ上限。案: 4,000 文字。超える本文は要約せず拒否する。
3. ループの作業ブランチ。案: Issue ごと（`loop/<番号>`）。

## 8. 検証コマンド（AC との対応。spec.md から手段をここへ移した）

| AC | コマンド / 手順 | 実行する人 |
|---|---|---|
| AC1 | `HOME=$(mktemp -d) time node src/cli.ts setup`（本物の導入。dry-run ではない）を 3 回。質問数を数える。`$HOME` 配下の変更ファイルを `find -newer` で数える | リーダー |
| AC2 | `node src/cli.ts who --json` の各行の `state` が 3 値のどれかで、実際の相手の状態（sessions の `status`、IPC、hooks の受信箱）と一致する試験 `tests/who.test.ts` | ループ |
| AC3 | `node scripts/measure.ts roundtrip --target <id>` を実相手で。依頼 ID と返信 ID の一致、秒数、操作回数を出力 | 人 |
| AC4 | `node scripts/measure.ts hold --target <claude bypass session>`。表示が `held` / `claude_hold`、jsonl に ID なし | 人 |
| AC5 | `node scripts/measure.ts hold --target <codex goal thread>`。表示が `held` / `codex_goal` | 人 |
| AC6 | `tests/delivery-unknown.test.ts`（書込み後に切断、同じ ID で再呼出し、書込み回数 1、状態 `unknown`） | ループ |
| AC7 | `node scripts/measure.ts batch --n 15` の記録ファイル。`falseReached` が 0 | 人 |
| AC8 | `node scripts/measure.ts footprint`（往復の前後で `ps`、往復完了後に `~/.seamless` と各受信箱の本文 0 バイト、往復中 1 秒ごとに `lsof -i -P` を標本し新規接続 0） | リーダー |
| AC9 | アダプタ追加の Issue の commit で、その直前の commit（親）との `git diff --stat <親>..HEAD -- src/core src/cli.ts src/mcp.ts src/delivery.ts` が 0 行 | ループ |
| AC10 | `node scripts/measure.ts roundtrip --target opencode-<id>` を待機中と作業中で | 人 |
| AC11 | `node src/cli.ts compat-md` と `who --json` の `versionStatus` | ループ |
| AC12 | `bash scripts/peer-secrets.sh`（0 件）、`npm pack --dry-run`（一覧）、`git grep -n -e "grok-bot-vm" -e "Bot ID" -e "accountRef"`（0 件）、内部 API の再現の判定表（T13 が `docs/release.md` に書く） | ループ + リーダー |
| AC13 | `node scripts/measure.ts compare` の表（Reason 導入後、順番に）。復帰成功率 = 既に開いている会話へ 10 回送って返信 ID が一致した回数 / 10（製品ごと） | 人（H3） |
| AC14 | T3 の会話から MCP `send` を 3 製品へ、`status` で replyTo 一致 | 人 |
| AC15 | `node src/cli.ts status --json <id> \| node scripts/status-html.ts` を html_preview で確認し、T3 の会話で html_render に出して段階を突き合わせる | リーダー |
| AC16 | `tests/who.test.ts` に、`messagingSocketPath` の無い sessions JSON（または sessions JSON の無い claude プロセス）が `unreachable: no_inbox_socket` で出る試験 | ループ |

実測での socket の場所: `/tmp/cc-socks/<pid>.sock`（sessions JSON の `messagingSocketPath`）。公式文書の `/tmp/cc-socks-<uid>` は、通常の場所が使えないときの代替。コードは JSON の欄を正とし、パスを決め打ちしない。
