# Codex gpt-6-astra（high、読み取り専用）の合言葉の作りの判定の原文（版 e9f7aa9）

**判定: FAIL。対象は e9f7aa9。項目 5 に修正が必要です。**

1. **Yes。合言葉の配送と秘匿**
   合言葉は登録先の webhook 本文だけに追加されます。リダイレクトは追わず、応答本文や例外の内容も返しません。予約には指紋だけを保存し、呼んだ会話への結果から指紋も除外します。同じ ID の再送では合言葉を再生成しません。指紋は固定長の `timingSafeEqual` で比較しています。
   根拠: [webhook-send.ts:50–86](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:50)、[delivery.ts:79–96](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:79)、[bot-executor.ts:50–57](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:50)。

2. **Yes。宛先、返信先、期限、形の検査**
   元の依頼 ID、宛先 Bot、送り手の会話 ID と世代、経過時間 `0～86,400,000 ms`、合言葉の形、指紋を確認します。別 Bot 宛て、期限切れ、指紋のない旧予約、予約なしは拒否されます。不正な合言葉から UUID 検査へ逃げる経路もありません。
   根拠: [bot-executor.ts:35–57](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:35)、[request-store.ts:45–51](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/request-store.ts:45)。

3. **Yes。Grok Bot アプリからの起動が必須**
   合言葉が一致しても、祖先プロセスの実行ファイルが指定の署名を持たなければ拒否します。署名鍵を読むのはこの確認後です。Mac の依頼元へ合言葉を返す経路も見当たりません。
   根拠: [bot-executor.ts:25–39、59–69](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:25)、[bot-sign.ts:39–45](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:39)。

4. **Yes。署名形式と既存経路の維持**
   `replyToken` は署名前に取り除かれ、9 行の `signingInput` と Bot → Mac の配送封筒には入りません。`send --as` は従来の検証経路を通ります。webhook は既存項目を維持した欄の追加で、保存形式の不可逆な移行もありません。ただし旧版へ戻す際は、茶々丸の返信手順からも追加欄を外す必要があります。
   根拠: [bot-sign.ts:39–45](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:39)、[signed-envelope.ts:67–68](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/signed-envelope.ts:67)、[automatic.ts:102–118](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/automatic.ts:102)。

5. **No。試験の不足と記録との不一致**
   追加試験は通常の成功、拒否条件、合言葉の除外を捉えています。しかし、次の 2 点が残ります。

   - **正しい返信が保存前に届くと拒否される。** `pending` 予約には指紋がなく、webhook の応答本文を読み終えた後に初めて指紋を保存します。その間に茶々丸が返信すると `reply_token_mismatch` になります。送信後、保存前にプロセスが終了すると、その依頼では以後も照合できません。返信試験は指紋入りの予約を先に作っているため、この順序を捉えません。
     根拠: [delivery.ts:78–94](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:78)、[webhook-send.ts:60–86](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:60)、[bot-send.test.ts:246–262](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-send.test.ts:246)。

   - **合言葉は「使い捨て」になっていない。** 照合後に使用済みを記録しません。同じ合言葉でも、返信 ID と本文を変えれば期限内に再び署名と配送が可能です。署名ごとに新しい nonce が作られるため、nonce の再利用検査では止まりません。
     根拠: [Plans.md:26](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/Plans.md:26)、[bot-executor.ts:50–57](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:50)、[bot-sign.ts:44](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:44)、[delivery.ts:54](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:54)。

**直すべき点:** 指紋を POST 前に予約へ確定保存し、応答前の返信を試験すること。使い捨てを保証する原子的な使用記録を加え、同時使用と別 ID／別本文による再使用を試験すること。

**確信度: high。** 静的な経路確認に基づく判定です。先に試験を落とした経緯は [evidence.md:799](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/evidence.md:799) によります。`verify.sh` の exit 0 は提示された実測として扱い、今回は再実行していません。書き込み、外部通信、禁止された実在の鍵の読み取りは行っていません。
