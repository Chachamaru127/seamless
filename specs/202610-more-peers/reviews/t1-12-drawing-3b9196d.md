図面検査: FAIL

読み取りのみで確認し、試験は実行していません（試験名と assert 行を読んだだけ）。ファイルは変更していません。前回の指摘は、区分 1 の T1-11/T1-12 判定、区分 2 の 2a〜2g、区分 3 の T1-7、区分 5 の H5・H6・127 行はすべて直っていました。区分 2 の窓の制限と区分 3 の T1-8 一覧の件は未解決です。

## 区分 1: Done when が evidence.md で Yes と言えないもの

- **T1-12**: 「evidence.md に PASS がある」（tasks.md:43）に対し、PASS の記録がありません。この検査の後に判定する作業で、未了です。
- **HEAD 3b9196d の verify exit 0**（464 件、帯 99）が evidence.md にありません。記録は commit message のみです。evidence.md:283 の最新は 20c41e3（462 件、帯 99）で、T1-12 の直しを含むコミットの exit 0 が無いことになります。
- **T1-10a〜f の実会話**は、現行より前の hook で取られています（evidence.md:259 が自ら認めています。取ったのは d784be8、f9b2dc4 の版）。20c41e3 で受信箱の状態が 5 つになり、unsafe_inbox の確認が入りました。Done の文言は記録どおり Yes ですが、現行の hook を通した 4 段の記録は無く、evidence.md:259 のとおり「取り込み後に Claude → Grok を 1 回やり直す」が必要です。

直った点: T1-9 の「可」（evidence.md:156）、T1-10b の版（:280）、T1-10d の呼び手（:281）、T1-10f の件数（:282）、TC-1 の verify（:283）、T1-11 の判定（:261-270）。

## 区分 2: Plans.md の記述とコードの違い

- **窓の制限（未解決）**: status.ts:15 と :63 は、Grok の構造も末尾 200 項目だけを読みます。Plans.md:42-43 はこの制限を書いていません。受領記録の後に項目が 200 を超えると、配信確認と処理開始が unobserved に戻ります（evidence.md:285 は認めています）。

直った点: 2a（Plans.md:42 は送り手と依頼 ID の組の SHA-256。grok-hook.ts:71、grok-inbox.ts:25）、2b（Plans.md:43 は Stop 基準。status.ts:29-30）、2c（Plans.md:39 は cwd を使わない。grok-hook.ts:45-46）、2d（Plans.md:42 に hookName と hookPid。grok-hook.ts:70）、2e（Plans.md:42。status.ts:26-27）、2g（Plans.md:47。native-runtime.ts:181、status-exchanges.ts:30 の文言一致）。

食い違いなし: 2h（Plans.md:48 は「出せる範囲で」）、終了時の Stop（Plans.md:41 と grok-hook.ts:42 は同じ結果）。

## 区分 3: Done when の場面で試験が無いもの、または確かめ方が違うもの

- **T1-8 の一覧（条件 1 と 3）**: Done は「一覧、読む、送るが拒否」（tasks.md:34）です。tests/automatic.test.ts:549 と :565 は status ok と候補 0 件を確かめるだけで、拒否の status は確かめていません。読む（:550, :566）と送る（:551, :567）は拒否を確かめています。試験名は「12 checks」（:542）で、Done の「9 場面」と数え方も違います。

直った点: T1-7 の名乗り（tests/caller-scan.test.ts:271-275 にあります。前回の指摘は読み違い。evidence.md:269 のとおり）。

場面が揃っているもの: T1-2（grok-scan 16、23、28、34）、T1-3（grok-read 17。fixture あり）、T1-4（grok-hook 19、29、34、39、44、49、82 の 7 場面）、T1-5（grok-send 22、26、30、38 の 4 件と、8,001 字の 38）、T1-6（grok-status 23、28、29、32、35、87 と、4 段の 23 の計 7 場面）、T1-6b（band exchanges 598〜651）、TC-3a（grok-send 43〜47）。

## 区分 4: spec.md の AC（P1 分）で evidence に証拠が無いもの

- **AC8 の一覧**: 区分 3 と同じです。「一覧の拒否」の証拠が試験にありません（automatic.test.ts:549, 565）。evidence.md:296 は拒否と書いています。
- AC1、AC2、AC3、AC6、AC7、AC9 は evidence.md:289-297 に対応があります。AC2、AC3 の実会話は区分 1 の 3 番目の版の問題を含みます。AC10 の HEAD 版の exit 0 は区分 1 の 2 番目のとおり無いです。

## 区分 5: 書類どうしの食い違い

- **5a（配信確認の条件の数）**: spec.md:36 は「受領記録と hook_execution の両方」と書きます。Plans.md:42 と status.ts:22-28 は hook_annotation（封筒の行）を 3 つ目に要求します。spec は「結び方は Plans.md」と書いていますが、列挙の時点で 2 条件です。
- **5b（処理開始の基準）**: spec.md:37 は「その依頼の後の相手の発話か道具の呼び出し」とします。Plans.md:43 と status.ts:29-30 は「配信確認に使った Stop の行より後」とします。
- **5c（ヘッダの PASS）**: Plans.md:3 と tasks.md:3 のヘッダに「図面検査 22 回目 PASS」があります。これは計画の検査の記録（approval-2-easy.html:81 も同じ）で、実装の判定 T1-11 は FAIL です（evidence.md:264）。軽微。

直った点: H5（tasks.md:35、Plans.md:103）、H6（Plans.md:104 と tasks.md:36 は push なしで一致）、evidence.md:127（注記で 5 状態と組の SHA を明記）、orphaned（Plans.md:47 と status-exchanges.ts:30）。

## 確信度と判断材料

- 文言と行の照合は high。試験の中身は名前と assert の読みだけなので medium です。
- 立花さんの判断が要る点: (1) 現行 hook での実会話をやり直すか（区分 1 の 3 番目）、(2) 窓の制限を今回直すか別作業にするか（区分 2）、(3) T1-8 の一覧は「拒否」の status を確かめるように試験を直すか、Done を「候補 0 件」に書き換えるか（区分 3）。
- 次の一手: 区分 1 の 2 番目（HEAD の verify 結果を evidence に書く）と区分 5 の書類の修正は、判断なしに進められます。
