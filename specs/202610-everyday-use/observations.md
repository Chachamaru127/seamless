# 計画前の観測記録

本文は記録しない。

## 2026-10-02 Claude 会話の再開で native session ID が変わった

| 項目 | 値 |
|---|---|
| 変更前 | session `ed10ef6f-8bf4-456d-b31e-081896518c1d`、pid 28305、世代 `28305@1790930941639` |
| 変更後 | session `7d4dff41-a7ad-41e6-bced-9c79b5bae73b`、pid 96242、世代 `96242@1790933756078` |
| 観測方法 | `~/.claude/sessions/*.json` の sessionId、pid、startedAt |
| 起きたこと | 製品 `serve --native` の send が `caller_unobserved` を返し、書込み前に止まった（2026-10-02 18:37 JST 前後） |
| 対処 | `.local/interop-pair.json` の claude-current を変更後の ID と世代へ手で更新。更新後の send は `submitted` |
| 記録の連続性 | 変更後の ID で製品 read を行い、変更前に受けた peer 記録（cldx-read-review-2 など）も取得できた |
| 未確認 | Desktop の画面上で同じ会話として続いていることの再取得（Codex 側の指摘） |
