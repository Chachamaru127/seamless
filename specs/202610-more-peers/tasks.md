# 作業単位（1 タスク = 1 ターン。Done when は Yes か No で判定できる 1 行）

Status: 起草（図面検査 1 回目と敵対 2 回目の指摘を反映。承認 2 回目待ち）
Updated: 2026-10-08 JST

着手禁止の規則: 「前提」に書いた作業の Done when が Yes になるまで、その作業に入らない。否認（「否」）も Done だが、否認なら後続は着手禁止のまま。

## P0 調査の残り

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| T0-1 | Grok の TUI を 1 つ起動し、`~/.grok/active_sessions.json` に行が増え、終了で消えることを見る。項目名と時刻の形を evidence.md に写す | なし | evidence.md に登録時と削除時の 2 回分の中身（項目名と値の形）がある |
| T0-2 | 試験用の作業場所の `.grok/hooks/` に command 型の Stop hook を置き（H0）、合言葉（例: `SEAMLESS-T02-OK`）を含む `additionalContext` を返す。hook が受け取る標準入力の JSON（会話 ID、作業場所、理由）と、hook から見た TUI の pid の取り方も evidence.md に写す。Grok に「文脈にある合言葉を答えて」と頼む | H0 | updates.jsonl に hook_execution の行があり、その後の発話に合言葉がそのまま含まれ、evidence.md に hook の入力の項目名、pid の取り方、hook_execution の行に依頼 ID が入るか否か、がある |
| T0-3a | `~/.grok/bin/grok` の署名を `codesign --verify` で確かめ、開発元の識別子を evidence.md に写す | なし | evidence.md に識別子の値がある（Yes）。確かめられなければ「確認不能」と書く（No） |
| T0-3b | T0-3a が No のときだけ: 代わりの確かめ方（実行ファイルの実体の道とハッシュ）を spec の Q2 に戻し、T1-7 を着手禁止にする | T0-3a が No | spec の Q2 に代わりの確かめ方と「T1-7 は保留」の 1 行がある |
| T0-4a | Grok Bot の webhook の事実（1 回の POST の上限、応答の形、順序、再送）を `.local/grok-consult/questions.md` に 4 問で書き、立花さんに「Grok に聞いて」と頼む | なし | questions.md に 4 問がある |
| T0-4b | 茶々丸の答えを evidence.md に写す。「未公開」の問いには、Plans.md の保守的な既定を採ると書く | T0-4a | evidence.md に 4 問それぞれの答えがあり、「未公開」の問いには採る既定が書いてある |
| T0-5 | MCP Events の一次仕様（2026-07-28 版）を読み、発見、購読、callback、署名の形を evidence.md に写す | なし | evidence.md に 4 項目それぞれの引用と出典の URL がある |
| T0-6 | 茶々丸が Mac で CLI を実行する経路（既存の Tailscale の経路か、新しい常駐処理や口が要るか）を questions.md で聞き、答えを evidence.md に写す | なし | evidence.md に「既存の経路」か「新しい口が要る（→ 止まる条件に当たるので P2 の受ける経路は着手禁止）」のどちらかがある |

## P1 Grok CLI

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| T1-1 | 製品の種類に `grok` を足す（型、名簿、席の記録、帯の集計） | なし | `bash scripts/verify.sh` が exit 0 |
| T1-2 | 動いている会話の観測（active_sessions.json の読み取り、pid の生存と開始時刻の照合、世代 `pid@開始時刻`、作業場所の範囲判定）と試験 `tests/grok-scan.test.ts` | T0-1 | その試験で、生きている行だけが製品名 `grok` と状態 `online` で一覧に出て、死んだ行と範囲外の行が出ない |
| T1-3 | 本文の読み取り（updates.jsonl の発話の連結と道具の呼び出し。思考と生の履歴は読まない）と試験 `tests/grok-read.test.ts` | なし | その試験で、見本の記録から可視の発話だけが順に出て、思考が出ない |
| T1-4 | 受信箱と hook のスクリプト `src/grok-hook.ts`（pending → delivering → delivered の原子的な移動、1 回に 1 封筒、壊れた封筒は failed、世代の不一致は配達しない、終了時の Stop は配達しない、死んだ hook の delivering は pending に戻す、受領記録を書く）と試験 `tests/grok-hook.test.ts` | T0-2 | その試験で: 正常 1 件 → delivered と受領記録; 壊れた 1 件の後の正常 1 件 → failed と delivered; 世代違い → pending のまま出力なし; 終了時の Stop → pending のまま出力なし; 同時起動の 2 本 → delivered は 1 件; 死んだ hook の delivering → pending に戻る。6 場面が全部この結果 |
| T1-5 | 送る経路（受信箱へ置く = 受理。同じ依頼 ID は置き直さない。8,000 字超は text_too_long）と試験 `tests/grok-send.test.ts` | T1-4 | その試験で: 受理 → pending に封筒 1 件と status submitted; 同じ ID → duplicate で封筒は 1 件のまま; 8,001 字 → text_too_long で封筒なし; 置いた後の切断 → status unknown で封筒は 1 件のまま。4 場面が全部この結果 |
| T1-6 | 段の観測（受領記録 + hook_execution = 配信確認、その後の発話 = 処理開始、replyTo の返信 = 返答完了）と循環の試験 `tests/grok-status.test.ts` | T1-5 | その試験で: 4 段の見本 → 4 段とも observed; 受領記録だけ → 配信確認 unobserved; hook_execution だけ → 配信確認 unobserved; 別プロセスが同じ会話を開いた見本 → 配信確認 unobserved; 返信の受信後 10 分（試験の時計）→ 依頼の件数が前後で同じ。5 場面が全部この結果 |
| T1-6b | 帯とパネルに「未配信」と、相手の記録に 5 分以上動きが無いときの「相手は 5 分以上動いていない。次の 1 手の後に届く」を出す（D5 の (b)） | T1-6 | 帯の試験で、配信確認が無い Grok の相手に「未配信」が出て、5 分以上動きが無い見本にだけ添え書きが出る |
| T1-7 | 呼び手の特定に Grok CLI の道を足す（祖先の grok の pid と名簿の行の一致、作業場所の一致、署名）と試験（caller-scan.test.ts に追加） | T0-3a が Yes | その試験で、偽の名簿と偽の祖先で通り、pid が合わない名乗りは `caller_unobserved` |
| T1-8 | Grok CLI 側の認可の拒否（範囲が未設定、設定が壊れている、範囲外の名指し）と、受信後に承認設定と sandbox が変わらない比較の試験（automatic.test.ts に追加） | T1-2 | その試験で 3 条件が拒否され、受信の前後で `~/.claude/settings.json` の permissions と crossSessionInbound、`~/.codex/config.toml` の approval と sandbox の節、の hash が一致する |
| T1-9 | H1 と H5 の差分と手順を立花さんに提示する（config.toml の hook の行、wire.sh の `--mcp-grok`） | T1-4、T1-5、T1-6、T1-7 | evidence.md に立花さんの「可」か「否」の記録がある（否なら T1-10 以降は着手禁止） |
| T1-10a | 実会話: Claude → Grok CLI を 1 回。送信前後の会話 ID と世代、時刻、段、製品の版を evidence.md に記録 | T1-9 が可 | 記録に、受理と配信確認と処理開始と返答完了の 4 段すべての時刻があり、世代が前後で一致し、製品の版が書いてある |
| T1-10b | 実会話: Codex → Grok CLI を 1 回（同上） | T1-9 が可 | T1-10a と同じ条件 |
| T1-10c | 実会話: Grok CLI の会話から Claude の会話へ依頼を送り、Claude が返信する | T1-9 が可 | 記録に、呼び手が Grok の会話（会話 ID と世代）として特定された送信と、Claude の返信が Grok の側で返答完了として観測された時刻と、製品の版がある |
| T1-10d | 実会話: Grok CLI の会話から Codex の会話へ依頼を送り、Codex が返信する | T1-9 が可 | T1-10c と同じ条件（相手は Codex） |
| T1-10e | Grok CLI の本文の読み取りを 1 回（AC9） | T1-9 が可 | 記録に読み取った発話の件数と時刻があり、思考の行が含まれていない |
| T1-10f | Grok CLI との返信の受信後 10 分の実観測（依頼の件数が増えない。AC6） | T1-10a | 記録の 10 分の前後で依頼の件数が同じ |
| T1-11 | 判定役（Codex Astra、読み取り専用）に P1 を判定させる | T1-10a〜f、TC-1、TC-3 | evidence.md に判定の結果（PASS か FAIL と指摘）がある |
| T1-12 | T1-11 の指摘を直し、再判定を頼む（PASS まで繰り返す。1 回を 1 ターン） | T1-11 | evidence.md に PASS がある |

## P2 Grok Bot

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| T2-1 | 名簿（`~/.seamless/peers.json`。環境変数の名前だけ、送信鍵と受信鍵は別、鍵の版、失効、操作、範囲）の読み取りと検証（mode 0600、所有者、形、失効、操作のたびに読み直し）と試験 `tests/peers.test.ts`。一覧で read 不可と出る | なし | その試験で、壊れた名簿、所有者違い、失効した登録が拒否され、一覧に read 不可が出る |
| T2-2 | 送る経路（webhook へ POST、送信鍵の署名ヘッダ、受理を HTTP の応答で記録、他の段は未確認、既存の予約で再送禁止、Q3 が未公開なら保守的な既定）と試験 `tests/webhook-send.test.ts` | T0-4b | その試験で: 2xx → 受理; 2xx 以外 → 不受理; 切断 → status unknown で POST は 1 回; 同じ ID → duplicate; 同じ内容の別 ID → duplicate; 署名ヘッダが送信鍵で検証できる。6 場面が全部この結果 |
| T2-3 | 受ける経路（`send --as <登録名>`、標準入力の署名済み封筒、HMAC の正規化した対象、時刻 ±5 分、nonce の原子的な記録、応答の切断後の再実行は duplicate）と AC5 の 5 種の拒否の試験 `tests/signed-inbound.test.ts` | T2-1、T0-6 が「既存の経路」 | その試験で: 鍵なし、別の登録の鍵、失効、再提示、宛先の差し替え、未来時刻（+6 分）、同時の 2 件のうち 2 件目、がそれぞれ拒否され、正しい封筒は受理され、受理後の応答の切断から同じ封筒を再実行すると duplicate で実行回数 1 |
| T2-4 | 認可の範囲（`--as` の経路で、名簿の範囲と既存の制限の交差。未設定、壊れた設定、範囲外の名指しの拒否。既定の「制限なしなら許す」に合流しない）と、受信後に承認設定と sandbox が変わらない比較の試験（automatic.test.ts に追加） | T2-3 | その試験で 3 条件が拒否され、制限の設定が無い状態でも外の登録が許されず、受信の前後で `~/.claude/settings.json` の permissions と crossSessionInbound、`~/.codex/config.toml` の approval と sandbox の節、の hash が一致する |
| T2-5 | 返信の対応と循環の試験（inbound.test.ts に追加） | T2-3 | その試験で、未知の replyTo が invalid_reply、重複が duplicate、replyTo なしが新しい依頼として受かるが自動の返信は 0 件、が期待どおり |
| T2-6 | 鍵の値が記録、名簿、リポジトリに無いことの確認（grep）を verify.sh に足す | T2-3 | verify.sh に鍵の値の grep が入り、exit 0 |
| T2-7 | H2〜H4 と H7 の手順と名簿の雛形を提示する（鍵の値は書かない） | T2-1、T2-2、T2-3 | evidence.md に立花さんの「可」か「否」の記録と、H2 の確認カードの承認の記録がある（否なら T2-8 以降は着手禁止） |
| T2-8a | 実送信: Claude → 茶々丸 を 1 回。時刻と段（受理と、未確認の 3 段）と製品の版を evidence.md に記録 | T2-7 が可、H7 が可 | 記録に受理の HTTP の状態と時刻、配信確認と処理開始と返答完了が「未確認」と書かれていること、製品の版、がある |
| T2-8b | 実送信: Codex → 茶々丸 を 1 回（同上） | 同上 | T2-8a と同じ条件 |
| T2-8c | 実送信: 茶々丸 → Claude を 1 回（署名済みの封筒を Mac の CLI で） | 同上 | 記録に、受理の時刻と、送り手が名簿の登録名として確かめられた記録（鍵の版と nonce の記録の有無）と、製品の版がある |
| T2-8d | 実送信: 茶々丸 → Codex を 1 回 | 同上 | T2-8c と同じ条件（相手は Codex） |
| T2-8e | 返信の受信後 10 分の実観測（依頼の件数が増えない） | T2-8c | 記録の 10 分の前後で依頼の件数が同じ |
| T2-9 | 判定役（Codex Astra、読み取り専用）に P2 を判定させる | T2-8a〜e、TC-1、TC-3 | evidence.md に判定の結果がある |
| T2-10 | T2-9 の指摘を直し、再判定を頼む（PASS まで。1 回を 1 ターン） | T2-9 | evidence.md に PASS がある |

## P3 Dot

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| T3-1 | T0-5 の結果から、spec に Dot の AC を追記する | T0-5 | spec の AC に「購読の保持」「署名つき配送」「Dot の宛先と呼び手の鍵」の 3 行がある |
| T3-2 | 敵対（Astra）に Dot の AC の穴探しをさせ、直す | T3-1 | evidence.md に指摘の件数と、反映した件数と、見送った件数とその理由がある |
| T3-3 | 立花さんに別途の承認を求める | T3-2 | 承認の記録が spec にある |
| T3-4 | （承認の後）MCP の仕様の版の引き上げ（2025-06-18 → 2026-07-28）を試し、Claude と Codex の接続が壊れないことを確かめる（AC10 の守り） | T3-3 が承認 | 版を上げた状態で `bash scripts/verify.sh` が exit 0、Claude⇄Codex の実往復 1 回の記録がある |

## 共通

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| TC-1 | 既存の Claude⇄Codex の実往復を各工程の判定の前に 1 回行い、壊れていないことを記録（AC10） | 各工程の実装の後 | evidence.md に工程ごとの往復の記録がある |
| TC-2 | GOD_Plans.md と Plans.md（ルート）の状態の行を、その工程の判定 PASS のコミットの短い SHA に直す | 各工程の PASS | 2 つのファイルの状態の行に、その工程の判定 PASS のコミットの SHA がある |
| TC-3 | 封筒の印の試験（Grok の受信箱、webhook、署名済みの受信の全経路で、humanApproval:true が書かれず、humanApproval:false は markUnapproved:true のときだけ付く）を既存の試験に足す | T1-5、T2-2、T2-3 | その試験で 3 経路 × 2 設定の 6 場面が全部期待の印 |
