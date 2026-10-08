# seamless 多社連携（Grok CLI、Grok Bot、ChatGPT Dot）と帯 第5版

状態: superseded（2026-10-08。Grok CLI、Grok Bot、Dot の部分は specs/202610-more-peers/spec.md に引き継ぎ、そちらが承認 1 回目済みの正本。帯 第5版の部分は未計画の案のまま。この文書は編集しない）
更新: 2026-10-08 JST
大きさ: L（製品の不変条件 8 を改訂するため、ルートの spec.md を先に直す）
依頼: 立花さん（2026-10-08）「seamless を Grok CLI、Grok Bot、ChatGPT Dot とも連携できるようにしたい。Grok CLI はあえて止めているだけ。Grok Bot はハンドオフを確認して検証。Dot は確認中なので最後。」

## 何を、なぜ

seamless は今、同じ Mac の Claude と Codex の会話の間だけで、一覧、読む、送る、返信の対応、段の観測を提供している。立花さんの作業は Grok Build CLI、VPS 上の Grok Bot（hermes）、ChatGPT Dot にも広がっているので、どの会話からでも同じ操作で相手を見つけ、送り、返信を追えるようにする。相手の会社を意識させない帯（第4版）の思想を、通信の側でもそろえる。

## 現状の確認（2026-10-08）

| 相手 | 今の扱い | 分かっていること | 分かっていないこと |
|---|---|---|---|
| Grok Build CLI 1.0.46 | 意図して対象外。seamless の MCP は Claude と Codex だけに配り、Grok には配らない（CJ-Plugin wire.sh `--seamless-mcp`。everyday-use の spec 4 項） | 会話の記録は `~/.grok/sessions/<作業場所>/<会話 id>/` に自動保存。MCP は `~/.grok/config.toml` の `[mcp_servers.*]`（Codex と同じ形）。画面なしの `grok -p --resume <id>` で既存の会話に続きを入れられる。ACP（`grok agent stdio`）がある | **動いている会話へ外から文を入れる口**（Claude のソケット、Codex の IPC に当たるもの）が見つかっていない。MCP の呼び手（どの会話か）を特定する材料（Codex の turn metadata に当たるもの）が無い |
| Grok Bot | 対象外 | VPS `cursor-2`（Tailscale 100.127.32.44、SSH 2222、box）で動く hermes。hermes には `peer`（別の hermes の gateway へ文を届けて返事を受け取る。`hermes peer add <name> --url http://host:8377 --key <API_SERVER_KEY>`、`hermes peer dm <peer>/<agent> "..."`、`peer run`（`--idempotency-key` あり）と `status` で非同期）がある。**dm が届く先は agent の canonical Bot Chat で、会話 id や世代は指定できない。** この Mac にも hermes がある | 立花さんの言う「ハンドオフ」の本文（未添付）。Bot 側の gateway の URL と鍵、agent の名前。返事の対応づけ（dm の返事が返信か） |
| ChatGPT Dot | 対象外 | 無し | 正体（アプリか、端末か、API か）。確認中（立花さん） |
| 帯 第5版 | 第4版が本線 4fa898e | 立花さんの指摘 3 点（目的が相づちで置き換わる、やりとり欄は記録ではなく今の動き、相手が何をしているか） | 相手の本文の冒頭を帯に出すか（10/5 の「本文を持ち込まない」判断の改訂） |

## 製品の不変条件の改訂（ルートの spec.md 8 項）

現行: 対象は同じ Mac で動いている Codex と Claude の会話。
改訂案: 対象は、同じ Mac で動いている Claude、Codex、Grok CLI の会話と、hermes の peer として登録した Grok Bot の agent。Grok Bot では「会話」を「agent の Bot Chat」と読み替え、宛先は gateway（URL と鍵）、agent 名、gateway の世代（起動ごとに変わる番号。取れなければ未確認）で特定する。相手は自動で見つける（Grok Bot は peer の登録が本人の置く設定で、自動発見の代わり。既定の探す範囲 current_work には出さず、`any_registered` で明示して選んだときだけ出す）。ほかの不変条件（1〜7）は変えない。特に 2「その会話を持つ実行主体へ届ける。同じ履歴の別プロセスを起動して成功扱いにしない」は Grok CLI の入口の選び方を縛る。

既存条項の改訂一覧（AC1 の対象）:
- ルート spec.md 8 項: 上の改訂案。
- everyday-use の spec 4 項（他社製品と CLI 単体の会話を範囲外）: Grok CLI と Grok Bot を範囲に入れる。
- everyday-use の spec の停止条件（共有受信箱、耐久配送キュー、遠隔会話で止める。104〜109 行、145〜148 行）: Grok CLI の hook の受信箱と Grok Bot の遠隔配送を、下の「遠隔と受信箱の扱い」の条件つきで許す。受信箱に本文を置く場合は、置く内容、寿命（次の取り込みで消す）、滞留の扱いを明記する。
- 10/5 の「帯は相手の本文を持ち込まない」判断: D-3 が採られたときだけ改訂（OD2）。

## 段階

### A. Grok CLI（同じ Mac）

1. 一覧と読む: `~/.grok/sessions` の記録から会話を見つけ、本文を読む（Claude と同じ「記録を読む」方式）。
2. 送る: 不変条件 2 を満たす入口を 1 つ選ぶ。どの入口でも、受け手の Grok が文を「別の会話からの文」として受け取り、承認待ちや sandbox を解除しないこと（`--always-approve` を配送の都合で付けない）。候補は、(a) 動いている会話の口（見つかれば最良）、(b) hook が差し込む受信箱（Grok の hooks は道具の前後と会話の開始終了だけで、指示の前の hook は文書に無い。届くのは次の道具の呼び出しの時になる。段「届いた」は hook の実行ではなく、Grok の会話の記録にその文が取り込まれたことを観測して付ける。hook が無効、プロジェクトが未信頼、`allow_managed_hooks_only`、次の道具の呼び出しが来ない、のときは未確認のまま。待つ上限を決める）、(c) 画面なしの `grok -p --resume` で続きを入れる（別プロセスが会話を進めるので不変条件 2 に反し、既定では採らない）。
3. 呼び手の特定: Grok の MCP サーバーがどの会話から呼ばれたかを、会話 id として一意に実観測できる手段を決める。作業場所と記録の更新時刻からの推定は採らない（同じフォルダの会話 A と B を取り違える）。一意に観測できないときは、Grok CLI を呼び手とする一覧、読む、送るを全部止める（読む専用の相手としては残る）。
4. 配送: wire.sh の `--seamless-mcp` の Grok 除外を外す（本人が apply）。
5. 帯と status: 相手として Grok を表示する（印は Gk）。

### B. Grok Bot（遠隔、hermes）

1. 宛先: peer 名、agent 名、gateway の世代。送る直前に gateway に照合し、世代が変わっていれば `generation_mismatch` で止める（Claude、Codex と同じ扱い）。
2. 送る: `hermes peer run` で封筒を届ける。`--idempotency-key` に seamless の依頼 id を使い、返ってきた run id を native の送信 id として記録する。接続が切れて成否が分からないときは `unknown` にし、同じ依頼 id を自動で再実行しない（不変条件 6）。待つ上限で終えることを remote の取消と扱わない。
3. 返信: `peer status` の最終出力を、そのまま返信にはしない。返信と認めるのは、出力が seamless の封筒（id、送り手 = Bot の agent、宛先 = 元の会話、replyTo = 依頼 id）の形で、依頼 id と run id が対応するときだけ。認めた返信は、seamless が元の送り手の会話（Claude か Codex）へ受信として届ける（status は送り手の会話の記録で replied を判定するため）。形が違う出力は「返事はあるが返信として未確認」。
4. 受け手の権限: Bot 側が peer の入力を本人の入力と区別して扱うことを、ハンドオフと実測で確かめる。区別できない経路は使わない。seamless は Bot の設定を変えない。
5. 読む: Bot の会話は遠隔なので、hermes の API で取れる範囲だけを読む。SSH でログが読めることを seamless の read の許可に読み替えない。取れない段は未確認。
6. 遠隔の信頼: Mac 側で確かめられるのは送信クライアント（この Mac の hermes）まで。gateway の真正性は URL、鍵、応答の identity で確かめ、同じ Mac のプロセスの照合（祖先、lsof、ソケット）の代わりにはしない。宛先の host を `local` と偽らない（status と discovery の `host:'local'` 固定を直す）。
7. 範囲: Mac と VPS のパスが同じでも同じ作業場所とみなさない。Bot は明示の選択（`any_registered` と target）でだけ出す。
8. ハンドオフの検証: 立花さんが指す「ハンドオフ」の手順どおりに往復できるかを実測する。

### C. ChatGPT Dot

正体の確認が終わるまで着手しない。確認後に A か B と同じ型に当てはめる。

### D. 帯 第5版（specs/202610-status-ui の design-v5）

1. 目的: 相づち（短く目的語の無い指示）では置き換えず、最後の実のある指示の一文を保つ。終わった後は返答の冒頭の一文を出す。
2. やりとり欄: ▸ の中は相手ごとに今の状態を言葉で 1〜2 行。記録の点の列はパネル「チーム」にだけ残す。
3. 相手の今の動き: 相手の記録の最新の発言の冒頭（60 字まで、表示だけ、保存しない）を出すかは Open decision（OD2）。出す場合、帯が相手の記録を読むのは双方で read を許した相手だけ。

## 方向の表（検収の単位）

| 呼び手 → 宛先 | 呼び手の特定 | 配送の入口 | 返信の照合 | 段階 |
|---|---|---|---|---|
| Claude → Grok CLI | 既存 | A-2 の入口 | Grok の記録の封筒 | A |
| Codex → Grok CLI | 既存 | 同上 | 同上 | A |
| Grok CLI → Claude | A-3（一意に観測できたときだけ） | 既存（Claude のソケット） | 既存 | A |
| Grok CLI → Codex | A-3 | 既存（Codex の IPC） | 既存 | A |
| Claude / Codex → Grok Bot | 既存 | B-2（peer run） | B-3（封筒の形の出力だけ） | B |
| Grok Bot → Claude / Codex | 対象外（Bot は依頼への返信だけ。Bot を呼び手にした一覧と送信は今回の範囲に入れない） | — | — | — |

## 受け入れ条件（AC。Yes / No で判定）

- AC1: 「既存条項の改訂一覧」の 4 項目が全部改訂されている。
- AC2: Grok CLI の会話が `sessions` の一覧に出て、動いている会話と記録だけの会話が `status` で区別され、`read` で本文が読める（実会話で確認。記録だけの会話は offline）。
- AC3: 方向の表の Claude → Grok CLI と Codex → Grok CLI で、`send` の文が Grok の会話の記録に取り込まれた時刻が「届いた」として観測され、Grok の返信が `status` の replied で観測される。
- AC4: 方向の表の Grok CLI → Claude と Grok CLI → Codex で、呼び手の会話 id が一意に観測され、届く。同じフォルダに Grok の会話が 2 つあるとき、呼び手を取り違えない（試験）。一意に観測できない設定では一覧、読む、送るが全部止まる（試験）。
- AC5: Claude → Grok Bot で、`peer run` の run id が記録され、封筒の形の返事だけが replied になり、形の違う返事は未確認のまま（試験と実測）。接続を切った送信が `unknown` になり、再実行されない（試験）。
- AC6: 観測できない段は製品ごとに次のとおり未確認で出る。Grok CLI: 入口 (b) で hook が無効なときの「届いた」。Grok Bot: 「届いた」「読んでいる」（hermes が返さない）、世代が取れないときの世代。これらが「無い」「0 件」に置き換わらない（試験）。
- AC7: 帯 第5版。固定の入力列（「UI を洗練させて」→「やっていいよ」→「進めて」→「別件も直して」）で、目的が「UI を洗練させて」のまま保たれ、「別件も直して」で置き換わる（試験）。やりとり欄が状態の言葉（読んでいる n秒、返信あり hh:mm、届いた・未読）で出る（試験）。
- AC8: 既存の Claude ⇄ Codex の往復が壊れていない。verify.sh exit 0 と、4 モード（Claude auto / バイパス × Codex 代わりに承認 / フルアクセス）のうち auto × 代わりに承認で実会話 1 往復。
- AC9: 受け手の権限が変わらない。Grok CLI と Grok Bot で、配送の設定に自動承認（`--always-approve` など）を足していないこと（設定の差分で確認）と、受け手が承認待ちを解除せずに文を受け取ること（実測 1 回）。

## Evidence of done

- 各 AC に、実行したコマンドの実終了コードと、実会話の記録（会話 id、時刻、依頼 id）を evidence.md に書く。
- 判定は逆の家系（Codex Astra）の読み取り専用の判定で PASS。

## Stop conditions

- Grok CLI の入口 (a) も (b) も成り立たず、(c) しか残らないとき: 止めて立花さんに聞く（不変条件 2 を破るか、Grok CLI を読む専用にするか）。
- Grok CLI の呼び手の会話 id を一意に観測できないとき: Grok CLI を呼び手とする操作を全部止める（読む専用の相手として残す）。
- 受け手が文の出自（別の会話からの文）を保てない経路: 使わない。
- Grok Bot のハンドオフが届かない、または gateway の鍵が手に入らないとき: B は止めて A を先に終える。
- hermes peer で封筒を送るとき、Bot 側が文を「本人の指示」として扱う恐れがあるとき: 止める（不変条件 3。受け手の権限を広げない）。
- Grok Bot の gateway の世代が取れず、送る直前の照合ができないとき: 世代は未確認として送れるが、世代の変化による取り違えは検出できないことを一覧に示す。

## Open decisions（立花さんの判断）

- OD1: Grok CLI の入口。(a) が見つからないときに (b) 受信箱方式を採るか。
- OD2: 帯に相手の本文の冒頭を出すか（10/5 の判断の改訂）。
- OD3: Grok Bot の返事を「返信」として記録する条件。草案は「封筒の形の出力だけ」。dm の素の返事も返信とみなすなら、取り違えの試験が成り立たない。

## Open questions（情報待ち）

- OQ1: Grok Bot の「ハンドオフ」の本文（未添付）。
- OQ2: ChatGPT Dot の正体。
- OQ3: Grok CLI が stdio の MCP サーバーに会話 id を渡す手段。stdio では未確認。HTTP の MCP には `headers = { "x-session-id" = "{{session_id}}" }` の設定例がある（README 2087〜2093 行）が、任意のクライアントが同じヘッダーを名乗れるので、採るなら偽装を防ぐ条件が別に要る。
- OQ4: Grok CLI に、動いている会話へ文を入れる口があるか。文書にあるのは ACP（stdio）、画面なしの resume、WebSocket relay で、どれも既存の画面の会話には届かない。

## Human gates（不可逆の操作）

- wire.sh の apply（Grok への MCP 配送）: 本人が実行。
- hermes の peer 登録（鍵を `~/.hermes/.env` に書く）: 本人が実行。
- everyday-use の spec の停止条件の改訂: 承認 1 回目で確定。
- ルートの spec.md の改訂: 承認 1 回目で確定。
