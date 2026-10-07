# seamless-band

Claude Desktop アプリの Code タブの入力欄の上に、今していることと seamless のやりとりを表示する mod（画面を拡張する plugin）です。Claude Code 2.1.287 以上が必要です。開発時の検証環境は 2.1.289 です。

## 読み込み

リポジトリのルートから、1セッションだけ読み込みます。

```sh
claude --plugin-dir mods/seamless-band
```

plugin のインストールは不要です。Desktop の Code タブでも、その中の Claude Code が 2.1.287 以上である必要があります。Code タブの実画面確認は別工程です。ターミナルは対象外ですが、Svg の代わりに会社名を表示します。

## 表示

左側は指示の読み取り、思考、道具の使用目的、承認待ち、返事の作成、待機と経過秒数です。灰色の補足には TodoWrite の作業中の項目の activeForm を優先し、なければ実行中の道具の description を表示します。子エージェントの行も表示します。▸ で開くと履歴、✓ 完了、✗ 失敗、⊘ 拒否、■ 中断と所要時間、相手ごとの最新のやりとりが見えます。

右側は、一番大事なやりとりの相手を 1 つ、会話の名前（作業場所のフォルダ名。worktree なら「repo · worktree 名」）と、依頼の段の軌跡（点 4 つ）と、今の段の言葉で表示します。会社は灰色の小さな印（Cx、Cl）だけです。×n を押すと右にパネル「チーム」が開き、相手ごとのカードに直近の依頼と段、直近 24 時間の集計が出ます。段の色は、送信の処理開始または返答を観測すると緑、到達のみならオレンジ、拒否（delivery が rejected）なら赤、それ以外の未観測、pending、unknown、受理のみなら灰色です。受信は送り主確認済みだけ緑にします。回数0の会社は表示しません。照会に失敗したら右側は灰色の「未確認」になります。

回数は送信と受信の合計です。seamless が返す直近24時間の範囲で、送信は相手ごと最大10件、受信は全体で最大10件です。本文の冒頭は、この会話の主エージェントの `mcp__seamless__send` 入力から40文字だけメモリに持ちます。受信本文は保持しません。冒頭を持たない依頼には「本文は保存していません」と表示します。終了、/clear、/resume、/branch で冒頭を破棄します。

## 利用者設定

manifest の `userConfig` に次の項目を宣言しています。読み込み時に渡された値を使用し、mod 自身が設定を変更することはありません。

| 項目 | 既定値 |
| --- | --- |
| `nodePath` | `/Users/tachibanashuuta/.local/share/mise/installs/node/24/bin/node` |
| `repositoryPath` | 空文字。`$.plugin.root` から2つ上 |

`--plugin-dir` 以外で読み込むときは、userConfig の `repositoryPath` に seamless リポジトリの絶対パスを設定してください。

照会は引数配列で `node <repositoryPath>/src/cli.ts sessions '{"scope":"any","peek":true}'` を実行します。shell を挟みません。開始時、30秒ごと、`mcp__seamless__` の道具が終了した後、`session.receive` の後に照会します。同時実行は1本、上限20秒です。

## 使用する mods API

| API | 用途 |
| --- | --- |
| `$.ui.resolve`, `$.ui.invalidate` | 帯の描画と更新 |
| `$.clock.now`, `$.clock.after`, `$.clock.every` | 経過時間と照会の間隔 |
| `$.state.get`, `$.state.set`（atom/read/update） | 会話内の表示状態と履歴 |
| `$.agent.list` | 子エージェントの状態 |
| `$.process.run` | seamless の sessions 照会のみ |
| `$.plugin.root` | リポジトリの既定パス |

mod は本文、思考、認証値をファイルや外部へ保存しません。帯は peek:true で照会し、~/.seamless 内のファイルを作成、更新しません。seen.json は読み取りも行いません。道具の入力と結果、承認判断、プロンプトは変更しません。動的な表示文字列は制御文字と不可視文字を除去します。

## 出典と変更点

[whats-agent-doing](https://github.com/tzafrir/whats-agent-doing)、作者 Tzafrir Rehan、commit `1efd306948e2cb1866a02fe65f0cdbfb0c3da277` を元にしています。MIT ライセンスの原文は [LICENSE-whats-agent-doing](LICENSE-whats-agent-doing) に変更せず収録しています。

hooks、状態の型、tsconfig、元の11件の試験を取り込みました。表示の日本語化、秒単位の時間、seamless の照会と右側の会社別集計、相手一覧、メモリ内の本文冒頭、不可視文字除去の補強、会話終了時の破棄を追加しました。元のストリーム監視は、最後の結果もそのまま返すよう修正しました。

```sh
claude plugin validate --strict mods/seamless-band
(cd mods/seamless-band && claude plugin test .)
bash scripts/verify.sh
```

`tsconfig.json` は元の構成を保っています。`--plugin-dir` で読み込んだときに生成される `.claude-plugin/types/tsconfig.json` と型宣言を参照します。文書と型が食い違うときは、その Claude Code が生成した型が正です。

色の試験データは `tests/support/band-fixtures.ts` が本体の `statusResult()` と `stages()` から生成します。リポジトリの Node 試験が生成物の一致を検査します。mod の試験環境は plugin 外の import を許可しないため、生成物を `tests/fixtures/status-results.ts` に置いています。

## 第15便の見本

見本は [`out/ask-pro/20261003-claude-band/`](../../out/ask-pro/20261003-claude-band/) の `collapsed.html`、`expanded.html`、`common.css`、`sheet.png` です。色と寸法の正本は `common.css` です。ロゴはこの合意済み見本の単色の印で、Codex 側の OpenAI の結び目と Claude 側の Anthropic の「A\」を使います。HTML の path と circle をそのまま収録し、状態色だけ差し替えます。Desktop は `$.ui.resolve` の `Svg`（14px）、terminal は会社名の文字で描きます。

`Box` の寸法はセル単位を前提に、横8px、縦16pxの換算で左右1.5セル（12px相当）、行の最小高さ2.125セル（34px相当）を指定しています。この換算と実際の高さは Desktop 未起動のため未確認です。角丸は許可された `borderStyle="round"` を使います。12pxや999pxの半径は指定できません。辺ごとの border 指定は test kit が拒否するため、区切りは背景色 `#2e2e2b` の薄い Box です。Text の文字サイズと Button の文字色は公開 props では指定できず、見出しの小さい文字と開閉記号の厳密な灰色は再現していません。点模様と点の光彩は省略しています。
