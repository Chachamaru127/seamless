# 状態の帯の実装計画

更新: 2026-10-04 JST
状態: 第1版。立花さん「UIの構築に着手して」（2026-10-04）を受けて作成し、手元で作れる範囲（導入を除く）に着手する。
正本: [spec.md](spec.md)（2026-10-03 承認）。この計画は spec の AC を作り方へ割り当てるだけで、AC を定義し直さない。
大きさ: M。リーダー Claude。施工 Codex Astra（推論量 low、ultrafast）。判定は施工と逆の家系。

## 前提の実測（2026-10-04）

- mod は Claude Code 2.1.287 以上で動く。入力欄の上の帯は描画の場所 `AbovePrompt` で、ターミナルと Desktop の Code タブの両方で描ける（公式文書 plugins/mods、手元の写しは `.local/build/mods-docs/`）。
- このMacの Claude Code CLI は 2.1.289 で、mod を読み込める。
- Desktop アプリ 2.19675.0 に入っている Claude Code は 2.1.286 まで（`~/Library/Application Support/Claude/claude-code/` に 2.1.284 と 2.1.286）。Code タブでは、Desktop が 2.1.287 以上を入れるまで mod が読み込まれない。spec の Stop conditions により、Code タブの確認（AC1 の半分）はそれまで外部条件待ちにする。ターミナルの作業は止めない。
- 取り込む部品: [whats-agent-doing](https://github.com/tzafrir/whats-agent-doing) の commit `1efd306948e2cb1866a02fe65f0cdbfb0c3da277`（MIT、Tzafrir Rehan）。入力欄の上の箱に「今 Claude が何をしているか」と経過時間を出し、▸ で手順の履歴（✓ ✗ ⊘ ■ と所要時間）を出す。ネットワーク、ファイル、テレメトリを使わない。帯の左半分（AC2、AC5 の前半）がほぼこれで足りる。写しは `.local/build/wad-1efd306/`。

## 方針

1. 帯は seamless のリポジトリの中の plugin `mods/seamless-band/` として作る。左半分は whats-agent-doing を元に日本語化し、右半分を足す。
2. 右半分のデータは seamless の `sessions` だけから取る（AC7）。照会は `peek:true` を付け、`~/.seamless/seen.json` を書かない（帯が世代の変化と除外切れの表示を先に使って消さないため。第13便の判定の重大1）。mod は `$.process.run` で `node <seamless>/src/cli.ts sessions` を呼ぶ。この子プロセスの親は Claude Code なので、seamless は呼ぶ側を今と同じ方法（claude-ancestor）で特定できる。
3. mod が使う mods API は、描画（`$.ui`）、時計（`$.clock`）、会話の間だけメモリに残る値（`$.state`）、子エージェントの一覧（`$.agent.list`）、seamless の照会（`$.process.run`）だけにする。`$.fs`、`$.http`、`$.model`、`$.prompt`、`$.session.send`、`$.tool`、`$.store` は使わない（AC6、AC7）。`claude plugin validate --json` の calls で確かめる。
4. 照会は重い（会話ごとに受け口とプロセスを照合する）。30秒ごと、seamless の道具の呼出しの後、別の会話からの受信（`session.receive`）の後にだけ走らせ、同時に2本走らせない。1回の上限は20秒。
5. 導入（普段のセッションで読み込ませる）は Human gate G5 の承認の後。それまでは `claude --plugin-dir` の1セッションだけで試す。

## 決めたこと（spec の Open questions への答え。後から変えられる）

| # | 問い | 今回の決定 | 理由 |
|---|---|---|---|
| 1 | Codex の画面にも出すか | 2026-10-05 調査済み（evidence.md）。入力欄の上の帯は差込み口が無い。会話の右側パネルのタブ（MCP App の thread 入口）なら出せる作りがある。表示の受入試験（下の C 段）を立花さんの承認後に行う | 実表示、enable_mcp_apps の実値、UI からの呼出しに会話の付帯情報が付くかが未確認 |
| 2 | ロゴの扱い | 文字の略号「Claude」「Codex」で出す。ロゴは各社の使用規定を確かめてから | 規定を未確認のまま他社のロゴを描かない。ターミナルでは画像は Image 要素だけで、Desktop では描けない（mods reference の Elements） |
| 3 | 同じ会社の相手が複数いるとき | 閉じた状態は会社でまとめ、開いた状態で相手ごとに分ける | spec の案どおり |

## 帯の右半分の決め方

- 会社: seamless の `provider` が claude なら「Claude」、codex なら「Codex」。
- 回数: その会社の相手ごとの `requests`（自分が送った依頼。seamless の仕様で直近24時間、相手ごとに最大10件）と、`inbound`（受け取った依頼）の合計。やりとりが0の会社は出さない（AC3）。上限で頭打ちになりうることを、開いた状態に注記する。
- 色: その会社との最新のやりとり1件で決める（AC4）。

| 最新のやりとり | 色 | 意味 |
|---|---|---|
| 自分の依頼で、処理開始か返答完了を観測 | 緑 | 既読 |
| 自分の依頼で、到達を観測（処理開始は未観測） | オレンジ | 届いたが未読 |
| 自分の依頼で、記録の状態が拒否（rejected） | 赤 | 届かなかった |
| 自分の依頼で、受理だけ（到達は未観測）、送信中（pending）、書込み後に不明（unknown） | 灰 | 未確認 |
| 受け取った依頼で、送り主が確認済み（AC34） | 緑 | 受け取って会話に入った |
| 受け取った依頼で、送り主が名乗っただけ | 灰 | 未確認 |
| seamless の照会が失敗した、時間切れ | 灰（全体） | 未確認（AC9） |

## 段と触るパス

| 段 | 中身 | AC | 触るパス |
|---|---|---|---|
| U1 土台 | plugin の雛形、whats-agent-doing の取り込み（出典、commit、LICENSE の保持） | 10 | 新規 `mods/seamless-band/`（`.claude-plugin/plugin.json`、`hooks/hooks.json`、`hooks/register.tsx` ほか、`LICENSE-whats-agent-doing`、`README.md`） |
| U2 左半分 | 状態の日本語化（指示を読んでいる、考えている、道具を使っている（目的つき）、承認待ち、返事を書いている、待機中）と秒の経過時間 | 2、5 | `mods/seamless-band/hooks/` |
| U3 右半分 | seamless の照会、会社ごとの回数と色、照会の失敗時の灰色 | 3、4、7、9 | `mods/seamless-band/hooks/` |
| U4 開いた状態 | 手順の履歴と、相手ごとの一覧（相手の名前、作業場所、本文の冒頭、状態） | 5 | `mods/seamless-band/hooks/` |
| U5 安全 | 描く文字列から制御文字と不可視文字を除く。表示だけで動作を変えない | 6、8 | `mods/seamless-band/hooks/` |
| U6 試験 | `claude plugin test` の試験、`claude plugin validate --strict --json` の確認、`scripts/verify.sh` への組込み | 全体 | `mods/seamless-band/tests/`、`scripts/verify.sh` |
| U7 実地 | ターミナルで `--plugin-dir` の1セッションに読み込み、撮影 | 1〜5、9 | `specs/202610-status-ui/evidence.md` |
| U8 導入 | 普段のセッションで読み込ませる（G5） | 1 | CJ-Plugin の配線（別 repo） |
| U9 Code タブ | Desktop が Claude Code 2.1.287 以上を入れた後に、Code タブで確かめる | 1 | `specs/202610-status-ui/evidence.md` |

依存: U1 → U2〜U5（同じファイルを触るので1便にまとめる）→ U6 → U7 → U8。U9 は外部条件待ち。

## 本文の冒頭の扱い（AC5、AC7）

seamless の依頼の記録は本文を持たない（保存しない方針）。開いた状態の「本文の冒頭」は、この会話の中で seamless の send の道具が呼ばれたときの入力（text）を、mod のメモリにだけ最初の40文字まで持つ。ファイルにも外部にも書かない。会話をまたいで残らないので、それ以前の依頼は「本文は保存していません」と出す。

## 検証

| 何を | コマンド |
|---|---|
| 全体 | `bash scripts/verify.sh`（実終了 0。mod の試験を含む） |
| mod の試験 | `claude plugin test mods/seamless-band` |
| 呼ぶ操作 | `claude plugin validate --strict --json mods/seamless-band` の calls が、ui、clock、state、agent.list、process.run だけ |
| 実物 | `claude --plugin-dir mods/seamless-band` で1セッション。閉じた状態、開いた状態、照会の失敗を撮影 |

## Human gates

| # | 操作 | 承認の単位 |
|---|---|---|
| G5 | 普段のセッションで mod を読み込ませる（plugin の導入）。経路は CJ-Plugin の配線 | 導入1回 |
| G5b | ロゴを描く（使用規定の確認の後） | 1回 |

`--plugin-dir` の1セッションでの試し（U7）は、立花さんが自分のターミナルで起動する。

## 後戻り

- U1〜U6 は手元の新しいフォルダと試験だけ。消せば戻る。
- U8 は plugin の取り外しで戻る。seamless 本体と会話には影響しない。

## Codex 側（C 段、2026-10-05 追記。承認待ち）

| 段 | 中身 | 承認 |
|---|---|---|
| C1 受入試験 | seamless の MCP サーバー（Codex に登録済み）に、読取り専用の thread 入口の道具1つと `ui://seamless/status` の HTML 資源を足す。UI は sessions を1回呼んで表示するだけ。送信の道具は呼ばない。新しい Codex 会話で、右パネルにタブが出るか、UI からの sessions が呼ぶ側を特定できるか（caller が codex-turn-metadata か）を確かめる | 新しい Codex 会話を開く（または Codex アプリの再起動）。設定ファイルは変えない |
| C2 本実装 | C1 が通ったら、帯と同じ中身（今していること、相手ごとの回数と色、やりとりの一覧）をパネルに出す。更新は手動の再読み込みから始める | C1 の結果を見て決める |

C1 で表示されない、または呼ぶ側を特定できないときは、Codex 側は見送る（app.asar の改造や内部フラグの変更はしない）。

2026-10-05 追記（C1 の実機の観察、evidence.md）: config.toml に直接登録した MCP のままでは、会話の右パネルの候補（「プラグインを使用」）に出なかった。C1b として、右パネルの画面を手元のプラグインに包む（`.codex-plugin/plugin.json`、`.mcp.json`、手元の marketplace の `.agents/plugins/marketplace.json`）。導入は `codex plugin marketplace add <手元のフォルダ>` と Codex アプリの「プラグイン」からの導入で、Codex の設定を変える。配線は CJ-Plugin の wire.sh の作法に合わせる。立花さんの承認（導入1回）が要る。
