# P2 読取接続部

更新: 2026-10-02 JST
担当: Claude（claudex 作業場所の Desktop セッション）。P3 送達、MCP、CLI、native-runtime は Codex 側の担当。

## 公開 API（src/adapters/）

| ファイル | export | 役割 |
|---|---|---|
| read.ts | `createReader(readers, clock?)`、`parseReadOptions`、`parseEnvelope`、型 `ReadItem` `ReadResult` `Envelope` `TranscriptReader` | 共通の頁送り、cursor、世代照合、結果の区別 |
| session.ts | `readSession` | 製品既定の reader（Claude と Codex の native reader だけ） |
| claude.ts | `findClaudeSession`、`claudeTranscriptPath`、`observeClaudeSession`、`projectClaude`、`createClaudeReader`、`readClaudeTranscript` | Claude の稼働記録と正本 jsonl |
| codex.ts | `observeCodexSession`、`observeCodex`、`projectCodex`、`createCodexReader`、`readCodexTranscript`、`rolloutExists`、`SUPPORTED_DESKTOP_VERSIONS` | Codex Desktop IPC の follower snapshot |

read.ts は session.ts を再 export しない。codex.ts → read.ts → session.ts → codex.ts の循環初期化を避けるため。

## 読取りの約束

- 入力は `Registration` と `{cursor?, limit?}`。limit は 1〜100、既定 20。未知の項目は拒否。
- 返す頁は新しい側から。`nextCursor` は古い側へ進む。cursor は provider、nativeId、世代、基準 item ID を持つ不透明文字列。
- 未完了の履歴で先頭まで来た場合は `nextCursor:null`、`complete:false`、`olderUnavailable:true` を返す。
- 結果は `ok` / `empty` / `not_found` / `generation_mismatch` / `unsupported_version` / `unavailable` / `cursor_invalid` に分ける。取得失敗を空会話にしない。
- 世代: Claude は `${pid}@${startedAt}`、Codex は会話 owner の clientId。登録の世代と観測が違えば読まない。
- 返す本文: user と assistant の可視テキスト、native が peer と記録した項目。思考、tool 入出力、画像、sidechain は返さず `omitted` に列挙する。
- peer の envelope（schemaVersion 1、humanApproval false（2026-10-04 以降は省略が既定）、id、sender、recipient、text、replyTo?）は、native が peer と記録した項目からだけ復号する。通常の user 本文の JSON は復号しない。envelope は宣言データであり、認証や人の承認ではない。
- 本文はメモリ内の返却だけに使い、ファイルやログへ保存しない。

## Claude

`~/.claude/sessions/<pid>.json` から sessionId が一致し、ファイル名と pid が一致する記録を探す。稼働判定は `ps -o lstart=` の開始時刻と記録の startedAt の差が 2 秒未満のときだけ online。正本は `~/.claude/projects/<cwdの記号を-に置換>/<sessionId>.jsonl`。O_NOFOLLOW、所有者一致、64MiB 上限。

終了した Claude セッションの稼働記録は消える（2026-10-02 確認）。そのため終了済みの会話は offline ではなく `not_found` になる。正本 jsonl は残るが、記録なしで cwd を推定して読むことはしない。

peer は `origin.kind=peer` の user 記録（isMeta でも返す）と、`origin.kind=peer` の `queued_command` attachment（busy 中の受信）。人の busy 入力の queued_command は返さない。後で通常の user 記録として残るかは未確認で、重複を避ける側に倒した。

## Codex

`~/.codex/ipc/ipc.sock`（所有者一致、親ディレクトリが他者書込み不可）へ接続し、clientType `claudex-read` で initialize、owner discovery、対象会話だけを following、owner 発、自分宛、version 11、hostId local の snapshot だけを採用する。頁が足りず履歴が未完了なら `thread-follower-load-complete-history` を 1 回呼び、ACK の revision 以上の snapshot を待つ。最後に owner を再照合し、owner が変わっていれば generation_mismatch。終了時は必ず following=false を送り、送り切ってから切断する。

owner が応答しない場合は、rollout ファイル名の有無だけで `unavailable/owner_offline` と `not_found` を分ける。rollout の本文は開かない。

peer は `functionCallOutput` で namespace が `claudex` または `claudex_test`、name が `external_message` のもの。

## 対応版

| Desktop 版 | 根拠 |
|---|---|
| 26.928.31416+12553 | 既存の方式検証（contract.md、full-history-result.json） |
| 26.928.40906+12694 | 2026-10-02 実測: owner discovery、snapshot の型、全履歴ロード（canonical、isComplete、island 1、turnsHaveLoadedOldest、item pagination false 0 件）、TS reader の両頁取得、1 回の配送受理 |

上記以外は `unsupported_version` で、IPC に接続しない。

## 検証記録（2026-10-02）

| 項目 | 結果 |
|---|---|
| `bash scripts/verify.sh` | 実終了 0、91 試験 PASS（P2 の adapters.test.ts 10 件を含む） |
| `tsc --noEmit --strict`（src/adapters と試験） | 実終了 0 |
| 実会話 Claude ed10ef6f… の読取り | ok、peer の messageId を保持、観測 online、Git 作業場所 git |
| 実会話 Codex 01a0f59d… の読取り | ok、2 頁目まで取得、complete true、Claude からの返信を peer と replyTo 付きで取得 |
| 旧世代、存在しない会話 | generation_mismatch、not_found |
| 製品窓口 `serve --native`（P3 結合） | read codex-current limit 3 が ok。send（replyTo cldx-product-71f8）が submitted |
| 探索失敗の分類（再判定指摘） | sessions ディレクトリや rollout ディレクトリが読めない、記録が壊れている場合は unavailable（session_record_unreadable / rollout_unreadable）。ENOENT だけが不存在 |
| Codex reviewer 指摘 2 件 | 修正済み。limit と同数の部分 snapshot で再ロード、`olderUnavailable` を追加。正本の読込み失敗を unavailable に分離 |

未了: 別家系の独立判定（Codex reviewer が継続中）。取得元の識別は Codex 側が protocol.ts に追加した `gitSource` を両 observer が `observeGit` で返して充足。
