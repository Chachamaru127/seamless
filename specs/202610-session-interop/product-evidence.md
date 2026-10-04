# 既存会話ペアの製品検証

更新: 2026-10-02 JST
状態: 今回承認された既存会話ペアの相互read/send/replyを検収完了。常用MCP設定への導入は対象外。

本人が同じ作業場所で起動した「接続確認」のClaudeと、このCodex会話を使う。グローバル設定への導入、他Mac、他版を今回の完成範囲に含めない。

製品serve --nativeから相互read、Codex起点の依頼とClaudeのreplyTo付き返信を観測した。Claude待機中の純正peer包みを読取り可能に修正し、同じ依頼への返信も観測した。本文は中継に保存していない。

読取アダプターの独立判定はAPPROVE。対象10試験と復号境界5ケースの実終了コード0、検査前後ハッシュ一致。配送レビューは切断時分類とプロセス間重複排除を修正後、Opus再判定PASS。重大0、中0。

## 元会話による往復の実測

| 起点 | 依頼ID | 返信ID | 確認した段階 |
|---|---|---|---|
| Codex | cldx-product-71f8 | 0bd9ed2e-c4be-4e37-b7b9-1d9553ea6147 | replied。native記録で依頼をobserved、返信の乱数とreplyTo一致 |
| Claude | cldx-claude-first-20261002 | cldx-codex-reverse-reply | replied。Codexで依頼をobserved、Claude製品readでRVERSE42とreplyTo一致 |
| Claude待機時への依頼 | cldx-idle-peer-fix | 53eb5c63-e2f9-4509-bbdb-34c68e5a4763 | replied。純正peer包みの依頼をobserved、返信のreplyTo一致 |

Codex Desktop `26.928.40906+12694`。Claude Desktop同梱Code `2.1.284`、peerProtocol 1。Codex ownerとClaude PID/起動世代を固定して照合した。元会話の可視本文を読んだが、中継証拠には本文の写しを保存していない。

送信のsubmittedと、受信記録のobserved、返信のrepliedを実測上で区別する。現在のsend返却はsubmitted/unknown/rejected等。observed/repliedは元会話を再読してID相関を確認する。別の状態照会APIや常駐監視は追加していない。

## 最終機械検証

`bash scripts/verify.sh`: 100/100 PASS、実終了コード0。全srcと変更対象のadapter/delivery/MCP/runtime試験のstrict型検査: 実終了コード0。2026-10-02T09:16前後の検査でsrc/testsのSHA-256が前後一致した。時刻と完全hashは `.local/interop-verification/verify.json`、試験出力はverify.txtに置く。

最終ソースの新しいserveプロセスでClaudeの元項目IDを保持したreadが成功。同じ送信IDを別の新プロセスから呼び直しても、保存済み結果だけを返した。乱数e2f7a61fd0を付けた依頼cldx-final-e2f7a61fd0に対し、同じCodex会話でcldx-final-reply-e2f7a61fd0を受信しreplyToと乱数が一致。元Claude記録の依頼は1件。別プロセスからの再呼出しで二重配送されなかった。証拠はfinal-native-proof.jsonで、実終了コード0。

常用MCP設定の変更は今回行っていない。今回の5操作はモデルが製品CLIを呼んで実行した。stdio MCPにも同じ3操作を提供するが、両Desktopの常設MCP一覧への導入を完了したとは主張しない。

最終図面レビュー（Haiku）はPASS。確認不足として配送独立判定の追記と、observed/replied段階の明記を求めた。上記表へ段階を追記した。observed/repliedの照合はオーケストレーターが製品read/adapter.inboundの元IDを照合する検証操作であり、send APIがその状態を自動で返す実装ではない。自然言語での5操作は今回実際に行った。Desktop内の常設MCP接続は別の未導入項目である。

## 最終判定

読取り: 別家系の独立判定APPROVE。配送/runtime: Opus再判定PASS、重大0、中0。図面と範囲: Haiku PASS。レビューCLIの終了コードはいずれも0だが、それを試験合格とは扱わない。試験合否は上記100試験とstrict検査の実終了コードで判定する。

Opusは98試験時点の証拠を参照してコード修正を検査し、hashの独立照合は実施していないと明記した。rootが最終100試験を実行し、完全hashを保存して検査後の現物一致を再確認した。レビューが全試験を独立再実行したとは主張しない。

完成単位は、本人が指定したこのMacの既存ペアで、相手探索、双方向許可確認、元会話読取り、依頼配送、同じ会話からの返信取得を行う5操作。別Mac、クラウド、未知版、常設MCP導入はこの完成判定に含めない。
