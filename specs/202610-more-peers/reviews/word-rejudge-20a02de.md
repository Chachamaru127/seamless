# Codex gpt-6-astra（high、読み取り専用）の合言葉の作りの 2 回目の再判定の原文（版 20a02de）

**判定: FAIL。項目 1 は No、項目 2 は Yes。**

1. **No。前回の修正は入っていますが、受信時に形を拒否する前に合言葉を消費する経路が残っています。**

   `text: ""` は `parseSignedEnvelope` を通ります。そのため署名前に使用済みの印を作り、その後で受信側が `envelope_invalid / recipient_or_text` を返します。返信 ID を変えて修正すると `reply_token_used` になります。同じ ID のまま本文を直す場合は再試行できます。

   根拠: [signed-envelope.ts:52](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/signed-envelope.ts:52)、[bot-sign.ts:42](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:42)、[bot-executor.ts:81](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:81)、[external-inbound.ts:89](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/external-inbound.ts:89)。

   **同じパーサーを呼んでいますが、受信側には追加の形検査があります。** 書き込みのない確認でも、空本文はパーサーを通り、受信側の送信条件には不適合となりました。追加試験は 257 文字の ID を扱い、空本文で合言葉が未使用のままかは確認していません。[bot-send.test.ts:265](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-send.test.ts:265)

   前回の各指摘については次の状態です。

   | 指摘 | 確認結果 |
   |---|---|
   | (a) 不正 ID の先行消費 | 257 文字の ID は修正済み。上記の追加試験で拒否後の正常返信も確認しています。 |
   | (b) 強制終了後の一時ファイル | 1 分超の残骸を次の使用時に回収します。試験は残骸を人工的に作る方式です。[実装:71](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:71)、[試験:127](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-executor.test.ts:127) |
   | (c) 共通一時フォルダへの残留 | 予約と印を試験専用の親フォルダ内へ隔離し、親ごと削除します。共通フォルダに印がないことも検査します。[試験:108、128〜143](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-executor.test.ts:108) |
   | (d) ID 再利用の説明矛盾 | 同じ返信の再試行だけを例外として明記。文面を直接確認しました。[説明:19〜20](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/handoff/chachamaru-mvp.md:19) |

   掃除は確定した印を更新時刻から **2 日超**で削除します。合言葉は依頼から **1 日以内**だけ有効です。通常の時計と、この実装が作成する印では、有効期間中の印を掃除する経路は見当たりません。[bot-executor.ts:60、71〜75](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:60)

2. **Yes。前回 Yes だった保護は維持されています。**

   指紋を `pending` 予約へ保存して同期した後に送信し、結果更新でも保持します。[delivery.ts:75〜98](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:75)

   合言葉は登録 Bot への送信にだけ渡し、保存するのは指紋です。返信の署名対象からも除外します。[webhook-send.ts:75〜94](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:75)、[bot-sign.ts:39](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:39)

   Bot、返信先の会話と世代、期限、合言葉の形、起動元アプリの検査は残っています。9 行の署名形式と既存受信経路も維持されています。[bot-executor.ts:41〜62](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:41)、[signed-envelope.ts:67](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/signed-envelope.ts:67)、[automatic.ts:111〜116](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/automatic.ts:111)

**直すべき点:** 受信側の送信種別ごとの形検査も、合言葉を消費する前に共通処理として通してください。「空本文を拒否した後、別の正常 ID で返信できる」試験を追加してください。

**確信度: high。** `verify.sh` の exit 0（node 720 件、帯 99 件、peer-secrets ok）は提示された実測として扱い、再実行していません。ファイル変更、外部通信、禁止された実在の鍵や URL の読み取りは行っていません。
