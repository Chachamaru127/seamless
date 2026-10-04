# 終わった証拠

本文、思考、認証値は記録しない。

## 本文なしの一覧（T3a、2026-10-03）

結果: 経路あり。

- Codex Desktop 26.928.40906+12694 の `~/.codex/state_5.sqlite`（所有者は本人、mode 0644）に `threads` 表がある。
- 列 `id`、`cwd`、`archived`、`updated_at_ms` だけを読取り専用（`mode=ro`）で選べば、本文の列（`first_user_message`、`preview`、`title`）は取得しない。
- 実測: 会話 `01a0f59d-d3d1-79a2-948c-4a1f12a0a1a5` の cwd が `/Users/tachibanashuuta/LocalWork/Code/claudex`、archived 0 で返った。表は 8803 行、未アーカイブ 8676 行。
- 読む手段: Node 22 組み込みの `node:sqlite`（外部パッケージ不要）。
- 制約: Codex の内部データで公開の仕組みではない。対応の組（compat）で Codex の版を確かめてから使う。表の形が違えば作業場所を「未確認」にする。
- 不採用: rollout の先頭行 `session_meta` にも cwd があるが、同じ行に指示文（base_instructions、約 23KB）が入るため使わない。

## 第1便 T0、T0a、T4（2026-10-03）

- 施工: Codex Astra（gpt-6-astra、推論量 low、service_tier ultrafast）。1回目は依頼文の矛盾（T4 の完了条件が T5 の範囲を含んでいた）で正しく停止。tasks の T4 と T5 の境界を直して再依頼。
- 変更: `scripts/verify.sh`（strict 型検査を追加）、`src/native-runtime.ts`（版の直書きを撤去）、新規 `src/compat.ts`、新規 `src/limits.ts`、`tests/discovery.test.ts`（型注釈だけ）、新規 `tests/compat.test.ts`、`tests/limits.test.ts`、`tests/support/limits-writer.ts`。範囲外の変更なし（リーダーが変更前の複製と比較）。
- リーダーの環境での `bash scripts/verify.sh`: 実終了 0、114 試験 PASS（型検査を含む）。node v24.19.0、tsc 5.9.3。
- 施工役の環境では Unix socket の listen が EPERM になり、socket を使う既存の4件が失敗する（施工環境の制約）。
- 未了: 別家系の判定（段の完了点 M1 でまとめて行う）。

## 版 2.1.286（T0b、2026-10-03、G1 承認済みの試験用ペア）

- 対象: Claude 会話 f8352827-bd6c-4bfc-83bd-b6b1dd7a0a37（Claude Code 2.1.286、Desktop 同梱、pid 96054）、Codex 会話 01a0f59d-d3d1-79a2-948c-4a1f12a0a1a5（Codex Desktop 26.928.40906+12694）。
- 稼働記録の項目（pid、sessionId、peerProtocol 1、procStart、startedAt、messagingSocketPath、cwd）は 2.1.284 と同じ形。
- 方法: 対応表で 2.1.286 を「確認済み」にした試験用の複製（scratchpad）で製品の serve --native を実行。本体の表は変えていない。
- 結果: 両方向の read が ok。Claude → Codex の send（cldx-t0b-c2x-EFB6EAEC）が submitted、Codex の記録に peer として到達し、Codex の返答に nonce が出た。Codex 名義 → Claude の send（cldx-t0b-x2c-EFB6EAEC）が submitted、この Claude 会話で受信。
- 本体のまま（2.1.286 が確認中）では送受信が止まる。ただし理由が `caller_unobserved` で、版の未確認と区別されない（T18 で直す）。
- 1回だけ Codex の read（limit 100）が unavailable。再試行で ok。原因は未確認（全履歴の読込みの時間切れと推定）。
- 本体の対応表を「確認済み」にするのは G3b の承認後。

## 呼ぶ側（T1、2026-10-03）

- Claude: 道具（MCP）のプロセスは、会話のプロセス（pid 96054）の直接の子。親の pid と起動時刻で稼働記録の sessionId に一意に結び付く。結果: 一意に特定できる。
- Codex: 道具のプロセスは1つの app-server（pid 57938）の子で、同じ道具が20個ずつ立つ（会話ごとに立てていると推定）。各プロセスの作業場所はその会話の作業場所。環境変数に会話 ID はない。Codex 本体に `turn_metadata`、`x-codex-turn-metadata` などの名前があるが、MCP の道具呼出しに会話 ID が付くかは未確認。結果: 現時点では一意に特定できない（同じ作業場所に Codex 会話が2つ以上あると区別できない）。
- 2026-10-03 G3b 承認（立花さん）。本体の `src/compat.ts` で 2.1.286 を「確認済み」に変更し、`tests/compat.test.ts` の期待値を合わせた。verify.sh は下の再実行を参照。

## Codex 自身の呼ぶ側の見分け方（D1 の調査、2026-10-03）

- 出典: Codex Desktop 26.928.40906 に同梱の道具 `~/.codex/plugins/cache/openai-bundled/browser/26.928.40906/scripts/browser-service.mjs`（同じ仕組みが chrome、codex-app-tools にもある）。
- Codex は道具の呼出しごとに、MCP の要求の付帯情報 `_meta["x-codex-turn-metadata"]`（JSON の文字列か object）を付ける。
- 中身として読まれている項目: `session_id`（会話の ID）、`turn_id`、`thread_id`、`thread_source`、`model`。
- 同梱の道具の扱い: `thread_source` が `subagent` なら `thread_id`、それ以外は `session_id` を会話の ID として使う。`session_id` と `turn_id` が無いと「Missing required Codex turn metadata」で止まる。
- 付帯情報は Codex 本体が付けるもので、モデルが道具の引数として書くものではない。
- 未確認: 利用者が足した MCP サーバー（claudex など）への呼出しにも同じ付帯情報が付くか。同梱の道具で確認できたのは読む側のコードだけ。
- 2026-10-03 Codex 会話（試験用ペア）のシェルで確認: `CODEX_THREAD_ID` は設定あり、会話 ID と一致。`CODEX_SESSION_IDS` は設定なし。値は表示していない。環境変数はコマンドの前に書けば変えられるため、シェル経由の呼出しでは補助の手がかり（名乗りと同等）として扱い、親プロセスが Codex の app-server であることと作業場所の一致を合わせて照合する。

## 第2便 段 A（T2、T3、T5、T6、T6b、T7、T8）2026-10-03

- 施工: Codex Astra（low、ultrafast）。1回目は T7 の変換規則が未定義として全体を停止。リーダーが規則を決め（名簿にかかわらず「除外なし、同じ作業場所、操作の制限なし」の案と注意書き）、「判断待ちはそのタスクだけ飛ばす」と依頼文を直して再依頼。7件を施工、新しい試験 43 件。
- リーダーが実環境で一覧を試し、2つの問題を見つけて直した（`src/sessions-scan.ts`、`src/native-runtime.ts`）。
  1. 同じ作業場所の判定が「同じ git の worktree」で、claudex が親の `~/LocalWork/Code` リポジトリの中にあるため、582 種類の作業場所のほとんどが対象になり、1件ずつ git と稼働の問合せ（開いていない会話は 8 秒の時間切れ）を行って数分止まった。判定を「呼ぶ側のフォルダと同じか、その中」に変え、パスで先に絞り、git の結果を作業場所ごとに使い回す形にした。
  2. 一覧での Codex の稼働の問合せを、待ち時間 1.5 秒、16 件ずつ並列にした（IPC の待ち時間を引数で渡せるようにした）。
- 実環境の確認（この Claude 会話から、名簿も `--caller` も使わない新方式）: 呼ぶ側を Claude（祖先のプロセス）として特定、0.5 秒。一覧に同じ作業場所の Codex 会話 01a0f59d が ticket 付きで出た。ticket で送信（cldx-auto-1BB6C0A6）が submitted。
- `bash scripts/verify.sh`: 実終了 0、157 試験 PASS（作業場所の判定の試験 1 件を足した）。
- 未了: 段の完了点 M1 の別家系の判定。

## M1 の判定（1回目、2026-10-03）

- 判定役: Claude Opus 5.5（effort high、読取り専用）。施工の大部分が Codex のため逆の家系。差分（変更前の複製との diff 1024 行）と verify の記録を渡した。
- 結果: FAIL。T0a、T4、T3、T6、T6b、T8 は PASS。T0 は条件付き PASS（verify の記録に tsc の終了コードが残っていない）。FAIL は T2、T5、T7。
  - T2（重大）: Codex を CLI から呼んだときの見分けが環境変数 `CODEX_THREAD_ID` と作業場所だけで、同じ作業場所の別の Codex 会話を名乗れる。
  - T5（中）: 照会（revalidate）への制限の効き目を試験が確かめていない（`notEqual('ok')` は成功の `validated` でも通る）。
  - T7（中）: 完了条件の「今の名簿の変換結果」を試験が使っていない。片方向の名簿が制限なしに広がることを注意書きが伝えない。
  - そのほか中: 除外の作業場所が完全一致で中のフォルダに効かない、実パスでない書き方が黙って効かない、リーダーが足した先絞りに試験がない、Codex の MCP 経路で作業場所の補助照合がない。軽7件。
- T7 の追加確認（リーダー）: 今の `.local/interop-pair.json` で `migrate`（`--write` なし）を実行。案は既定どおり、notes に会話 ID と世代は出ず、`~/.claudex/limits.json` は作られなかった。

## 呼ぶ側 T1b（2026-10-03）

- 方法: Codex の設定ファイルを変えず、`codex exec -c mcp_servers.probe...` で1回の実行に限って調べる道具を足し、Codex に1回呼ばせた（codex-cli 0.160.0、gpt-6-astra、読取り専用の sandbox）。道具は受け取った付帯情報の項目名と会話 ID だけを記録した。
- 結果: 利用者が足した道具への tools/call にも `_meta` が付く。項目は `callId`、`x-codex-turn-metadata`、`threadId`、`sessionId`、`windowId`、`itemId`、`progressToken`。`x-codex-turn-metadata` の中は `session_id`、`thread_id`、`turn_id`、`thread_source`（user）、`model` など。
- 2回目の実行で、`session_id`、`thread_id`、`_meta.threadId`、`_meta.sessionId` がすべて、その実行の会話 ID（01a10231-9ef2-7671-8f36-62efe16706aa）と一致した。
- 道具のプロセスには `CODEX_THREAD_ID` が渡っていなかった（シェルのコマンドにだけ渡る）。
- 未確認: Desktop 同梱の Codex（0.159.2）での同じ動き。T26 の導入時に確かめる。Desktop 同梱の道具（browser など）が同じ項目を読むことは確認済み。
- 決定（2026-10-03 立花さん）: 付帯情報が付いたので、Codex を呼ぶ側とする経路は道具（MCP）だけにし、コマンド経由（`CODEX_THREAD_ID`）は外す。

## 処理開始の根拠 T13a（2026-10-03、試験用ペアの既存の記録を読取りだけで調査）

- Codex: claudex の依頼（functionCallOutput、namespace claudex / claudex_test）は、待機中なら新しい turn の先頭（0番目）に入る。5件すべてで、同じ turn の中に依頼の後ろの項目（agentMessage、reasoning、commandExecution など）が続いた。判定: 「依頼の入った turn に、依頼より後ろの項目が1つ以上ある」を処理開始とする。turn の ID で依頼と結び付くので、無関係な作業を拾わない。
- Claude: 待機中の依頼は peer の user 記録、作業中の依頼は queued_command の添付として入る。22件すべてで、依頼の後の最初の assistant 記録から parentUuid をたどると、依頼の記録に戻れた。`promptId` は依頼と応答を結び付けない（同じ値が複数の依頼に付き、assistant 記録に付かない）。判定: 「parentUuid をたどって依頼の記録に戻れる assistant 記録がある」を処理開始とする。
- 注意: 作業中に届いた依頼では、処理開始は「会話に取り込まれ、その後に応答が続いた」ことまでを示す。依頼に従って行動したかは示さない。

## 第3便と Codex Desktop の更新（2026-10-03）

- 第3便（Codex Astra、low、ultrafast）: 審査の指摘 10 項目を施工。Codex のコマンド経由の経路を削除、Codex の MCP 経路に作業場所の補助照合、照会の試験の強化、除外を中のフォルダと realpath に効かせ空の除外を拒否、移行の注意書き、先絞りの試験、壊れた設定でも clear を通す、一覧の既定を read、clear の hash を null、50件で切った件数の表示。
- リーダー: verify.sh に型検査の開始と終了の記録を足し、型検査の対象に tests/support を加えた。Plans の古い記述を直した。
- 第3便の後、私の環境で既存の試験1件（Codex failure response after native frame is unknown）が3回続けて失敗。原因は Codex Desktop の更新（26.928.40906+12694 → 26.930.31730+12947、アプリも再起動）で、試験が偽の Codex を相手にしながら実物の Desktop の版を読んでいたこと。`createNativeRuntime` に版の差し替え口（desktopVersion）を足し、試験で版を固定した。
- `bash scripts/verify.sh`: 実終了 0、typecheck exit=0、170 試験 PASS。
- 本体の動き（対応表に 26.930.31730 がない）: 一覧で Codex の作業場所が unknown になり、Codex 会話は出ない。設計どおりの停止（AC18）。
- 新しい版の実測（G1 の試験用ペア、対応表に新しい版を足した複製）: 一覧に Codex 会話 01a0f59d が出た（世代が bdd313cb… から 48665a1d… に変わり、名簿なしで追従）。read（limit 3）ok、全履歴（limit 100）ok で complete true。ticket での send（cldx-v930-E646FBE2）が submitted、Codex の記録に peer として到達し、Codex の応答が続いた。
- 本体の対応表へ足すのは G3b の承認後。

## M1 の判定（2回目）と第4便（2026-10-04）

- 2回目の判定（Opus 5.5）: FAIL。前回の重大と中はすべて直ったと確認。残りは T7 の完了条件の文言（リーダーが判定役の推奨 A に沿い、合成の名簿3種の試験と実ファイルでの手動確認に改めた）と、新しい中1（Claude の会話の中から起動した Codex が、Claude として特定される）。全文は `.local/build/m1-review-2.md`。
- 第4便（Codex Astra、low、ultrafast）: 祖先の探索を一番近い会話のプロセスで止める、除外の作業場所を絶対パスだけにする、書く直前の再照合で拒否したときに予約を残さない（同じ ID で再試行できる。書いた後の予約は残す）、select の既定を read にそろえる。
- `bash scripts/verify.sh`: 実終了 0、typecheck exit=0、179 試験 PASS。実環境で、この Claude 会話から名簿なしの一覧が動くことを再確認。

## M1 の判定（3回目、2026-10-04）: PASS

- 判定役: Claude Opus 5.5。全文は `.local/build/m1-review-3.md`。2回目の指摘はすべて直った（軽2 は止まる側に倒れるため対応不要）。T7 は改めた文言で PASS。段 A の全タスクが完了し、verify は実終了 0。
- 新しい指摘（M1 は止めない）:
  - 中: Codex かどうかを実行ファイルの名前（`CodexCLI.app` を含む、またはファイル名が `codex`）だけで決めている。`codex` という名前のファイルを置けば、Codex の祖先を装える。期限: T26 の前。
  - 軽: 名前の前提の実測。→ リーダーが実測した（下）。
- 実測（リーダー）: この Claude 会話のシェルから `codex exec`（codex-cli 0.160.0、sandbox read-only）を起動し、その Codex に `node src/cli.ts sessions '{}'` を実行させた。結果は `caller_unobserved`（reason `native_ancestor_missing`）。Claude の名義にはならず、止まる側に倒れた。Codex の実体は `~/.codex/packages/standalone/releases/0.160.0-aarch64-apple-darwin/bin/codex`（名前は codex）。理由が `codex_cli_unsupported` でないのは、sandbox の中から祖先のプロセスを調べられないためと推定（未確認）。

## 第5便 段 B、段 C、T2c（2026-10-04）

- 施工: Codex Astra（low、ultrafast）。T2c、T9、T10、T11、T12、T13、T14 を施工、新しい試験 32 件。結果は `.local/build/batch5-result.md`。
- リーダーの実環境確認:
  - 名簿なしの一覧を2回呼び、1回目は change=unknown（比べる相手なし）、2回目は none。`~/.claudex/seen.json`（mode 0600）が作られた。
  - 試験用ペアの確認経路（T14）: 既定の `~/.claudex/limits.json` を渡すと `compat_check_requires_test_limits` で拒否。
  - 試験用の制限の設定（同じ作業場所のもう1つの Claude 会話 44043390 を除外、send を止めたもの、scratchpad に mode 0600）では、最初 `compat_check_pair_required` で止まった。原因: 組の数を Codex の稼働の問合せより前に数えるため、同じ作業場所の Codex の会話（アーカイブ前 26 件、ほとんどは開いていない）が全部数えられた。
  - 問合せの後に数える形へ一度変えたが、「未確認の版では組以外の会話に接続しない」既存の試験が落ちた。試験の意図が正しいと判断して戻し、代わりに `compat-check --target <会話>` を足して、組を呼ぶ側と指定の1件に絞る形にした（`src/compat-check.ts`、`src/automatic.ts`、`src/cli.ts`）。
  - あわせて、作業場所のフォルダが消えた Codex 会話があると、除外の判定の realpath が例外を出して一覧全体が止まる穴を直した（失敗したら元のパスで比べる）。試験に消えたフォルダの会話を入れた。
  - `compat-check --target codex:01a0f59d-…` で、Codex Desktop 26.930.31730+12947（checking）のまま、試験用ペアの一覧と読取りが `compat_check_passed`。
- `bash scripts/verify.sh`: 実終了 0、typecheck exit=0、212 試験 PASS。

## 段 B・C の判定（2026-10-04）: PASS

- 判定役: Claude Opus 5.5。全文は `.local/build/m3-review-1.md`。T9、T10、T11、T12、T13、T14、T2c がすべて PASS。M3 は PASS。M2 は G4 と T11b を除いて PASS。重大 0、中 2、軽 8。
- 中1: Codex の既知のインストール先に、利用者が書き込める `~/.codex/packages/standalone/releases/*/bin/codex` が入っている。偽物を置けば通る。推奨はコード署名の照合。
- 中2: 試験用の組の指定はコードではなく G1 で担保。Plans.md に注記した。
- コード署名の実測（リーダー）: Desktop 同梱の codex と standalone の codex 0.160.0 は、どちらも Developer ID Application: OpenAI OpCo, LLC（2DC432GLL2）で署名され `codesign --verify --strict` が ok。Claude Code 2.1.286 は Anthropic PBC（Q6L2SF6YDW）で ok。`/bin/sh` を codex の名前で複製した偽物は TeamIdentifier なし。
- 2026-10-04 立花さん承認: G3b（Codex Desktop 26.930.31730+12947 を確認済みに。反映は第6便で、試験が本物の対応表に依存しない形へ直してから）、G4（探索仕様の冒頭に改訂の注記。T11b 完了、M2 完了）、T2d（コード署名の照合。第6便）。

## 第6便 段 D の中心、G3b、T2d（2026-10-04）

- 施工: Codex Astra（low、ultrafast）。結果は `.local/build/batch6-result.md`。新しい試験 25 件。
- 実環境（リーダー、試験用の組）: 実物のコード署名の照合を通して呼ぶ側（Claude）を特定。Codex Desktop 26.930 が確認済みになり、一覧に Codex 会話 01a0f59d が ticket 付きで出た。ticket で送信（cldx-d-54EA6403）、5 秒後の照会で accepted と reached が observed。
- 不具合（リーダーが修正）: Codex の構造の取り出しが turn の ID を `turn.id` で読んでいたが、実物の snapshot の項目名は `turnId`。処理開始が常に unobserved になっていた。`turnId` を読むよう直し、実物と同じ形の試験を足した。修正後、実環境で processing が observed。
- 観測: Codex は依頼を受けて返信を試みたが `caller_unobserved / codex_cli_unsupported` で止まった（Codex を呼ぶ側とする経路は MCP だけで、Codex にはまだ claudex の道具が入っていない。段 F で解消）。照会の待機 60 秒は `wait_limit`（processingCancelled false）で終わり、replied は unobserved。
- 気づき: 一覧に、同じ作業場所の Codex 会話 37 件（ほとんどは Desktop で開いていない unreachable）が並ぶ。T20 で各相手の状態を出すようにしたため。既定の表示は立花さんの判断待ち。
- `bash scripts/verify.sh`: 実終了 0、typecheck exit=0、238 試験 PASS。

## 第7便 送り主の照合と段 E（2026-10-04）

- 施工: Codex Astra（low、ultrafast）。T21b、T22、T24。新規 src/inbound.ts、tests/inbound.test.ts、tests/privacy.test.ts、specs/202610-everyday-use/storage.md。結果は `.local/build/batch7-result.md`。
- `bash scripts/verify.sh`: 実終了 0、typecheck exit=0、244 試験 PASS。
- 実環境: 一覧の `inbound` は 0 件。新方式の受信の照合は新方式の宛名（`claude:<sessionId>`）の依頼だけを対象にし、これまでの受信はすべて旧方式の宛名（`claude-current`）だったため。新方式でこの会話へ送れる相手が今はいない（Codex は claudex の道具が未導入、同じ作業場所のもう1つの Claude 会話 44043390 は G1 の範囲外）。実環境での確認は段 F（T26、T27）の後。

## 段 D・E の判定（1回目）と第8便（2026-10-04）

- 1回目の判定（Opus）: FAIL。重大1（送り主の照合が部分一致で偽物が verified）、中5、軽9。M5 は T23 未実施のため未完了。全文は `.local/build/m45-review-1.md`。
- リーダーの実測: `codesign --verify --strict -R='anchor apple generic and certificate leaf[subject.OU] = "<チームID>"'` で、Desktop 同梱と standalone の codex（2DC432GLL2）、Claude Code（Q6L2SF6YDW）は通り、違うチーム ID、/bin/sh の複製、ad-hoc 署名は落ちた。
- 第8便（Codex Astra、low、ultrafast）: 送り主の照合を完全一致と宛先の照合に、段階の照合に送り主を、署名の照合を -R の要求に、send の入力定義から最上位の oneOf を外す、呼ぶ側の Claude の版の未確認を unsupported_version に、除外した相手の稼働記録を読まない、PID 再利用を process_exited に。結果は `.local/build/batch8-result.md`。
- リーダー: verify.sh の最後に `echo "verify: exit=0"` を足した。
- `bash scripts/verify.sh`: 実終了 0、typecheck exit=0、256 試験 PASS、記録の最後に `verify: exit=0`。実環境で、実物の -R の署名の照合を通して一覧が動き、Claude 44043390 と Codex 01a0f59d が online。
- T23（実会話での承認の格上げの観測）: 未実施。立花さんの判断待ち。
- 2026-10-04 立花さん決定: T23 は段 G で試験専用の新しい Codex 会話を立てて行う（M5 は T22、T24 で完了）。一覧は既定で開いている会話（online）だけを出し、`includeOffline` のときだけ全部出す。claudex は独立したリポジトリにし、名前を seamless に変え、CJ-Plugin へは symlink で取り込む（計画中）。
- 段 D・E の判定（2回目、Opus）: PASS。重大 0、中 0、軽 5。M4 PASS。全文は `.local/build/m45-review-2.md`。

## 2026-10-04 seamless への切り出し

- 立花さん承認（「推奨でOK」）: ① 外から見える名前をすべて seamless にし、読む側は旧名 claudex も受け付ける。`~/.claudex` の中身は `~/.seamless` へ移す。② 手元の commit まで。GitHub への push とリモートの作成は別に承認を取る。③ CJ-Plugin に symlink と限定配送を足し、配送の予定（plan）の表示で止める。
- 独立リポジトリ: `git init`（main）。最初の commit eb09f24。除外は `.local/`、`out/`、`output/`、`docs/reports/agmsg-comparison-evidence/`（他社コードの差分 3.3MB）、`experiments/*/results/`（実会話の断片）、`.harness-mem/`。入る 144 ファイルを `sk-`、`ghp_`、`AKIA`、`PRIVATE KEY`、`xox[abp]-`、`Bearer` で走査して 0 件。route-live の実行フォルダ `20260926T132907-3ae7aa62/` は `.local/live/` へ移した。
- 第9便（Codex Astra low ultrafast）: 改名と、一覧の既定を online だけにする変更。施工の環境では listen の EPERM で4件が落ちる（既知）。リーダーの環境で 269 試験 PASS、`verify: exit=0`。commit 23a43a2。
- 第9便の判定（Opus 5.5、別家系）: PASS。重大 0、中 2、軽 6。全文は `.local/build/b9-review-1.md`。
  - 中-1（世代が変わった会話が既定の一覧から1回だけ消える）: 推奨 B で直した。隠すのは走査が「動いていない」と見た会話だけ。既存の試験を既定の一覧で確かめる形に戻した。
  - 中-2（`~/.claudex` の実データ）: 決定①どおり `cp -Rp` で `~/.seamless` へ写した（reservations 17件、key、seen.json。権限 0700 と 0600 を保持。key は cmp で一致）。旧 `~/.claudex` は消さずに残した。
  - 軽-2: 似た道具名と server 名を拒む試験を足した。軽-1、3、4 は未対応（後述の残り）。
  - 修正後 275 試験 PASS、`verify: exit=0`。commit 7a8af2e。
- フォルダの移動: `~/LocalWork/Code/claudex` → `~/LocalWork/Code/seamless`。旧パスは `claudex -> seamless` の symlink で残した。親の Code リポジトリはこのフォルダを追跡していない（`git ls-files` 0件）。
  - 移動前: この Claude 会話 f8352827 を呼ぶ側として特定。online は Claude 44043390 と Codex 01a0f59d、隠した数 39。
  - 移動後: 実体のパスと旧名の symlink の両方から同じ結果（呼ぶ側 f8352827、cwd は `/Users/tachibanashuuta/LocalWork/Code/seamless`、online 2件、隠した数 39）。両側で realpath を取って比べているため（`src/native-runtime.ts` 30行、`src/caller.ts` 72行、`src/sessions-scan.ts` 35行）。移動後も 275 試験 PASS。
- CJ-Plugin（ブランチ seamless-mcp、未 commit）: `plugins/seamless -> ../../seamless`、`integrations/seamless/`（delivery.py、test_delivery.py、README.md）、`bin/wire.sh` の `--seamless-mcp` 分岐と check の一覧への seamless の追加。fixture 試験 11 件 OK。
  - 実環境の plan: ok。書く先は registry-recovery、registry（`~/.claude.json`）、codex（`~/.codex/config.toml`）、codex-owner。起動は `~/.local/share/mise/installs/node/24/bin/node /Users/tachibanashuuta/LocalWork/Code/seamless/src/cli.ts mcp`。Grok は書かない（Claude 互換で見える。呼ばれても呼ぶ側の照合で止まる）。plan の全文は `.local/build/seamless-plan.json`。
- CJ-Plugin の配送の部品の判定（Codex Astra、別家系）: 1回目 FAIL（重大 0、中 2、軽 2。守りの弱化は無し、試験が性質を確かめきれていない）。引数拒否の試験に `assert_not_called()`、OWNED_DRIFT、完全一致した未所有定義を所有しない、事前検査後の CONCURRENT_CHANGE、設定の symlink の UNSAFE_PATH、wire.sh の不正引数の拒否を足し、README の「秘密を読まず」を実装に合わせた。fixture 17 件 OK。2回目 PASS（新しい指摘なし）。全文は `.local/build/cj-review-1.md`、`cj-review-2.md`。
- 残り: 第9便の判定の軽-1（受信で `_test` の名前空間を拒む試験）、軽-3（CLI の `--include-offline` が JSON 側の値を検証せず上書き）、軽-4（`read --include-offline` が SyntaxError で拒まれる）。apply（立花さんの承認待ち）。push とリモートの作成（別承認）。

## 2026-10-04 配送の apply と段 F の最初の観測

- 立花さん承認（「①②とも推奨でOK」）: ① apply、② CJ-Plugin の commit と PR。
- apply: 直前に plan を取り直し、server、source、changes、grok、入力の役割が承認した plan と一致することを確かめてから実行。applied は registry-recovery、registry、codex、codex-owner。`check --seamless-mcp` ok、CJ-Plugin 全体の `wire.sh check` は FAIL 0 / WARN 4（WARN は以前からの archive と fable-advisor）。`codex mcp get seamless` で登録を確認。`~/.claude.json` の seamless は apply の後も残っている。
- CJ-Plugin: commit 4498ffa を `seamless-mcp` ブランチで push し、PR https://github.com/Chachamaru127/CJ-Plugin/pull/15 を作った（MERGEABLE、CLEAN、CI なし）。merge は自動承認の仕組みが「レビュー無しの merge」として止めたので、立花さんに任せる。
- 発見1: Codex の起動時に「MCP server startup failed server_name="seamless" error=-32602 invalid_params」。原因は tools/list の引数。Codex 0.160 は `{"_meta":{"progressToken":0}}` を付けて送る（標準入力の記録で実測）。seamless は空以外を拒んでいた。MCP の定義どおり cursor（文字列）と _meta（オブジェクト、progressToken は文字列か数値）だけを受け付けるよう直した（commit 6d2f0ac、58ac410）。判定（Codex Astra）は1回目 FAIL（型の検証なし）、2回目 PASS。277 試験 PASS、`verify: exit=0`。
- 修正後、`codex exec` の新しい会話から seamless の sessions を呼べた。返事は `caller_unobserved / native_identity_unobserved`。`missing_turn_metadata` ではないので、Codex は `_meta` の session_id を付けている。特定できないのは、`codex exec` の会話が Codex Desktop の持ち物ではなく、Desktop の IPC で owner が見つからないため（設計どおり。対応表は Codex Desktop だけ）。
- 発見2: 端末の Claude Code CLI は 2.1.289 に更新されていた。`claude -p` から呼ぶと `unsupported_version / 2.1.289`（対応表に無い版で止まる設計どおり）。動いている Desktop の Claude の会話 16 件はすべて 2.1.286（確認済みの版）。
- 未観測: Desktop の Claude の新しい会話と、Desktop の Codex の新しい会話から seamless を呼ぶ経路（T26 を含む）。MCP の設定は会話の開始時に読まれるので、新しい会話が要る。

## 2026-10-04 段 F: Desktop の新しい Claude の会話からの経路

- 立花さんが CJ-Plugin#15 を merge（squash、dd5cafc）し、Desktop で新しい会話「シームレス」（local_506be96d、中の ID 859d7cf9、Claude Code 2.1.286）を立てた。Desktop は worktree `seamless/.claude/worktrees/hello-6d7bef` の中で会話を動かす。
- 一覧（`scope: same_repository`）: status ok。呼ぶ側は provider claude、source `claude-ancestor`、nativeId 859d7cf9。候補は claude 44043390、claude f8352827、codex 01a0f59d（すべて online）、offlineHidden 50、codexWorkspace observed。既定の current_work では、worktree の外にある会話は見えない。
- 送信（859d7cf9 → この会話 f8352827、id `seamless-f-claude-to-claude-1`）: `submitted`。track: accepted 06:10:51、reached 06:10:57、processing 06:10:59 を観測。replied は未観測（試験文が「返事は不要」のため想定どおり）。
- 受信側（f8352827）の照合: inbound に `sender: verified`。新方式の宛名で届いた依頼の照合を初めて観測した。
- 軽の発見: ① track に scope を付けると invalid_params（send の道具の説明には scope があるので、呼ぶ側が付けやすい）。② `wait_limit` が MCP の道具のエラー（isError）として返る。
- 未観測: Desktop の新しい Codex の会話からの経路（T26 の `_meta`、Codex → Claude の送信）。Codex の会話の記録に、新しい会話はまだ無い。

## 2026-10-04 段 F: Desktop の新しい Codex の会話との往復

- Codex Desktop の新しい会話 01a10594-266e（作業場所 seamless、generation 48665a1d）が seamless の sessions を呼べた。呼ぶ側は source `codex-turn-metadata` で特定（T26: Desktop の Codex も `_meta` の session_id を付ける）。
- Claude（f8352827、CLI 経由）→ Codex 01a10594（id `seamless-f-claude-to-codex-1`）: submitted。track で accepted 06:24:56、reached 06:24:57、processing 06:24:57 を観測。Codex 側の inbound は `sender: declared`（送信を `node src/cli.ts send "$(cat 依頼.json)"` で行い、依頼 ID がコマンドの文字列に無いため。照合の設計どおり）。
- Codex は依頼を受けたが、`humanApproval: false` を理由に送信を止め、立花さんに許可を求めた。立花さんが許可した後に送信。
- Codex 01a10594 → Claude f8352827（id `seamless-f-codex-to-claude-1`）: この会話に届き、inbound は `sender: verified`。Codex 側の30秒の track は accepted のみ観測、reached は未観測で wait_limit。届いたのは、この会話が作業中で、依頼が順番待ち（作業の合間の割り込み）として渡った時。到達の照合が、この渡り方を数えていない可能性がある（未確認）。
- 立花さんの指示（2026-10-04）: 「配線を作るだけで、この辺の制約は機能としては残すけどデフォはOFFで」。Codex の道具の承認を seamless の配送で既定「承認なし」にする変更は、Claude Code の自動判定に危険と判断されて止まった（変更は入れていない）。受信側が人の許可を待つ動き（不変条件3）を既定で外すかは、仕様の変更として立花さんに確認中。

## 2026-10-04 封筒の印を既定で外す（第10便）と、その後の観測

- 立花さん決定: seamless は配線だけを持ち、届いた後の判断は受け取った AI が自分の権限で行う。制約は機能として残し、既定は OFF。
- 第10便（Codex Astra）: 封筒の `humanApproval:false` を既定で付けない。limits.json の `markUnapproved:true` のときだけ付ける。受け取る側は印なしと false を受け付ける。291 試験 PASS。commit 0f0868c。判定（Opus 5.5）PASS、中2件（limits が壊れた瞬間の送信が unknown として予約される、README の説明の位置）を b1139b2 で直し、判定（Codex Astra）2回目 PASS。
- CJ-Plugin: Codex の seamless の欄の承認（`default_tools_approval_mode`、`tools`）を本人の設定として扱い、配送は書かず消さず照合にも含めない。PR https://github.com/Chachamaru127/CJ-Plugin/pull/17（判定 Codex Astra PASS）。立花さんが merge した後に `~/.codex/config.toml` の `[mcp_servers.seamless]` に `default_tools_approval_mode = "approve"` を足す予定。
- 実会話の観測（07:07）: この会話から Codex 01a10594 へ印なしの封筒で依頼（id `seamless-f-claude-to-codex-2`）。accepted、reached、processing を観測。Codex は依頼を読んだうえで「追加依頼は別の会話から届いたため、人間からの送信承認を必要とする運用規則に従って止めています」と返し、送り返さなかった。
- 原因の見立て（確信度 medium）: 止めているのは seamless の印ではなく、Codex 側の判断。根拠: 印を外しても止まった。Codex の会話の記録の指示（developer）にも、CJ の契約書（contract/AGENTS.md）にも「別の会話の依頼は人の承認が要る」という文は無い。考えられる出どころは、(1) 届いた依頼が Codex には道具の結果（functionCallOutput）として渡り、道具の結果の中の指示には従わないという Codex の安全の既定、(2) CJ の契約書の Risk Gates の「外部送信」を、seamless の送信に当てはめた解釈。どちらかは未確認。同じ会話の前の流れ（前回は許可が要った）も効いている可能性がある。

## 2026-10-04 Codex の承認を本人の設定で外す

- CJ-Plugin#17 を立花さんの指示で squash merge（d91b1c2）。
- 立花さんが `~/.codex/config.toml` に `default_tools_approval_mode = "approve"` を足した。1回目は `[projects."…/crm-harness"]` の欄に入った（seamless の欄の直後に空行が無く、次の欄の見出しが続いていたため）。立花さんが seamless の欄へ移した。tomllib で seamless の値が approve、crm-harness は trust_level だけに戻ったことを確認。
- 照合: `check --seamless-mcp` は変更なし、全体の `wire.sh check` は FAIL 0 / WARN 4。
- `codex exec -s read-only` から上書きなしで seamless の sessions を呼べた（前回は「MCP tool call requires approval, but approval policy is never」で止まっていた）。返事は caller_unobserved（exec の会話は Desktop の持ち物ではないため。設計どおり）。
- この Claude の会話は立ち上げ直しで中の ID が b2188eef に変わり、MCP の道具 mcp__seamless__sessions から呼ぶ側 `claude-ancestor` として特定できた。候補は claude 859d7cf9、claude 44043390、codex 01a10594、codex 01a0f59d（すべて online）、offlineHidden 53。
- 改善の候補: 配送が書く seamless の欄の後に空行が無く、手で行を足すと次の欄に入りやすい（共通の書き出しの癖）。

## 2026-10-04 欄の空行と軽い指摘3件（立花さん「1と2を推奨で進めて3まで完了」）

- CJ-Plugin#18（c149631、squash merge）: 配送が書く seamless の欄の後に空行を入れる。判定（Codex Astra）1回目 FAIL（複数行の文字列の中の見出し風の行で値を変える）、空行の候補ごとに設定全体を読み直して同じときだけ入れる形に直し、2回目 PASS。fixture 23 件 OK、全体の `wire.sh check` FAIL 0。
- 作業中の Claude への到着（実測）: 受け手が作業中だと、Claude Code は届いた瞬間に `queue-operation enqueue`（uuid も peer の印も無い、content は送った本文そのもの）だけを書き、会話に取り込んだ時に `attachment queued_command` を書く（時刻は届いた時刻のまま）。前回は 06:26:03 に enqueue、06:26:51 に attachment で、Codex の追跡（06:26:07〜06:26:38）は reached を見られなかった。enqueue の content は送った `JSON.stringify(payload)` とバイト単位で一致した。
- 第11便（Codex Astra）: track の scope を受け付けて無視する、wait_limit を道具のエラーにしない、送った本文の SHA-256 を依頼の記録に残し enqueue の本文の SHA-256 と一致したときだけ reached にする（本文を封筒として解釈しない）。commit fd3e961。判定（Opus 5.5）PASS、軽5件。
- 軽2（send の返事にハッシュが載る）を 2b251b5 と b37c26d で直した。判定（Codex Astra）1回目 FAIL（拒否で早めに返す経路に残る）、2回目 PASS。296 試験 PASS、`verify: exit=0`。
- 残り（軽、次の候補）: ハッシュが鍵なしの SHA-256（記録を読める人は短い本文を推測して当否を確かめられる。既存の hash は鍵付きの HMAC）、enqueue の合成 id が同じ時刻で重なりうる、`isRecord` が payloadSha256 の型を見ない。
- GitHub: 非公開のリポジトリ https://github.com/Chachamaru127/seamless を作り、main（925125d まで、17 commit、144 ファイル）を push。送る前に追跡中のファイルと全履歴を秘密のパターンで走査し、当たりは evidence.md の走査パターンの説明文だけ（値ではない）。

## 2026-10-04 純正の会話探しとの比較、未確認2点、新しい版で止めない

- 比較ページ: docs/reports/2026-10-04-native-vs-seamless.html（Artifact で公開、非公開）。同じ会話から純正 `ListAgents` は 109件（このMacの Claude 14、クラウド 23、Remote Control 72、Codex 0）、seamless の既定 4件（Claude 2、Codex 2）、範囲 any 16件（Claude 14、Codex 2）。
- 純正の一覧の作業フォルダ（実測）: Remote Control に接続していない `claude -p`（2.1.289）で `ListAgents` の生の結果を取り出した。15件のどの行にも作業フォルダが無い。Remote Control の有無と関係なく、道具の結果に作業フォルダは入らない。同名の会話が複数あるときは未確認。
- 権限確認を飛ばす受け手での保留（実測）: seamless が Claude の受け口へ送る1行（type user、session_id、from、uuid、msg_id、message）には、送り主の権限モードを名乗る欄が無い。道具と MCP を外した試験用の `claude -p`（2.1.289）を受け手にして同じ形の1行を送った。default の受け手は届いて `PONG-A1` を返した。bypassPermissions の受け手は `peer_message_hold`（cause `no-mode-asserted`）で保留され、届かなかった。Claude Code 2.1.289 の文言は「The sender did not attest its permission mode, and this session bypasses permission prompts」。seamless は名乗りを偽らない。届けたい受け手は本人が `crossSessionInbound: accept` にする。
- 第12便（Codex Astra）: 新しい版でも止めない（立花さん指示）。表にない版、checking、版が読めない場合を既定で通し、sessions に version と versionStatus を出す。fix_required と未知の状態は常に止める。`strictVersions:true` で従来どおり verified に限る（既定 OFF）。リーダーの実測 332 試験 PASS、verify.sh 終了 0（fa2d926）。
- 実会話の確認: 対応表に無い Claude Code 2.1.289 の `claude -p` から MCP の sessions を呼び、`status: ok`、呼ぶ側 `2.1.289 unverified`、候補 6件（verified と unverified の両方）、offlineHidden 58 を得た。
- 判定（Claude Opus 5.5、別家系）1回目 FAIL（中: strictVersions:true でも limits は未確認の版の呼ぶ側を通す。依頼文と結果ファイルに書かれていない例外）。リーダーは例外を残すと決めた（limits は seamless 自身の設定ファイルだけを扱い、相手の記録や受け口に触れない。strict の間に製品が更新されても道具から strict を外せる。確認済みの版の呼ぶ側も外せるので strict は呼ぶ側を区切る仕組みではない、AC4）。spec の AC18 の改訂に書き、試験（Claude と Codex × future、空、null の6条件で、strict の拒否の後に limits get が true、set で false を保存、sessions が再開）で固定した（6c68416）。332 試験 PASS、verify.sh 終了 0。
- 判定（Codex Astra、別家系）2回目 PASS（重大、中なし）。残りの軽: read の途中で strict が有効になると owner 照会が1回起きうる、unusable の limits でも呼ぶ側の特定が先に走る、track 専用の strict 試験が無い（canRead で守られている）。
- 実会話の確認（Codex）: 立花さんが Codex Desktop に新しい会話「シームレスチェック」（01a10630）を立てた。Codex は `sessions`（scope same_repository）を呼び、成功、候補5件（Claude 3、Codex 2、全件 read と send が可）、版の表示（Claude 2.1.286、Codex 26.930.31730+12947、いずれも検証済み）、offlineHidden 59 を得た。版の欄が出たので、更新後の seamless が読み込まれている。この Claude 会話から read で確かめた（09:15Z）。
