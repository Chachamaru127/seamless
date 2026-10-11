# Codex gpt-6-astra（high、読み取り専用）の判定の原文

依頼の要旨は evidence.md の「MVP の部品と M2 の道具の判定」にある。最後の答えだけを写した。

**判定: FAIL**。対象は `a62bb95`、比較元は `919d343`。項目 1 と 2 に修正が必要です。Yes は「確認条件を満たす」の意味です。行番号は対象版に基づきます。

| 番号 | 判定 | 根拠 |
|---|---|---|
| 1 | **No** | `scripts/peer-setup.sh:79,103` が、URL と送受信鍵の実値を `security … -w` のプロセス引数へ渡します。引数を観測できる経路に値が出ます。この例外は `Plans.md:18–24` の先送り表にありません。MCP と serve から代行署名を呼ぶ経路、Mac 内の会話を送り手に指定する経路は見つかりませんでした。 |
| 2 | **No** | `src/nonce-store.ts:53–55,71–74` は、同じ依頼 ID に残った最初の署名記録を使います。過去の Bot 署名記録と今回の Mac 署名による配送記録が結び付き、`verified` になる場合があります。 |
| 3 | **Yes** | 既存経路を壊す変更は見つかりませんでした。通常の呼び手確認と status は `src/automatic.ts:117–144`、既存操作の入口は `src/cli.ts:27,55–58` に維持されています。帯の変更は試験側の返り値修正だけです。提示された全試験成功も判断材料にしました。 |
| 4 | **Yes** | `scripts/peer-roster-write.ts:41–48` は、通常の再実行で失効解除を拒否し、既存の範囲と送信可否を維持します。他の登録も維持します。明示変更の内容は同ファイル `54–59` で表示します。 |
| 5 | **Yes** | 配布に向けた構造は維持されています。名簿、署名確認、拒否、重複防止、共通配送を通ります（`src/external-inbound.ts:92–116,145–169`）。入力から本人の承認を追加できません（`src/bot-sign.ts:16–25`）。ただし、署名と配送の記録の結び付けには項目 2 の修正が必要です。 |

直すべき点は 2 件です。

1. **鍵と URL をプロセス引数に載せない。**  
   [peer-setup.sh](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/scripts/peer-setup.sh:79) の 79 行と 103 行が対象です。値を標準入力で受け取り、Keychain API で保存する補助処理などへ変更してください。`tests/peer-setup.test.ts:246–247` は現状、この書き込みコマンドを引数漏れの検査から除外しています。

2. **実際に配送した要求と、その署名元を結び付ける。**  
   [nonce-store.ts](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/nonce-store.ts:55) の 53–55 行と 71–74 行が対象です。再現条件は次の順です。
   1. Bot の署名は通るが、宛先が停止中で配送に失敗する。署名記録だけが残る。
   2. 宛先の復帰後、同じ登録、鍵の版、依頼 ID、宛先で `bot-send` が配送する。
   3. 古い Bot 署名記録と新しい配送予約が揃い、Mac の代行署名なのに `verified` になる。

対象版の `claimNonce` と `wasSigned` を、保存処理だけメモリ内に置き換えて確認しました。期待値 `false` に対し実結果は `true` でした。この再送条件を回帰試験に追加してください。

**確信度: high。** 全体試験は提示された `verify.sh exit 0` を採用しました。こちらでは実在の Keychain、`~/.seamless`、環境変数の鍵や URL を読まず、ファイル変更と外部通信も行っていません。
**判定: FAIL**。対象は `a62bb95`、比較元は `919d343`。項目 1 と 2 に修正が必要です。Yes は「確認条件を満たす」の意味です。行番号は対象版に基づきます。

| 番号 | 判定 | 根拠 |
|---|---|---|
| 1 | **No** | `scripts/peer-setup.sh:79,103` が、URL と送受信鍵の実値を `security … -w` のプロセス引数へ渡します。引数を観測できる経路に値が出ます。この例外は `Plans.md:18–24` の先送り表にありません。MCP と serve から代行署名を呼ぶ経路、Mac 内の会話を送り手に指定する経路は見つかりませんでした。 |
| 2 | **No** | `src/nonce-store.ts:53–55,71–74` は、同じ依頼 ID に残った最初の署名記録を使います。過去の Bot 署名記録と今回の Mac 署名による配送記録が結び付き、`verified` になる場合があります。 |
| 3 | **Yes** | 既存経路を壊す変更は見つかりませんでした。通常の呼び手確認と status は `src/automatic.ts:117–144`、既存操作の入口は `src/cli.ts:27,55–58` に維持されています。帯の変更は試験側の返り値修正だけです。提示された全試験成功も判断材料にしました。 |
| 4 | **Yes** | `scripts/peer-roster-write.ts:41–48` は、通常の再実行で失効解除を拒否し、既存の範囲と送信可否を維持します。他の登録も維持します。明示変更の内容は同ファイル `54–59` で表示します。 |
| 5 | **Yes** | 配布に向けた構造は維持されています。名簿、署名確認、拒否、重複防止、共通配送を通ります（`src/external-inbound.ts:92–116,145–169`）。入力から本人の承認を追加できません（`src/bot-sign.ts:16–25`）。ただし、署名と配送の記録の結び付けには項目 2 の修正が必要です。 |

直すべき点は 2 件です。

1. **鍵と URL をプロセス引数に載せない。**  
   [peer-setup.sh](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/scripts/peer-setup.sh:79) の 79 行と 103 行が対象です。値を標準入力で受け取り、Keychain API で保存する補助処理などへ変更してください。`tests/peer-setup.test.ts:246–247` は現状、この書き込みコマンドを引数漏れの検査から除外しています。

2. **実際に配送した要求と、その署名元を結び付ける。**  
   [nonce-store.ts](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/nonce-store.ts:55) の 53–55 行と 71–74 行が対象です。再現条件は次の順です。
   1. Bot の署名は通るが、宛先が停止中で配送に失敗する。署名記録だけが残る。
   2. 宛先の復帰後、同じ登録、鍵の版、依頼 ID、宛先で `bot-send` が配送する。
   3. 古い Bot 署名記録と新しい配送予約が揃い、Mac の代行署名なのに `verified` になる。

対象版の `claimNonce` と `wasSigned` を、保存処理だけメモリ内に置き換えて確認しました。期待値 `false` に対し実結果は `true` でした。この再送条件を回帰試験に追加してください。

**確信度: high。** 全体試験は提示された `verify.sh exit 0` を採用しました。こちらでは実在の Keychain、`~/.seamless`、環境変数の鍵や URL を読まず、ファイル変更と外部通信も行っていません。
exit=0
