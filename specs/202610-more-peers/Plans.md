# 実装計画（seamless を Grok CLI、Grok Bot、ChatGPT Dot へ広げる）

Status: 起草（承認 2 回目待ち）
Updated: 2026-10-08 JST
仕様: [spec.md](spec.md)（承認 1 回目 2026-10-08）。製品の不変条件はルートの spec.md が正本で、この計画は定義し直さない。

## 全体の形

seamless は「製品ごとの観測と配送の部品（アダプター）」を、共通の一覧・読む・送る・段の観測の上に載せている。今回は部品を 2 種類足す。

1. Mac 内の製品の部品（Grok CLI）: Claude と Codex と同じ型。会話の記録を読み、動いている会話のプロセスを実観測で特定し、その会話の実行主体へ届ける。
2. 外の実行主体の部品（Grok Bot、後に Dot）: プロセスが手元に無い。名簿の登録（宛先の住所、送り手の鍵の置き場所、許す操作と範囲）を正本にし、送りは住所へ、受けは鍵で確かめる。

共通の変更は 3 つだけに絞る。製品の種類に `grok` と外の実行主体を足す。呼び手の特定に「Grok CLI の祖先」と「名簿と鍵で確かめた外の送り手」の 2 つの道を足す。段の観測に「未確認のまま残す段」を増やす。

## 工程

| 工程 | 何を | 完了の目安（AC） | 判定役 |
|---|---|---|---|
| P0 調査の残り | Grok CLI の名簿の実例（TUI を起動して登録と削除を見る）、Stop hook で文脈に足せることの実測、Grok CLI の実行ファイルの署名の確認方法、Grok Bot の webhook の事実（Q3）、MCP Events の一次仕様 | 事実が evidence.md に時刻つきで載る | 不要（事実の記録） |
| P1 Grok CLI を相手に | 一覧（AC1）、読む（AC9）、送る（AC2、D5 の形）、呼び手（AC3） | AC1、AC2、AC3、AC9、AC10 | Codex Astra（読み取り専用） |
| P2 Grok Bot を相手に | 名簿の登録、送る（AC4）、受ける（AC5）、返信の対応と循環（AC6）、再送禁止（AC7）、認可の範囲（AC8） | AC4〜AC8、AC10 | Codex Astra（読み取り専用） |
| P3 Dot の仕様化 | MCP Events の一次仕様を読み、spec に AC を追記して別途の承認 | AC11 | 敵対（Astra）で spec の穴探し |

P1 と P2 は独立で、P0 の後に並べて進められる。P3 は仕様だけで、実装は別の承認の後。

## P1 Grok CLI の作り

観測（一覧と読む）
- 動いている会話: `~/.grok/active_sessions.json`（会話 ID、pid、作業場所、開始時刻）を読み、pid が生きていて開始時刻が合う行だけを「動いている」とする。画面なし（`grok -p`）は登録されないので対象外。
- 止まっている会話: 初版は一覧に出さない（D3）。
- 本文: `~/.grok/sessions/<作業場所>/<会話 ID>/updates.jsonl` を読み、`user_message_chunk` と `agent_message_chunk` を連結して可視の発話にする。`tool_call` は道具の呼び出し。思考（`agent_thought_chunk`）と生の履歴（chat_history.jsonl）は読まない。
- 範囲: 作業場所は名簿の `cwd` を使い、Claude と Codex と同じ範囲判定（同じ作業場所、同じリポジトリ）に乗せる。

配送（送る）
- 受理: seamless が、相手の会話 ID ごとの受信箱（`~/.seamless/grok-inbox/<会話 ID>/`）に封筒を置いた時点。
- 配信確認: Grok の `Stop` hook（seamless が用意する小さなスクリプト。`~/.grok/config.toml` の `[[hooks.Stop]]` に本人が登録する）が、受信箱の封筒を読み、JSON の `additionalContext` として会話の文脈に足した時点。足した封筒は「配達済み」に移す。hook の実行は Grok の記録（`hook_execution` の行）と、受信箱の移動で観測する。
- 処理開始: 足した後に相手の発話か道具の呼び出しが記録に現れた時点。
- 返答完了: 相手が seamless の `send` で `replyTo` つきに返した時点（Grok CLI は MCP の seamless を使う。Grok 用の MCP の登録は CJ-Plugin の wire.sh のレジストリへ）。
- 相手が待機中: 受理のまま配信確認が立たない。帯とパネルで「相手は待機中。次の 1 手の後に届く」と出す（D5 の (b)）。
- 文脈に足す封筒は 1 回の Stop で 1 件、長さは Grok の上限 10,000 字の内側（封筒の本文は既存の上限 32 KB より小さい 8,000 字に切り、超えた分は「続きは seamless の read で」と添える）。

呼び手（Grok CLI → Claude、Codex）
- 祖先に Grok の実行ファイル（`~/.grok/bin/grok`。署名の確認方法は P0 で決める）があり、その pid が `active_sessions.json` の行と一致し、行の作業場所がプロセスの作業場所と一致したときだけ、呼び手をその会話にする。名乗り（環境変数や引数の会話 ID）は使わない。

段の後退と失敗
- 一度見えた段は戻さない（既存のとおり）。受信箱の封筒が壊れていれば配達せず、受理のまま「未確認」にする。

## P2 Grok Bot の作り

名簿（新規。`~/.seamless/peers.json`、本人だけが書く、mode 0600）
- 1 件 = 表示名、製品（`grok-bot`）、宛先の住所（webhook の URL を入れた環境変数の名前）、送り手の鍵（Bot → Mac の鍵を入れた環境変数の名前）、許す操作（read は常に不可、send の可否）、範囲（この登録と話してよい作業場所の一覧か「すべて」）。
- 名簿には環境変数の「名前」だけを書き、値は書かない。seamless は送る瞬間と受ける瞬間にだけ値を読む。

送る（Mac → Bot）
- 封筒を webhook の住所へ POST する。受理は HTTP の応答で記録する（2xx 以外は「受理されなかった」）。配信確認、処理開始、返答完了は観測できないので未確認のまま。返答完了だけは、Bot からの返信が届いた時点で埋まる。
- 自動再送しない。応答が切れたら「成否不明」で止め、同じ依頼の実行回数は 1 のまま。

受ける（Bot → Mac）
- Bot は Mac で seamless の CLI を実行する（ハンドオフの 5）。CLI の新しい入口 `send --as <登録名>` は、封筒の正規化した本文と時刻と nonce に対する HMAC（鍵つきの署名）を要求する。seamless は環境変数から鍵を読んで検証し、通れば「名簿で確かめた外の送り手」として既存の配送に乗せる。
- 拒否する 5 種（AC5）: 鍵なし、別の登録の鍵、失効した鍵（名簿で `revoked` の登録）、同じ nonce の再提示（直近 24 時間の nonce を `~/.seamless/nonces/` に記録）、登録に無い宛先（範囲外）。
- 届いた文は受信側の AI が自分の権限で判断する（不変条件 3）。seamless は承認設定も sandbox も触らない。

返信の対応と循環（AC6）
- 返信は `replyTo` で元の依頼に結び付ける。Bot からの文のうち `replyTo` の無いものは「新しい依頼」として受けるが、seamless が自動で返信を送ることは無い（既存のとおり、返信は AI が自分で `send` する）。
- 循環の検証は、返信の受信後 10 分、依頼の件数が増えないことを試験と実測で確かめる。

## P3 Dot の仕様化

- MCP Events の一次仕様（2026-07-28 版）を読み、発見、購読、callback、署名の形を evidence.md に写す。
- spec の AC に、購読状態の保持、署名つき配送、Dot の宛先と呼び手の鍵を書き、別途の承認を取る。
- 実装は承認の後。MCP の仕様の版の引き上げは、Claude と Codex の接続を壊さないことを AC10 で先に守る。

## Human gates（本人の承認が要る不可逆または外向きの操作）

| # | 操作 | 誰が | いつ |
|---|---|---|---|
| H1 | `~/.grok/config.toml` に Stop hook を登録する（Grok の挙動が変わる） | 立花さん（seamless が差分を提示） | P1 の配送の試験の前 |
| H2 | Grok Bot 側に webhook のルーチンを作る（確認カードが出る） | 茶々丸 | P2 の送る試験の前 |
| H3 | webhook の URL と鍵を Mac の環境変数に置く | 立花さん | P2 の試験の前 |
| H4 | 名簿に茶々丸を登録する（住所と鍵の環境変数の名前） | 立花さん（seamless が雛形を出す） | H3 の後 |
| H5 | Grok CLI 用の seamless MCP を wire.sh のレジストリに入れて配送する | 立花さん（`plan --mcp-grok` → `apply`） | P1 の呼び手の試験の前 |
| H6 | main への取り込みと push | 立花さん | 各工程の判定 PASS の後 |

## 検証

- 自動試験: `bash scripts/verify.sh`（型検査、node の試験、plugin の検証と試験）。新しい試験は既存の型（caller-scan、adapters、automatic、status）に足す。
- 実会話: 8 本の組 × 方向を evidence.md に時刻と段つきで記録。製品の版（Claude Code、Codex Desktop、Grok CLI の版）を添える。
- 判定: 工程ごとに Codex Astra（読み取り専用）。敵対は判定役が判定のあとに兼ねる。
- 完了の宣言は、試験のコマンドの終了コードと判定役の PASS がそろったときだけ。

## 置いた仮定

- Grok の Stop hook の `additionalContext` は、相手の AI にとって「届いた文」として読まれる（hook feedback の扱い）。P0 で実測して確かめる。
- `active_sessions.json` は TUI の開始と終了で更新される（バイナリの文言から。P0 で実測）。
- Grok Bot の webhook は 1 回の POST に 1 封筒で、応答は HTTP の状態で足りる（Q3 で確かめる）。
- 茶々丸が Mac で実行する CLI は、立花さんの承認を 1 コマンドずつ受ける（ハンドオフ 5）。seamless はその承認の仕組みに手を入れない。

## 後戻り

- P1 と P2 は部品の追加で、既存の Claude と Codex の経路には触れない。戻すときは部品と名簿を外すだけ。
- Stop hook の登録（H1）は config.toml の行を消せば戻る。
