# 探索の検証証拠

2026-10-02、P1の66試験PASS、実終了0。最新66試験版のHaiku / Opus独立判定PASS。P1共通核完了。既存の2026-10-01通信方式検証は、この探索実装の合格証拠へ読み替えない。

## 2026-10-02 計画検査の状況

Claude Haiku4.5 mediumとClaude Opus5.5 xhighへの読み取り専用計画レビューは起動前の自動承認レビューで拒否された。理由: 内部仕様書をClaude外部サービスへ送信する具体的な文書内容と送信先への明示承認が確認できない。外部レビュー未実行。終了コード0や判定として扱わない。

Codex内部の読み取り専用レビューを補助として依頼。逆家系レビューの代替合格にはしない。acceptance-matrix.mdにローカルで試験できる入力と期待結果を作成した。T0が未終了のため実装と試験実行はまだ開始していない。

補助レビューはREQUEST_CHANGES。4件をspec.md / Plans.md / acceptance-matrix.mdへ反映。詳細はreviews/local-plan-review.md。独立判定はまだ未実施。実装着工のT0は未完了。

## 承認後のレビュー起動

2026-10-02、本人が仕様書、実装計画、試験ケースのClaudeへの送信を承認。Haiku4.5 mediumは実終了0、判定REQUEST_CHANGES。対称性の役割逆転試験、表示名からの命令混入試験、binding状態遷移を追加し、再検査を依頼した。Opus5.5 xhighは別依頼として起動済み。結果の回収前にPASSとは扱わない。

Haiku再検査は実終了0、PASS。Opus初回は実終了0、REQUEST_CHANGES（10件）。向き付き許可、未登録/未認可の同一応答、未観測候補を飛ばさない順位、Git状態のscope、native cwdの出所、read-only Git、試験専用serve入口、固定caller、MCPは一覧のみ、資格情報を持たないbootstrapを文書へ反映。Opus再検査中。ユーザー判断を要する既存承認範囲の変更ではなく、探索条件の明確化として採用。

T0: 完了。Haiku再検査PASS（実終了0）、Opus最終検査PASS（実終了0）。注記は施工時に一本化する。これは計画承認でありD1〜D6の実装合格ではない。

## 実装検証（独立判定待ち）

- T1: discoveryとprocessの未実装importによる失敗を実終了1で記録。Git担当もred実終了1。
- T2: 実Git fixture、環境変数混入、index mtime、filter/fsmonitor未実行、実子プロセスの5秒timeoutがPASS。
- T3: 両方向、scope、担当、曖昧性、許可取消、期限、checking競合、dirty扱いがPASS。
- T4: 実プロセスのCLI/MCP一覧一致、sender偽装拒否、bootstrap厳密検査、再読込みと同プロセスbindingがPASS。
- `bash scripts/verify.sh`: 実終了0、58/58 PASS、skip/cancelなし。raw: reviews/verify.txt。
- tsc strict noEmit: 実終了0。型はCodex同梱@types/nodeをtypeRootsで参照。runtime依存の追加なし。raw: reviews/typecheck.txt。
- 検証版のSHA256: reviews/verification.json。親Gitの未追跡../.gitignoreは変更せず、claudexは親Gitにignoreされている。親repoのHEADをこの実装の版と読み替えない。

製品のobserverは常に未接続null。試験用観測はtests/supportだけ。試験結果はnative会話の稼働、read/send、常用導入の証明ではない。

## 補助コードレビューと修正版

Codex内部の補助レビューREQUEST_CHANGESで4件を再現。投影前の最新認可、旧世代候補のcwd順位、停止観測とGit鮮度の分離、不正initialized要求の状態遷移を修正。追加4試験は修正前に実終了1、修正後PASS。

Opus初回の実地検査は58試験を実行し実終了0、P1 PASS。ただしこの版は上記修正で更新され、最終版の判定に流用しない。Opusの追加指摘filter名の「=」をfail-closedへ修正し実Git試験を追加。FIFO入力もO_NONBLOCKで即時拒否する試験を追加。修正版verifyは64/64 PASS、実終了0。srcのstrict tscも実終了0。verification.jsonを更新し、旧58版manifestはverification-58-superseded.jsonへ保存。

Haiku/Opusの修正版の再判定待ち。native稼働観測器未接続の境界は変わらない。

## 66試験版の最終確認

選択時の最後の非同期処理中に候補集合が変わる競合と、観測が期限切れになる競合を追加試験で再現。修正前はdiscovery試験44/46 PASS、実終了1（reviews/red-late-observation.txt）。修正後はverify66/66 PASS、実終了0、skip/cancelなし（reviews/verify.txt）。修正内容はreviews/final-race-worker.md。

64試験版のmanifestはreviews/verification-64-superseded.jsonへ保存。以前のHaiku / Opus判定は旧版の記録で、66試験版の合格証拠には流用しない。最新のSHA256はreviews/verification.json。strict型検査は実終了0（reviews/typecheck.txt）。最終66試験版の独立判定はPASS。

P1製品のnative稼働観測器は未接続。Observation.sourceはnative観測器を識別し、Git取得元は固定のobserveGit関数。独立したnative / Git source識別子はP2で実アダプターを接続する前の契約。今回の合否範囲D1〜D6は変更しない。

## 最終66試験版の検収完了

- leaderのverify: 66/66 PASS、実終了0（reviews/verify-orchestrator-66.txt）。
- strict tsc: 実終了0（reviews/typecheck.txt）。
- Haiku4.5: PASS、実終了0（reviews/build-haiku-66.txt）。
- Opus5.5: D1〜D6 PASS、実終了0（reviews/build-opus-66.txt）。Opus自身もverifyを実行し66/66 PASS、実終了0を確認。
- Opusはhash照合とtscを再実行していない。leaderが判定前後の15ファイルSHA256一致を確認。完了記録時にも現物一致を確認した。

今回完了したのはP1 discovery共通核。native稼働観測器は未接続。元会話read / send、Desktop導入と製品全体の検収はP2以降。過去判定と負の試験証拠は履歴として保存する。説明HTMLのvisual readbackは未実施で、構造検査の結果を画面確認の代わりにしない。
