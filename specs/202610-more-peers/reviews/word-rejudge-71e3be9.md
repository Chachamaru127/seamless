# Codex gpt-6-astra（high、読み取り専用）の合言葉の作りの 3 回目の再判定の原文（版 71e3be9）

**判定: FAIL。項目 1 は No、項目 2 は Yes。**

1. **No。形検査の共通化はできていますが、拒否順序が変わり、再送で救えない経路も残っています。**

   `envelopeFor` は基本検査と送信種類ごとの検査をまとめています。代行署名は合言葉を消費する前に呼びます。空本文と一覧用宛先の穴は修正されています。[signed-envelope.ts:86](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/signed-envelope.ts:86)、[bot-sign.ts:42](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:42)

   **問題 A: `sender_mismatch` の優先順位が変わりました。** 送信者不一致と空本文が重なる入力は、旧版では `sender_mismatch`、新版では `envelope_invalid / recipient_or_text` になります。不正な一覧要求でも同様です。理由の文字列自体は維持されていますが、どの理由を先に返すかが変わっています。受信処理の該当部分を抽出した、書き込みなしの実行で再現しました。[external-inbound.ts:85](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:85)

   **問題 B: 既存の返信 ID と衝突すると、合言葉の消費後に行き詰まります。** 別の依頼で使った ID を指定すると、合言葉がその ID に固定された後で `id_conflict` になります。同じ ID は再び `id_conflict`、新しい ID は `reply_token_used` です。実装関数の保存先をメモリ内の代用品へ差し替えて再現しました。[bot-executor.ts:81](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:81)、[delivery.ts:83](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:83)

   宛先不在、範囲外、Grok 宛ての 8,000 字超過も消費後に拒否されます。ただし、これらは返信の予約前なので、**期限内に条件を解消し、同じ ID で代行署名し直せば再試行できます**。会話の世代変更や期限切れまで救う仕組みではありません。[external-inbound.ts:139](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:139)、[bot-executor.ts:55](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:55)

2. **Yes。前回確認した保護は維持されています。**

   - 指紋を送信前に同期保存し、結果更新でも保持します。[delivery.ts:75](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:75)
   - 合言葉そのものは登録 Bot への送信に渡し、保存するのは指紋です。署名する封筒からは除外します。[webhook-send.ts:75](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:75)、[bot-sign.ts:39](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:39)
   - Bot、返信先と世代、期限、合言葉の形、起動元アプリ、使い捨て、同時実行、掃除の検査は変更されていません。[bot-executor.ts:39](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:39)
   - 試験の隔離、9 行の署名形式、既存受信経路への引き渡しも維持されています。[bot-executor.test.ts:108](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-executor.test.ts:108)、[signed-envelope.ts:67](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/signed-envelope.ts:67)、[automatic.ts:111](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/automatic.ts:111)

**直すべき点:** 基本検査 → `sender_mismatch` → 種類別検査という旧順序を保ってください。既存 ID との衝突も、合言葉を消費する前に拒否できるようにしてください。両方の回帰試験が必要です。

**確信度: high。** 読み取り専用の再現確認は exit 0。全体試験の exit 0（node 720 件、帯 99 件、peer-secrets ok）は提示された実測として扱い、再実行していません。ファイル変更、外部通信、禁止された実在の鍵や環境変数の読み取りは行っていません。
