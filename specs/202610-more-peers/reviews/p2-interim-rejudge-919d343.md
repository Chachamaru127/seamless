# Codex gpt-6-astra（high、読み取り専用）の判定の原文

依頼の要旨は evidence.md の「P2 のコードの中間判定」にある。最後の答えだけを写した。


**判定：PASS。確信度：high。** 指定された4項目で、修正必須のコード不具合は見つかりませんでした。

| 番号 | 回答 | 根拠 |
|---|---|---|
| 1 | **Yes** | [peers.ts:54](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/peers.ts:54) の `keyOf` を、送信側の [webhook-send.ts:36](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:36) と比較側の [external-inbound.ts:49](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:49) が共用。比較する両側を正規化します。同一登録と別登録を含む12通りの衝突を、メモリ内試験で確認しました。 |
| 2 | **Yes** | [webhook-send.ts:49–58](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:49) は本文を最後まで読み、例外なら `unknown`、完了なら `submitted`。標準の上限は15秒です。通信しない模擬応答を Node の実際の `fetch` に渡し、200,000バイト完了、70,000バイト後の切断、本文待機中の時間切れを確認しました。`AbortSignal.timeout` は本文にも効いています。 |
| 3 | **Yes** | [peer-secrets.sh:47–55](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/scripts/peer-secrets.sh:47) は元の値と接頭辞を外した値、それぞれのJSON表記を生成します。値の出力は `emit` 内の組み込み `printf` だけ。[75行と82行](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/scripts/peer-secrets.sh:75) ではパイプで渡し、外部コマンドの引数に値を載せません。 |
| 4 | **Yes** | [external-inbound.ts:93–99](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:93) の署名検証には、従来どおり受信鍵の原文を使います。`Bearer ` だけの送信鍵は正規化後に空となり拒否。漏れ検査では空の検索語を追加しません。`local -a` と `+=` は Bash 3.2.57 で実行確認済み。既存試験の期待値を弱める変更もありません。 |

**直すべきコード：なし。実測説明には訂正が1点あります。**

[webhook-send.test.ts:126](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/webhook-send.test.ts:126) の「長い正常応答」は旧版でも通ります。旧版の `post` でも確認しました。「追加5件すべてが旧版で失敗」は不正確で、この1件は正常系を維持する試験です。コードのPASS判定には影響しません。

全体試験は再実行せず、提示された `verify.sh exit 0` の結果を採用しました。ファイル変更、外部通信、実在する鍵とURLの読み取りは行っていません。

