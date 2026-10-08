図面検査: FAIL

読み取りだけで確認しました。試験は走らせていません。Write と ExitPlanMode が使えなかったため、報告はここに書きます。

## 1. Done when が evidence.md で Yes と判定できない作業

- **T1-11、T1-12**: 判定役の記録がありません。未実施なら未達と明記が要ります。
- **TC-1**: 「verify.sh の exit 0」が TC-1 節（evidence.md:186-199）にありません。直近の exit 0 は 23:05 以降の「454 件」（evidence.md:205）で、TC-1 より後です。
- **T1-9**: 「立花さんの『可』か『否』」の記録がありません。H6（evidence.md:153）と H1（evidence.md:155）の提示と、その後の実施から推定するだけです。確かめられません。
- **T1-10b**: 製品の版が「Codex Desktop」のみで、番号がありません（evidence.md:195）。
- **T1-10d**: 呼び手の特定（会話 ID、世代、source）の記録がありません（evidence.md:211-216）。T1-10c は evidence.md:179 にあります。
- **T1-10f**: 10 分の前後の件数の記録がありません。evidence.md:172 は 46 分後の「1 件」だけです。

## 2. Plans.md の記述とコードの違い

a. **Plans.md:42** は受領記録を `delivered/<依頼 ID>.json` とします。コードは `src/grok-hook.ts:69` で `delivered/${key}.json` です。key は送り手と依頼 ID の SHA-256（`src/grok-inbox.ts:25`）で、Plans.md:38 と同じ規則です。
b. **Plans.md:43** は処理開始を「受領記録の時刻より後」とします。`src/status.ts:29` は hook の Stop の時刻より後を要求し、`tests/grok-status.test.ts:46` も Stop 基準です。
c. **Plans.md:36** は「会話 ID と作業場所を hook の標準入力から取る」とします。`src/grok-hook.ts:46` は pid と sessionId の照合だけで、cwd を使いません。
d. **Plans.md:40** の受領記録の項目に hook の名前がありません。しかし配信確認（`src/status.ts:22`）は `receipt.hookName` を要求します。コードは hookName と hookPid も書きます（`src/grok-hook.ts:68`）。
e. **Plans.md:42** は hook_annotation を「hook_execution の直後」とします。`src/status.ts:27` は次の利用者の発話までの最初の封筒の注記を読みます（軽微）。
f. **窓の制限（Plans に無い）**: `src/status.ts:15` と `:63` の `slice(-200)` は Grok の構造にも効きます。受領記録の後に項目が 200 を超えると、配信確認が unobserved に戻ります。確信度は medium です（読みだけ、再現は未実施）。evidence.md:235 は同じ窓を Claude について認めますが、Grok には触れていません。
g. **Plans.md:47** の「宛先の会話は台帳から消えている」は、Plans.md:40 の 5 状態に無い orphaned を指します。コードは台帳照合の派生値です（`src/native-runtime.ts:181`）。
h. **Plans.md:48** の「hook 未登録、失敗、停止の区別」は、コードが「受理・未配信」の 1 語しか出しません（`src/status-exchanges.ts:27`）。Plans は「出せる範囲で」と書くので違反ではありません。

## 3. Done when の場面で試験が見つからないもの

- **T1-7 の「名乗りだけ → caller_unobserved」**: 探したのは `tests/caller-scan.test.ts` です。283 行の試験は、正しい Grok の祖先がいて名乗りが別の会話を指すとき、結果は `ok`（台帳の会話）になることを確かめます。名乗りだけで caller_unobserved を返す場面がありません。Done と食い違います。
- **T1-8**: Done は「9 場面」、`tests/automatic.test.ts:542` は「12 checks」です。場面は揃います（数え方の差）。hash の「名前順に並べた JSON」（`:540`）は、並べ替えの明示が見当たらず確かめられません。
- 他（T1-2、T1-3、T1-4、T1-5、T1-6 の 7 場面、T1-6b）は場面が揃っています。

## 4. spec.md の AC（P1 分）で evidence.md に証拠が無いもの

- **AC1**: 試験はあります（`tests/grok-scan.test.ts`）。evidence.md に判定記録がありません（evidence.md:77-81 は正式記録ではないと明記）。
- **AC2**: 別プロセスの否定の記録がありません（試験は `tests/grok-status.test.ts:29`）。
- **AC3**: Grok → Codex の呼び手特定の記録がありません（区分 1 と同じ）。
- **AC6**: Grok の 10 分の前後の件数の記録がありません（区分 1 と同じ。試験は `tests/grok-status.test.ts:87`）。
- **AC7**: 書込み後の切断の試験は `tests/grok-send.test.ts:30` にあります。evidence.md との対応がありません。
- **AC8**: 3 条件 × 3 操作の拒否と、受信前後の比較の記録がありません（試験は `tests/automatic.test.ts:542、570`）。
- **AC10**: 「既存の検証一式が exit 0」が TC-1 の時点にありません（区分 1 と同じ）。
- **AC9**: 充足（evidence.md:171）。

## 5. 書類どうしの食い違い

a. **Plans.md:104（H6）** は「main への取り込みと push」で、「各工程の判定 PASS の後」です。Plans.md:36 と tasks.md:36 は「push なし」で、取り込みは T1-10 の前提です。evidence.md:153 は push なしで、PASS より前に取り込んでいます。
b. **tasks.md:35（T1-9）** は「H5 を提示に含めるか」と書きます。Plans.md:103 と tasks.md:38 は H5 を不要としています。
c. **evidence.md:127** は受信箱の状態に `delivering` を含み、名前を「依頼 ID の SHA-256」とします。evidence.md:239-241、`src/grok-inbox.ts:15`（5 状態）、Plans.md:38 と食い違います。evidence.md:146 の訂正後も 127 行は残っています。
d. **Plans.md:42 と Plans.md:38** の名前の規則が違います（区分 2a と同じ）。
e. **Plans.md:43** と `tests/grok-status.test.ts:46` の名前（区分 2b と同じ）。
f. **Plans.md:38** の「同じ依頼 ID がどこかにあれば」は、同じ段落の送り手を含む予約規則と文が合いません（軽微）。

## 立花さんが判断すること

- 区分 3 の T1-7 は、コードを直すか Done を書き直すかを決めてください。
- 区分 2 の a、b、c は、コードと Plans のどちらを正とするかを決めてください。
- 区分 2f の窓の制限を今回直すか、別の作業にするかを決めてください。

## 次の一手

図面検査は読みだけです。修正は私の側ではしていません。判断が出たら、該当箇所を直して再検査できます。
