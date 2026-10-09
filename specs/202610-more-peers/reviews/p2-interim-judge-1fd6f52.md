# Codex gpt-6-astra（high、読み取り専用）の判定の原文

依頼の要旨は evidence.md の「P2 のコードの中間判定」にある。最後の答えだけを写した。

**判定：FAIL。** 対象は `1fd6f52`。修正が必要な不具合を3件確認しました。正式判定 T2-9 と実在 Bot の送受信は対象外です。

| 番号 | 判定 | 根拠 |
|---|---|---|
| 1 | **No** | T2-1〜T2-6 の基本場面に試験はありますが、下記①〜③を検出できません。鍵の試験は [signed-inbound.test.ts:502](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/signed-inbound.test.ts:502)、切断試験は [webhook-send.test.ts:106](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/webhook-send.test.ts:106)、漏えい検査は [peers.test.ts:314](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/peers.test.ts:314)。 |
| 2 | **Yes** | コード上、環境変数から読んだ鍵と住所を結果や予約へ出す経路は確認されませんでした。通信例外も固定の理由へ変換しています。[webhook-send.ts:30](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:30)、[delivery.ts:71](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:71)、[cli.ts:61](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/cli.ts:61)。ただし、漏えい検査には③の見逃しがあります。 |
| 3 | **No** | 送信鍵に `Bearer ` が付くと、実効的に同じ受信鍵との一致を検出できません。送信鍵を使った署名が配送まで通ることを模擬再現しました。[external-inbound.ts:49](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:49)。 |
| 4 | **Yes** | 予約による重複防止、配送直前の名簿と範囲の再確認、リダイレクト禁止、HTTPS 限定を確認しました。[delivery.ts:78](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:78)、[webhook-send.ts:35](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:35)、[webhook-send.ts:55](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:55)、[webhook-send.ts:93](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:93)。応答の成否判定には②が残ります。 |
| 5 | **Yes** | 本人の承認ではない旨を付け、`humanApproval:true` を生成しません。設定の前後比較には、変更を検出できる対照もあります。[webhook-send.ts:44](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:44)、[automatic.test.ts:703](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/automatic.test.ts:703)。 |
| 6 | **No** | 今回の `bash scripts/verify.sh` は **終了コード1**。読み取り専用環境で一時フォルダ作成が拒否され、回帰なしを確認できませんでした。[verify.sh:7](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/scripts/verify.sh:7)。コードの回帰と断定する結果ではありません。 |
| 7 | **Yes** | 記録された方針変更自体に、ACを免除する変更は確認されませんでした。一覧から範囲外を除く扱い、署名形式の版追加、24時間の重複抑止は要求を維持しています。[Plans.md:71](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/Plans.md:71)、[Plans.md:80](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/Plans.md:80)、[evidence.md:512](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/evidence.md:512)。①は、その方針を実装へ反映しきれていない不具合です。 |

直すべき点は次の3件です。再現には合成した鍵、メモリ内のファイル操作、模擬の通信応答だけを使いました。

1. **送受信鍵の分離を `Bearer ` で迂回できる。**  
   [external-inbound.ts:52](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:52) は環境変数の文字列をそのまま比較します。一方、[webhook-send.ts:39](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:39) は送信時に接頭辞を外します。  
   受信鍵を `K` とすると、送信鍵 `K` は拒否されましたが、`Bearer K` は **`submitted`、模擬配送1回**になりました。実際に使用する鍵へ正規化してから、自分と他登録の受信鍵との重複を拒否する必要があります。

2. **大きい応答の切断を受理済みにする。**  
   [webhook-send.ts:58](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:58) は65,536バイトを超えると読み取りを打ち切り、そのまま `submitted` を返します。  
   同じ「2xx → 本文 → 切断」の模擬応答で、32バイトは `unknown / answer_cut`、65,537バイトは **`submitted`** でした。応答完了を確かめず打ち切る場合は `unknown` にし、この境界の試験を追加してください。T2-2とAC7の「応答が失われても成否不明」に反します。

3. **漏えい検査が、接頭辞を外した送信鍵を見逃す。**  
   [peer-secrets.sh:46](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/scripts/peer-secrets.sh:46) は環境変数の値とそのJSON表現だけを検索します。設定が `Bearer K` の場合、記録に残った `K` 単体を検出しません。実際の `emit` 関数と `grep` を使い、通常設定では検出、接頭辞付きでは見逃すことを確認しました。元の値に加え、正規化後の鍵も検索対象にしてください。

`verify.sh` の実測結果は次のとおりです。実環境の鍵を引き継がず、隔離したホーム指定で実行しました。

| 検査 | 今回の結果 |
|---|---|
| 型検査 | 終了コード0 |
| Node試験 | 620件：成功155、失敗465 |
| 帯の定義検査 | 通過 |
| 帯の試験 | 99件：成功17、失敗82 |
| 鍵の検索 | 登録なしとして通過。実在の鍵は未検査 |
| `verify.sh` 本体 | **終了コード1** |

失敗の主因は試験用 `mkdtemp` の `EPERM` です。既存経路の回帰確認には、一時領域へ書ける隔離環境での再実行が必要です。

**確信度：high（上記3件）。既存経路の回帰なしは未確認です。** ファイルの変更はなく、判定後も対象版と作業ツリーは変わっていません。
