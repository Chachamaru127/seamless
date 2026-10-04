# 実装タスクと検証の対応

更新: 2026-10-01 JST
方式検証を実装タスクへ持ち越さない。以下のP1–P6は完成版の実装と検収。

| ID | 今回の検証 | 結果 | 成果物 |
|---|---|---|---|
| E1 | 専用2会話、実MCPによる相互read | PASS | live.json、native-evidence.json |
| E2 | 両方向の実モデルsend/reply、未知nonceとIDで照合 | PASS | live.json |
| E3 | busy、ID/PID維持、peer履歴 | PASS | live.json、codex-native-settings.json |
| E4 | native重複と停止、承認文言の扱い | 観測完了。Codex重複排除への依存は不採用 | edges.json |
| E5 | Desktop元ownerへ配送、snapshot読取り、全履歴ロード | PASS | desktop*.json、full-history-result.json |
| E6 | Claude Desktop本人の読取りと返信、元画面表示 | PASS | desktop.json、desktop-claude-receipt.json |
| E7 | 可視内容、peer抽出、Desktop履歴判定 | 6/6 PASS | test_projection.py、test_desktop_history.py |
| E8 | 独立レビュー指摘への修正、再判定 | APPROVE | plan-review.md |

| ID | 作るもの | 依存 | 受入条件 |
|---|---|---|---|
| P1 | 登録、接続世代、能力表示、CLI | E1–E6 | 表示名だけで宛先を決めない。旧世代と未登録を拒否 |
| P2 | Codex/Claude read接続部 | P1 | 可視本文、元ID、peer、cursor、空/不存在を区別 |
| P3 | 単一write経路、MCP、相関、重複排除 | P1,P2 | 乱数付き往復、別sender/他者reply拒否、unknownで再送0 |
| P4 | 版固定Desktop接続部 | P3 | 既存owner、元UI、設定を保持。未対応版は明示停止 |
| P5 | 初回登録、受信ルール、自然言語操作、解除 | P1–P4 | コピー貼付けなしで同じ3操作を選べる。解除後も元会話が残る |
| P6 | 製品の受入試験と独立レビュー | P1–P5 | Plans.mdの10条件、実終了コード、別家系APPROVE |

長期の耐久キューや別Mac連携は、日を跨ぐ自動継続を要件化した時点で別計画にする。

## 2026-10-02 既存会話ペアへの製品接続

本人がCodex側で「Claudeセッション起動したからそこと連携しながら完成させて」、Claude側で同じCodex会話への連携とread本実装を指示。承認済みP2–P6をこの既存ペアで進める。元の会話への連絡は承認済み。グローバル設定配送、公開、別repo変更は含めない。

| ID | 担当と所有パス | 依存 | Done when |
|---|---|---|---|
| P2-live [P] | 既存Claude。src/adapters/**、専用read試験 | P1 | 現行版の元会話を可視本文と元IDで読み、世代と続きの取得を検証 |
| P3-live [P] | Codex施工。src/delivery.ts、src/mcp.ts、src/cli.ts、src/serve.ts、専用配送試験 | P1、統合時P2-live | 許可を通した単一write、重複抑止、返信相関、unknownで再送0 |
| P4-live [P] | Codex施工。src/native-runtime.ts、専用runtime試験 | P1、統合時P2-live | 同じnative会話のPID/起動世代/cwd/socket/ownerを毎回照合 |
| P5-live | オーケストレーター。ローカルペア登録と自然言語による実使用 | P2–P4-live | 本人のコピー操作なしで、このCodexと「接続確認」のClaudeが相互read/send/reply |
| P6-live | 機械確認、別会話の独立レビュー | P2–P5-live | 実試験終了コード0、重大指摘0、範囲と未観測を証拠へ明記 |

下記の最終検収を参照。現行Desktopは26.928.40906 build12694で旧検証版とは異なる。新版の受入を実観測で確認する。本文の永続コピーを作らず、試験用会話にすり替えない。

現行実装の機械検証: 100試験PASS、実終了0、strict型検査終了0、検査前後hash一致。P2-live読取独立判定APPROVE。P3/P4-liveの切断と再起動時重複抑止の修正完了。P5-liveの双方向実会話往復、busy/idle読取、最終コードの別process再呼出しでnative依頼1件を確認。P6-liveは配送と範囲の最終独立判定待ち。本文の中継コピーなし。

P6-live完了: 配送Opus再判定PASS、重大0/中0。図面Haiku PASS。最終機械検証100試験/strictとも実終了0、source hash一致。P2〜P6-liveの今回の既存ペア範囲を検収完了。
