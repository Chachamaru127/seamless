# Codex gpt-6-astra（high、読み取り専用）の見直した合言葉の作りの判定の原文（版 1a966b0）

**判定: PASS。確信度: high。** 現在の「24 時間、何通でも返信できる」決まりに適合しています。

1. **Yes。合言葉の扱いと保存順序は適切です。**
   24 バイトの乱数を生成し、合言葉と保存用の指紋を分離しています。指紋は POST 前に `pending` の予約へ書き込み、同期を完了します。`unknown` になっても残ります。比較には固定長の指紋と `timingSafeEqual` を使っています。
   合言葉は署名前に取り除かれ、結果、予約、nonce、ログ、例外、署名対象、返信の配送封筒へ流れる経路はありません。HTTP の応答本文や例外内容も返しません。
   根拠: [webhook-send.ts:60](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:60)、[delivery.ts:75](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:75)、[bot-sign.ts:39](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:39)、[bot-executor.ts:51](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:51)。

2. **Yes。指定された拒否条件が署名前に働きます。**
   別 Bot 宛て、期限超過、指紋なし、別会話、別世代、不正な合言葉を拒否します。一致しても Grok Bot アプリ以外の起動元は拒否します。封筒の形の検査も署名前です。合言葉の照合は予約を読むだけで、使用済み印などを書きません。
   根拠: [bot-executor.ts:36](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:36)、[bot-sign.ts:42](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:42)、[request-store.ts:49](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/request-store.ts:49)。

3. **Yes。受信側の検査順序と既存経路を維持しています。**
   受信側は「封筒の欄 → 送り手の一致 → 操作ごとの形」の順です。`sender_mismatch` の優先順位も変わりません。署名前の `envelopeFor` は、受信側と同じ `parseSignedEnvelope` と `callShape` を呼びます。
   `send --as`、Mac の会話間の経路、チャットの UUID 確認は維持されています。署名経路は CLI に限定され、MCP と serve からの署名要求を許す変更もありません。
   根拠: [external-inbound.ts:82](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:82)、[signed-envelope.ts:87](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/signed-envelope.ts:87)、[automatic.ts:102](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/automatic.ts:102)、[bot-send.test.ts:199](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-send.test.ts:199)。

4. **Yes。試験と記録は現在の決まりを捉えています。**
   試験には、送信前の指紋保存、漏出防止、拒否条件、複数回と同時の照合、`pending` の照合、返信 ID 衝突後の別 ID での成功が含まれます。
   使い切りの撤回と漏洩時の制限は、先送り表、見直し記録、手順書で一致しています。表にない守りの弱体化は確認されませんでした。
   根拠: [webhook-send.test.ts:95](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/webhook-send.test.ts:95)、[bot-executor.test.ts:79](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-executor.test.ts:79)、[bot-send.test.ts:265](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-send.test.ts:265)、[Plans.md:35](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/Plans.md:35)、[evidence.md:809](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/evidence.md:809)、[chachamaru-mvp.md:20](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/handoff/chachamaru-mvp.md:20)。

**直すべき点: 今回の判定範囲ではありません。**

試験は再実行していません。`1220763` との `src`、`tests`、`scripts/verify.sh` の一致は、差分コマンドの終了コード 0 で確認しました。719 件、帯 99 件、peer-secrets の成功はリーダーの実測報告に基づきます。ファイル変更、外部通信、禁止された実値の読み取りは行っていません。
