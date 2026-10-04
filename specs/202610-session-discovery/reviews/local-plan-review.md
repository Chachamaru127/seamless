# Codex内部の補助レビュー

判定: REQUEST_CHANGES。外部レビューの代替合格ではない。

1. 単発CLIの終了でメモリbindingが消える。対応: 同一プロセスでJSON Linesを受けるserveモードでselect / revalidateを提供。
2. caller、要求操作、scope、権限取消、caller移動の固定が不足。対応: bindingに双方のIDと世代、操作、scope、観測作業場所を保持し再照合。
3. 順位が未定義。対応: 同workspace＋worktree=1、同repoの別作業場所=2、別repo=3。scope内の最小順位が複数ならambiguous。
4. bootstrap申告とlive observationの境界が曖昧。対応: 申告値でonlineへ昇格せず、信頼した観測アダプターのみ採用。未接続はunknown。

上記は仕様と計画へ反映済み。補助レビューの再判定とClaudeによる独立判定は未実施。試験結果ではない。
