# 計画の独立検査

Observed: 2026-10-01 JST
Status: 以下は旧計画のレビュー。native-first改訂版のレビューは末尾へ追記する。
旧計画準備PASSを新しい計画や機能完成へ流用しない。

## Grokの図面検査

Grok Build CLI、Grok 4.7、high、permission-mode plan。
CLIの実終了コード0。回答の判定は**FAIL**。
この0を計画合格または機能完成に読み替えない。
読ませた対象はルートspecと、機能のspec、Plans、tasks、evidenceだけ。
実装、別の調査役の結論、秘密と既存会話本文は読ませていない。

指摘は7件。送り主の識別、方向別live記録、権限、配送状態、保存監査、Desktop読戻し、対応限界の記録。
全ACにタスク名があるだけでは、試験の断言が仕様より弱いことを検出できないとの判定だった。

rootはACごとに検証表を分け、記録フィールド、6権限試験、禁止fallback 0回、
既存DesktopのPIDと会話ID、保存許可フィールド、未充足の表示を追記した。
試験ファイルの所有者と、tasksのDone whenも合わせた。
7件を修正した案への再判定はPASS。CLI実終了コード0。
これは計画準備だけの判定である。
その後にAsk Proの指摘を反映し、その版をもう一度検査した。

「CLIとruntimeが同じならDesktop試験を失敗させる」という提案は、そのまま採用しなかった。
正規の共用daemonを除外してしまうためである。
代わりに、既存Desktopの会話IDと実行体が試験前後で同じことを照合する。
新設CLIのthread IDで代用する場合を失敗とする。

## Ask Proの敵対検査

ChatGPT 6 Pro。公開資料と固定版Codexを指定。
中継、独自toolOutput、Channels、配送状態、権限、Desktop境界の計画を同じ問いとして渡した。
合格判定は依頼していない。
回答は10分40秒で確定した。合格判定は含まない。
次の10件を計画へ反映した。

| 指摘 | 採用した変更 |
|---|---|
| stdio登録は会話認証ではない | 信頼する起動元、登録資格、世代、失効、製品による会話ID確認。MCP initializeや同UIDだけで認証しない |
| 強い受信会話への権限委譲 | 許可操作とデータと返信範囲を固定。由来別に強制できなければ会話全体を固定できる対象だけ対応 |
| replyとackと結果の認可 | recipientのみのack/reply、senderのみの結果取得。認可後にキャッシュ検索。第三会話の拒否試験 |
| 同期待ちの循環とturnの多対多 | send/replyは保存結果で戻す。MCP waitは即時。1 turnと複数requestを対応づける |
| Desktopの入場条件 | 実runtime、版、schema、購読、入力対象、元UIの承認を確認。冷再開、再ロード、移行を成功から除く |
| toolOutputのwire型 | envelopeをJSON文字列へ変換。本文でnamespace/name/threadIdを変更しない |
| Channelsの交渉とready | 版とrevisionとchannel登録とreply権限を確認。permission capabilityを宣言しない |
| hold/refuseと期限の区別 | 中継で配送前の方針を強制。配送後の期限超過を取消しとしない。late ack/replyを保存 |
| 配送前intentと返信配送 | 書込み前にintentを保存。不明なら再送0。requestとreplyの配送を別記録にする |
| 別IDのループと流量 | 初期実証32 requestの予算。未知状態を件数へ含め、ack/reply枠を別に確保 |

交渉revision 2026-07-28とChannelsの制限は、rootもClaude公式MCP文書で照合した。
記録と画面証拠はresearch.mdと`.local/research/ask-pro-plan-review.jpg`。
この検査は実機へ送っていない。入力型と文章だけで安全性を保証したとは扱わない。

## 承認との関係

最終のGrok 4.7 high検査は計画準備をPASSと判定した。CLI実終了コード0。
14 ACの対応、host由来metadata、依頼ごとの認可、権限委譲禁止、非同期の戻り、
配送前intent、有限予算、Channels ready、既存Desktop保持、unsupportedの扱いを確認した。
実通信の証拠と承認がまだ無いことは、DRAFTの欠陥として判定しないように指定した。

補足は1件。tasksのT09とT10のDone whenが、Plansの追加必須権限ケースを省略していた。
rootは強い宛先への範囲外委譲、同一turnの混在、別名tool、shell、子agentをT09へ追記し、T10も同じ条件にそろえた。
この追記は試験条件の転記であり、検査後に設計や仕様を変更していない。

この文書は人間の承認を発行しない。
仕様承認待ち。実装計画の承認は、その後に求める。
重大な指摘が残る状態は計画承認の準備完了としない。


## native-first版: Grok独立レビュー第1回

Grok Build grok-4.7 / medium / permission-mode plan。実終了コード0。判定REQUEST_CHANGES。
対象は接続試験3ファイルとPlans/spec。追加の実モデル配送ファイルは別途再レビュー対象。

指摘: (1) 空本文から推論なしを断定しない。(2) Claudeが標準session-envに空ディレクトリを残す。(3) Codexのephemeralは要求だけでなく応答も検証する。

対応: (1) 本文を送らないconnect-onlyへ変更。(2) 専用CLAUDE_CONFIG_DIRへ隔離。(3) ephemeral=trueかつpath=nullをassertし結果へ保存。
追加: process groupを専用化して終了。RPC応答待ち中の通知を保持し、配送試験は対象turn IDの返答だけ照合。
再実行: Codex3項目PASS、Claude隔離接続PASS、SDK/schema 3件PASS。実モデル配送は再試験中。

標準session-envに残った初回2試験の空ディレクトリは削除していない。新試験は専用configへ保存する。全ディスク無書込みを主張しない。


## native-first版: 修正後の独立判定

Grok Build grok-4.7 / medium / permission-mode plan。実終了コード0。
**APPROVE（実験記録と計画案のみ）**。運用の相互通信の完成は判定対象外。

回答原文抜粋:
> 先行レビューの3点は、今のコードと最新の記録で閉じている。
> tool 本文に BASE17 は無く、前文の marker を使っている。
> 送り主は synthetic-other-session。Claude 本人の送信、権限境界、既存 Desktop は未検証のまま。

リーダー判断: 上記を採用。実験と計画の整合確認であり、全機能完成や本人承認へ変換しない。
最終レビュー対象のコードと仕様のSHA-256はexperiments/native-interop/results/review-manifest.json。


## 2026-10-01 最終実会話検証後の判定

**APPROVE。対象は方式検証と、その実測を根拠にした実装計画。製品の実装完了ではない。**

Grok Build / grok-4.7 / medium。レビューsession `01a0f6d1-4ab2-7312-bb07-ac9bb0d73c31`、CLI実終了0。原判定は `experiments/live-interop/results/independent-review.txt`。元ID比較、未知nonce、Claude busyの表現、peer履歴、Desktop契約、hold秒数の6指摘が解消した。

軽微な注記も反映した。neverと注釈なしの組合せの拒否結果を結果束へ追加。startのACKは実測済み、steerは静的候補と明記。supportsUntrustedAppInputを送信認可に使わない。ACKをモデル処理完了とは扱わない。実終了コードはrootのtool応答をexecution-observations.jsonへ記録した。

レビュー後の限定修正は履歴完了metadataの精密化。旧判定のitemsHaveLoadedOldestは生の明示trueではなかった。別担当がインストール済みnativeのcanonical完了判定を再確認した結果、欠測はnative側でも許容されると分かった。厳格な独自条件の失敗を隠さず保存し、missing=8をそのまま残す形式に修正した。版固定したnative規則による実読取りは実終了0、追加回帰を含め6/6 PASS。新たな機能範囲は追加していない。原レビューのrevision1000とloadedフラグの記述には、この最新の精密化を優先する。
