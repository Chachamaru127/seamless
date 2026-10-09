# 実行記録

調査時HEAD af9df0e14106fb072ac3ba5d44be34146233f972。本記録の再検証はHEAD d784be843153737d6edd47aa9771dc79b5e10bb7 + 未commitのローカル差分。別作業のGrok hook修正がこの間にcommitされたが、今回の試作コードのhashは前後一致。こちらからcommitはしていない。checks.jsonに試験の実終了コード、実行コマンド、出力hash、試作コードhash、試験時HEADを記録。

- node .local/dot-events/probe.mjs: exit0。既存版2025-06-18、eventsとserver/discoverがunknown_method、既存5toolsを確認。実会話には接続しない。
- node --test experiments/dot-events/events.test.ts: exit0、17pass/0fail。出力prototype-tests.out。
- tsc --noEmit --strict --allowImportingTsExtensions --target es2022 --module nodenext --moduleResolution nodenext --types node experiments/dot-events/*.ts: exit0。
- bash scripts/verify.sh: exit0、型検査exit0、本体454pass/0fail、帯98pass/0fail。出力legacy-verify.out。初回af9df0e時点は453pass/0fail。
- git diff --check: exit0。

独立判定の再検査はrecheck.outとdrawing-recheck.outへ回収済み。Claude Opus 5.5 highは試作の条件1〜6をPASS。Claude Haiku 5.5 mediumは文書の前回F1〜F3をPASS、新規FAILなし。未commitの差分なのでroute-jobのtested_and_judged状態ではない。製品の内包完了や実Dotの往復を主張しない。

再検証はroute-job verify 20261008-232154-fc6mからpython3 .local/dot-events/run_checks.pyを実行した。実終了0。prototype-tests.out、prototype-typecheck.out、vector.out、probe.out、legacy-verify.outのそれぞれにcommand_exit=0を保存。vector.pyはPython標準ライブラリーの独立計算で、Nodeの実装を呼ばない。route-jobの実行記録も終了0とHEADの前後一致を保持する。

再判定後は文書の太字改行を修正し、Q5の改訂経緯を仕様本文から除いた。HTTP入口の有効化の承認対象と、判定の範囲を内包案へ明記した。コードは変更なし。git diff --checkは再実行exit0。
