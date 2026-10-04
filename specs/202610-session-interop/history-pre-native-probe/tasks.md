> Superseded by 2026-10-01 native-first probe and revised plan.

# セッション互換通信のタスク

Status: DRAFT。仕様と計画の承認前に実装タスクを開始しない。
`[P]`だけ並列にできる。担当のファイルを重ねない。各タスクは1会話で終わる単位。

| ID | 作業と所有パス | 依存 | 状態 | Done when |
|---|---|---|---|---|
| R01 | native通信、公開面、ローカル版を調査。research.md | なし | 回答回収済み | 各通信面の根拠、未確認、使えない担当の理由がresearch.mdにある |
| P01 | 仕様案を本人へ提示。spec.md | R01 | 承認待ち | 本人の仕様承認の出典と日時がevidence.mdにある |
| P02 | 計画案の図面検査と敵対、修正。Plans.md | R01 | 計画準備PASS。補足1件を完了条件へ追記済み | 全ACにタスクと検証が対応し、重大な指摘が未解決で残らない |
| P03 | 計画を本人へ提示 | P01,P02 | 未着手 | 本人の計画承認の出典と日時がevidence.mdにある |
| T01 | 依存宣言と失敗テスト。package.json、test/identity.test.mjs、test/authority.test.mjs、test/delivery.test.mjs、test/recovery.test.mjs、test/audit.test.mjs、scripts/verify.sh | P03 | 未着手 | AC-01,07〜12の必須観測を別ケースにし、未実装による実exit非0を記録する |
| T02 | 永続storeとrequest状態。src/store.mjs | T01 | 未着手 | request/reply別のintent、unknown、同一追跡情報、内容衝突、再送0、件数/サイズ/32件予算、配送前後別の期限の試験がexit 0 |
| T03 | 中継とendpoint登録。src/broker.mjs、src/identity.mjs | T02 | 未着手 | 同名/未知ID、product/host/世代/session別ずらし、旧世代、登録期限だけ切れた接続、本文の宛先差替を拒否し上限試験がexit 0 |
| T04 | 共通MCP tool。src/mcp.mjs | T03 | 未着手 | 接続由来senderと依頼ごとの認可を強制し第三会話のack/reply/結果取得を拒否。send/replyが保存結果で戻りMCPwaitが長時間busyを作らない |
| T05 [P] | Codex接続部。src/adapters/codex.mjs、test/codex.test.mjs | T04 | 未着手 | JSON文字列wireと由来、同一turn複数request、主体保持、中断/別writer 0、review/compact拒否、unknown、予約namespace拒否がexit 0 |
| T06 [P] | Claude接続部。src/adapters/claude.mjs、test/claude.test.mjs | T04 | 未着手 | 交渉revision/channel登録/reply権限でreadyを判定し、channel由来、ack/reply、busy主体保持、未登録/無応答/不正metadataの試験がexit 0 |
| T07 | CLIと接続手順の生成。src/cli.mjs、scripts/ | T05,T06 | 未着手 | list、send、status、reply、wait、checkを模擬2対象で実行できる |
| T08 | 設計と再現手順。docs/、README.md | T07 | 未着手 | 設計validate/checkがexit 0。接続/送信/停止、使用版、unsupported種別と未充足ACを実行結果に残せる手順がある |
| T09 | 固定文のCLI実会話試験。scripts/prove-live.mjs、.local/ | T08,HG-03,HG-04 | 未着手 | 独立した両方向request、通知前idleと後の開始/reply、busy主体保持、before/after設定照合と前文脈参照、6権限試験とfallback 0に加え、強い宛先への範囲外委譲、同一turnの混在、別名tool、shell、子agentの追加必須ケースの証拠がある。強制か観測ができなければunsupportedとする |
| T10 | 既存Desktop接続と読み戻し。docs/compatibility.md、.local/ | T09,必要時HG-05 | 未着手 | 既存両appのPID/世代/session一致、両方向sender/request/reply画面、同じ6権限試験とT09の追加必須ケースの証拠がある。強制か観測ができなければunsupportedとする。不成立はAC-13未充足のまま範囲判断へ戻す |
| T11 | 許可パスと保存内容を検査。scripts/verify.sh、evidence.md | T09,T10 | 未着手 | 許可フィールド/パスをauditし未登録本文/過去ログ/秘密/境界外読取りでexit非0。verify実exit 0と全ACの証拠/未充足を区別する |
| T12 | 別家系の独立判定と引継ぎ。evidence.md、GOD_Plans.md | T11 | 未着手 | 同じ成果物版の判定がPASS。未充足があれば全体完了にしない |

R01とP02は調査と計画書の作成であり、実装コードを含まない。
T10の不成立記録はそのタスクの調査終了であり、AC-13の達成ではない。
再実行で版や証拠が変わった場合はT11とT12をその版でやり直す。
