# 証拠（seamless を Grok CLI、Grok Bot、ChatGPT Dot へ広げる）

## 2026-10-08 計画（team-plan、大きさ L）

- リーダー: この会話（Claude Fable 5.1、立花さんの選択のまま。route-shift は L のため Opus 5.5／high を示したが、Desktop では本人が選ぶ）。
- 手元で確認した事実（Grok CLI 1.0.46）: 会話は `~/.grok/sessions/<作業場所>/<会話 ID>/` に要約、更新の流れ、生の履歴の別ファイルで保存。稼働中の会話の名簿 `~/.grok/active_sessions.json`（今は空、ロックつき）。hooks（SessionStart、UserPromptSubmit、Stop、PreToolUse ほか）。ACP（`grok agent stdio`）。leader は既定で切（`grok leader list` は候補なし）。
- seamless 側で検証したハンドオフの主張: Grok Bot の Mac コマンドからの `sessions` が `caller_unobserved`（native_ancestor_missing）になるのは、呼び手の特定が Claude の祖先か Codex の metadata を求める設計のとおり（src/caller.ts）。
- 敵対 1 回目（Codex Astra、読み取り専用、spec 草案）: 重大 6、中 4、軽微 0。すべて spec の記載不足。反映した内容: 不変条件 2・5・6 を検証する AC（AC2 の別プロセス否定、AC6 の返信の対応と循環、AC7 の再送禁止）、鍵の結び付け方と 5 種の拒否（AC5）、Mac 内と外の分類の基準、認可の範囲と受信側の権限の維持（AC8）、配信確認を独立項目に（AC4）、段の言葉の定義と実証の単位（8 本）、読む・一覧の範囲（AC9）、外部公開と常駐の止まる条件。
- Grok Build CLI 4.7 への照会（動いている会話へ外から文を入れる口、名簿の項目、hooks の出力、記録の構造、pid と会話 ID の対応）: 回答あり（確信度: 口が無い high、名簿 medium、hooks high、記録 high、pid の対応 medium）。要点は spec.md の「確認済みの事実」に写した。全文は `.local/grok-consult/grok-cli-answer-2026-10-08.md`。
