# Codex gpt-6-astra（high、読み取り専用）の判定の原文

依頼の要旨は evidence.md の「MVP の部品と M2 の道具の判定」にある。最後の答えだけを写した。

**判定：FAIL。版 `f6b8204` のまま実機測定へ進めることは推奨しません。**

Yes は「確認条件を満たす」、No は「穴がある」を表します。

| 番号 | 判定 | 根拠 |
|---|---|---|
| 1. 送信先の限定 | **Yes** | URL は HTTPS、指定ホスト、443番に限定。リダイレクトも追いません。[notify.ts:74](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:74)、同167行。接続先 IP の検証については下記の留保があります。 |
| 2. 通知は最大1件 | **Yes** | `armed` により再購読や更新で再予約せず、送信前に `O_EXCL` で印を作ります。notify モードは共通の記録先を使うため、同時起動とプロセス再起動でも同じ印が効きます。印を保持する条件です。[notify.ts:209](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:209)、同221–228行、397–402行。[run-m1.sh:8](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m1/run-m1.sh:8)、同18行、49行。 |
| 3. 秘密などを出力しない | **No** | 未知の `method` も形が合えば生値を記録します。**有効な形式の人工secretを method に入れると、記録に残ることを再現しました。** 通常の `delivery.secret` が直接漏れるという指摘ではありません。[notify.ts:44](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:44)、同270–274行。 |
| 4. 署名と確認の形式 | **Yes** | 復号した鍵で `id.timestamp.body` に HMAC-SHA256 署名し、`v1,` を付けています。必要なヘッダ、確認JSON、新しいchallenge、2xxと定時間比較も実装されています。[notify.ts:58](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:58)、同149–156行、183–198行。 |
| 5. 落ちずに購読へ応答する | **No** | 確認応答を `response.text()` でサイズ制限なく読み込みます。巨大な2xx応答によるメモリ枯渇を防げず、10秒のタイムアウトだけでは防止できません。人工応答で **2 MiB超の本文を受理**することを確認しました。クラッシュ自体は起こしていません。[notify.ts:170](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:170)、同185行。 |

直すべき点は次の2点です。

- **notify.ts:44**：記録する method を既知の名前だけに限定し、それ以外は固定文字列にする。`notify.test.ts:750` 付近の漏洩試験に今回の再現条件を追加する。
- **notify.ts:170**：確認応答を読みながらバイト数を制限し、超過時は読み取りを中断して購読エラーを返す。`notify.test.ts:361` 付近に、大きな本文を拒否する試験を追加する。

**手順への適合には別の留保があります。** 提供されたOpenAI手順の174行は、接続時の公開IP検証と検証済みIPへの接続を要求しています。この版は省略しています（[README.md:110](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/README.md:110)）。ホスト名の固定だけで、この要件を満たしたとは判定できません。

指定試験は **32件中26件成功、6件は一時ディレクトリ作成の `EPERM` で失敗、終了コード1**。6件は環境制約による未検証です。外部通信とファイル変更は行っていません。

**確信度：high。** ただし実プロセスとファイルを使う6試験、およびDotでの受信は未検証です。
**判定：FAIL。版 `f6b8204` のまま実機測定へ進めることは推奨しません。**

Yes は「確認条件を満たす」、No は「穴がある」を表します。

| 番号 | 判定 | 根拠 |
|---|---|---|
| 1. 送信先の限定 | **Yes** | URL は HTTPS、指定ホスト、443番に限定。リダイレクトも追いません。[notify.ts:74](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:74)、同167行。接続先 IP の検証については下記の留保があります。 |
| 2. 通知は最大1件 | **Yes** | `armed` により再購読や更新で再予約せず、送信前に `O_EXCL` で印を作ります。notify モードは共通の記録先を使うため、同時起動とプロセス再起動でも同じ印が効きます。印を保持する条件です。[notify.ts:209](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:209)、同221–228行、397–402行。[run-m1.sh:8](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m1/run-m1.sh:8)、同18行、49行。 |
| 3. 秘密などを出力しない | **No** | 未知の `method` も形が合えば生値を記録します。**有効な形式の人工secretを method に入れると、記録に残ることを再現しました。** 通常の `delivery.secret` が直接漏れるという指摘ではありません。[notify.ts:44](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:44)、同270–274行。 |
| 4. 署名と確認の形式 | **Yes** | 復号した鍵で `id.timestamp.body` に HMAC-SHA256 署名し、`v1,` を付けています。必要なヘッダ、確認JSON、新しいchallenge、2xxと定時間比較も実装されています。[notify.ts:58](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:58)、同149–156行、183–198行。 |
| 5. 落ちずに購読へ応答する | **No** | 確認応答を `response.text()` でサイズ制限なく読み込みます。巨大な2xx応答によるメモリ枯渇を防げず、10秒のタイムアウトだけでは防止できません。人工応答で **2 MiB超の本文を受理**することを確認しました。クラッシュ自体は起こしていません。[notify.ts:170](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/notify.ts:170)、同185行。 |

直すべき点は次の2点です。

- **notify.ts:44**：記録する method を既知の名前だけに限定し、それ以外は固定文字列にする。`notify.test.ts:750` 付近の漏洩試験に今回の再現条件を追加する。
- **notify.ts:170**：確認応答を読みながらバイト数を制限し、超過時は読み取りを中断して購読エラーを返す。`notify.test.ts:361` 付近に、大きな本文を拒否する試験を追加する。

**手順への適合には別の留保があります。** 提供されたOpenAI手順の174行は、接続時の公開IP検証と検証済みIPへの接続を要求しています。この版は省略しています（[README.md:110](/Users/tachibanashuuta/LocalWork/Code/seamless/.claude/worktrees/seamless-claude-codex-c2a20e/experiments/dot-m2/README.md:110)）。ホスト名の固定だけで、この要件を満たしたとは判定できません。

指定試験は **32件中26件成功、6件は一時ディレクトリ作成の `EPERM` で失敗、終了コード1**。6件は環境制約による未検証です。外部通信とファイル変更は行っていません。

**確信度：high。** ただし実プロセスとファイルを使う6試験、およびDotでの受信は未検証です。
exit=0
