# Codex gpt-6-astra（high、読み取り専用）の合言葉の作りの再判定の原文（版 eddbfbc）

**判定: FAIL。項目 1、3 は Yes。項目 2、4 は No。**

1. **Yes。指紋の保存順序と配送経路**

   `prepare` で作った指紋を `pending` 予約へ書き、`sync()` の完了後に POST します。`unknown` への更新でも指紋を保持します。照合は `pending`／`unknown` を除外しないため、応答前の返信も照合できます。根拠: [delivery.ts:75–98](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:75)、[bot-executor.ts:55–62](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:55)。

   合言葉そのものはメモリから webhook 本文へ渡され、予約、結果、ログへ出す経路はありません。`prepare` の実装を設定するのは Bot 宛てだけです。同じ ID の別呼び出しではメモリ上の合言葉は再生成されますが、既存予約を検出して送信前に戻るため、保存済み指紋との食い違いは起きません。根拠: [webhook-send.ts:75–94、147](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/webhook-send.ts:75)、[delivery.ts:83](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/delivery.ts:83)。

2. **No。基本の使い捨ては成立するが、拒否前の消費と一時ファイルの残留がある**

   排他的な `link()` により、異なる返信 ID の同時実行は片方だけ通ります。同じ返信 ID は再び通ります。合言葉と起動元アプリの検査は印の作成前です。保存先の 0700、所有者、非シンボリックリンクも検査しています。根拠: [bot-executor.ts:41–44、68–79](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:41)。

   **ただし、不正な返信 ID が合言葉を消費します。** 例えば 257 文字の ID は文字列として受け入れられ、使用済みの印になります。その後の封筒検査で `envelope_invalid` に拒否されます。同じ ID は再び不正となり、短い ID に直すと `reply_token_used` になります。根拠: [bot-sign.ts:23–45](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:23)、[automatic.ts:111–116](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/automatic.ts:111)、[signed-envelope.ts:50](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/signed-envelope.ts:50)。

   一時ファイル作成後にプロセスが強制終了すると、`finally` の削除は動かず、書きかけの一時ファイルが残ります。回収処理もありません。**確定した印が半端になる問題は防げていますが、一時ファイルが残らない条件は満たしません。** 根拠: [bot-executor.ts:73–79](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:73)。

3. **Yes。前回 Yes だった項目 1〜4 の保護は維持**

   固定長の指紋比較、依頼先 Bot、返信先の会話と世代、24 時間の期限、起動元アプリの確認は残っています。`replyToken` は署名前に除外され、9 行の署名形式と既存の `send --as` 経路も維持されています。根拠: [bot-executor.ts:39–62、82–92](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:39)、[bot-sign.ts:39–45](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-sign.ts:39)、[automatic.ts:102–116](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/automatic.ts:102)。

4. **No。試験の隔離と記録に修正が必要**

   追加試験は POST 中の指紋、`unknown`、同じ ID の再試行、異なる ID の競合を確認しています。ただし、使用済みの印の試験用保存先が隔離されていません。予約先を `mkdtemp()` の直下にしているため、実装の `dirname(reservationDir)` により印は共通の `tmpdir()/reply-words-used` に作られます。後片付けの対象外で、固定 ID の印が次回試験に持ち越されます。根拠: [tests/bot-executor.test.ts:80、108–120](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/tests/bot-executor.test.ts:108)、[bot-executor.ts:68](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/bot-executor.ts:68)。

   [evidence.md:802](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/evidence.md:802) は、確定した印の原子性と一時ファイルの残留を分けて記録すべきです。[handoff/chachamaru-mvp.md:19–20](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/handoff/chachamaru-mvp.md:19) も「同じ ID を 2 度使わない」と「同じ ID で送り直してよい」が隣接しており、再試行の例外を明記する必要があります。

**直すべき点**

- 返信 ID の長さと文字の検査を、使用済みの印の作成前へ移す。
- 強制終了後の一時ファイルの扱いを定め、回収または残留を許容する条件を実装と記録に揃える。
- 試験用の親フォルダ内に `reservations/` を作り、使用済みの印も含めて隔離する。不正 ID、途中終了、連続実行の試験を追加する。
- 引継ぎ文の ID 再利用禁止に、同じ返信の再試行という例外を添える。

**確信度: high。** 静的確認に基づきます。`verify.sh` の exit 0（node 718 件、帯 99 件、peer-secrets ok）は提示された実測として扱い、再実行していません。ファイル変更、外部通信、禁止された実在の鍵や URL の読み取りは行っていません。
