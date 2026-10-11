# Codex gpt-6-astra（high、読み取り専用）の判定の原文

依頼の要旨は evidence.md の「MVP の部品と M2 の道具の判定」にある。最後の答えだけを写した。


**判定：FAIL。確信度：high。**

1. **No。通常ケースは解消しましたが、2経路が残っています。**
   - **上書き失敗で verified になる。** [nonce-store.ts:59](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/nonce-store.ts:59) は `link`／`rename` の失敗を握りつぶし、`claimed` を返します。古いBot署名の `.req` が残った状態でMac署名の配送が進むと、`wasSigned()` が `true` になります。上書き失敗時は配送を止める必要があります。
   - **掃除が新しい記録を消す。** [nonce-store.ts:44](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/nonce-store.ts:44) で期限切れの `.req` を読む → Mac署名が同じ名前を新しい記録へ置換 → 掃除がその名前を削除、という順序が成立します。その後、同じIDのBot署名が `.req` を作ると、Macが届けた文が verified に上がります。置換と掃除の排他が必要です。

   対象コードのファイル操作をメモリ上の模擬操作に差し替え、両方を再現しました。確認コードは **exit 0**。実ファイルは変更していません。

2. **Yes。先送りの記載は今回の方針と整合しています。**  
   [Plans.md:22](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/Plans.md:22) に対象スクリプト、引数に出る値、現状、期日「配布の前」が明記されています。次行にはKeychainの読み手の範囲もあります。コードの穴が解消した判定ではありません。

3. **Yes。前回の3〜5を壊す追加変更は認めません。**  
   既存CLIの経路、設定スクリプトの登録保持、名簿と署名確認と予約と拒否の構造は維持されています。今回の表示上の不具合は番号1に計上しています。

リーダーの `verify.sh exit 0`（node 696件、帯99件）は採用しました。ただし、追加試験は上記の失敗処理と掃除の競合を検証していません。

**判定：FAIL。確信度：high。**

1. **No。通常ケースは解消しましたが、2経路が残っています。**
   - **上書き失敗で verified になる。** [nonce-store.ts:59](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/nonce-store.ts:59) は `link`／`rename` の失敗を握りつぶし、`claimed` を返します。古いBot署名の `.req` が残った状態でMac署名の配送が進むと、`wasSigned()` が `true` になります。上書き失敗時は配送を止める必要があります。
   - **掃除が新しい記録を消す。** [nonce-store.ts:44](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/src/nonce-store.ts:44) で期限切れの `.req` を読む → Mac署名が同じ名前を新しい記録へ置換 → 掃除がその名前を削除、という順序が成立します。その後、同じIDのBot署名が `.req` を作ると、Macが届けた文が verified に上がります。置換と掃除の排他が必要です。

   対象コードのファイル操作をメモリ上の模擬操作に差し替え、両方を再現しました。確認コードは **exit 0**。実ファイルは変更していません。

2. **Yes。先送りの記載は今回の方針と整合しています。**  
   [Plans.md:22](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/specs/202610-more-peers/Plans.md:22) に対象スクリプト、引数に出る値、現状、期日「配布の前」が明記されています。次行にはKeychainの読み手の範囲もあります。コードの穴が解消した判定ではありません。

3. **Yes。前回の3〜5を壊す追加変更は認めません。**  
   既存CLIの経路、設定スクリプトの登録保持、名簿と署名確認と予約と拒否の構造は維持されています。今回の表示上の不具合は番号1に計上しています。

リーダーの `verify.sh exit 0`（node 696件、帯99件）は採用しました。ただし、追加試験は上記の失敗処理と掃除の競合を検証していません。
