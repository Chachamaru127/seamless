# claudex の保存項目

対象: 2026-10-04、第7便の実装。既定の保存先は `~/.claudex`。
試験では `home` と保存先を一時フォルダへ差し替える。
元製品の会話本文、思考、道具の入力全体、認証値はここへ保存しない。

| 保存先 | 保存する項目 | mode | 保持期間と削除 |
|---|---|---|---|
| `limits.json` | `version`、`exclude`（provider/nativeId/workspace）、`scope`、`operations`（read/send） | 0600 | 本人が変更または clear するまで |
| `seen.json` | 配列の provider、nativeId、generation、cwd、at | 0600 | 識別情報の比較対象は24時間。次の一覧で期限外を除外して書き換える。常駐削除はなく、呼出しがなければディスク上に残る |
| `key` | 重複検知の HMAC-SHA256 用ランダム鍵32バイト。外部サービスの認証値ではない | 0600 | 自動失効なし。再起動後も同じ鍵で照合する |
| `reservations/<sha256>.json` | hash、status、at。新方式では id、sender/recipient（id/provider/nativeId/generation/cwd）、任意の replyTo も保存 | 0600 | 自動削除なし。同じ依頼 ID の再配送を防ぐ。書込み前の再照合で拒否した予約だけ削除 |
| `reservations/<hmac>.claim` | id、at | 0600 | submitted/rejected の処理で解放。不明の重複抑止は24時間。期限後の競合する送信で回収。呼出しがなければ残る |
| `limits.json.lock`、`seen.json.lock` | pid、token | 0600 | 排他処理中だけ。プロセス消失時は次の書込みが PID を確認して回収 |
| `*.lock.reap-<dev>-<ino>-<token>` | 空。死んだ保持者のロック回収用 | 0600 | 回収処理の finally で削除。異常終了で残る可能性あり |
| `reservations/<hmac>.claim.expire` | 空。期限切れ claim の回収用 | 0600 | 回収処理の finally で削除。異常終了で残ると自動解除せず停止 |
| `.limits.json.<uuid>.tmp`、`.seen.json.<uuid>.tmp` | 置換予定の同じ JSON 項目 | 0600 | rename または finally で削除。強制終了で残る可能性あり |
| `key.<uuid>`、`reservations/<hmac>.claim.<uuid>` | 公開予定の鍵または claim と同じ項目 | 0600 | hard link で公開後、finally で削除。強制終了で残る可能性あり |
| `reservations/<sha256>.json.<uuid>` | 更新予定の予約と同じ項目 | 0600 | rename で置換。失敗や強制終了では残る可能性あり |

新しく作るディレクトリは mode 0700。予約ディレクトリは所有者と mode 0700 を確認する。
設定ディレクトリは所有者と他者による書込み不可を確認する。既存ディレクトリを一律 chmod しない。
設定と予約の読み取りでは所有者、通常ファイル、mode 0600、サイズなどを検査する。

旧 `--registry --caller` 方式の予約は本文を含む値の SHA-256 を保存する。
新方式は `key` による HMAC を使う。旧方式を鍵付きと表記しない。
受信照合結果 `inbound` は保存しない。ID、送り主の識別情報、verified/declared、記録時刻だけを返す。
送り主の送信記録を読むアダプターは一致した依頼 ID だけを返す。

## 元製品の正本との区別

Claude の `~/.claude/projects/.../*.jsonl` と稼働記録、Codex の会話と Desktop が返す履歴は元製品の正本。
claudex の保存領域ではない。受信照合では自分の peer 記録と送り主の送信記録を読む。
本文を取得する read の成功結果は呼ぶ側へ返す。本文を返さない照会や受信照合とは区別する。
claudex は承認待ちや両製品の共通設定を保存、変更する経路を持たない。

## 検証範囲

`tests/privacy.test.ts` は別プロセスと一時フォルダで通常送信、書込み後の失敗、peer 受信、read、照会、受信照合を試す。
本文、思考、認証値の代わりの固定文字列が保存ファイルと捕捉した標準出力、標準エラーへ出ないことを確認する。
失敗時も試験の診断には捕捉文字列を出さず、真偽値で検査する。
read 成功時の本文返却は意図した動作なので、その本文を試験出力へ印刷しない。
設定の不変試験では、一覧による正規の seen 時刻更新と peer の影響を分離するため時計を固定し、一覧を1回実行した後を比較の基準とする。
実際の承認待ちや共通設定は読み書きせず、検査用のファイルを置いて比較する。
