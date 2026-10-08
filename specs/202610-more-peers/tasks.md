# 作業単位（1 タスク = 1 ターン。Done when は Yes か No で判定できる 1 行）

Status: 起草（図面検査 1 回目と敵対 2 回目の指摘を反映。承認 2 回目待ち）
Updated: 2026-10-08 JST

着手禁止の規則: 「前提」に書いた作業の Done when が Yes になるまで、その作業に入らない。否認（「否」）も Done だが、否認なら後続は着手禁止のまま。

## P0 調査の残り

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| T0-1 | Grok の TUI を 1 つ起動し、`~/.grok/active_sessions.json` に行が増え、終了で消えることを見る。項目名と時刻の形を evidence.md に写す | なし | evidence.md に登録時と削除時の 2 回分の中身があり、項目ごとの値の形（会話 ID は UUID か、pid は整数か、作業場所は絶対パスか、開始時刻の書式）が書いてある |
| T0-2 | 試験用の作業場所の `.grok/hooks/` に command 型の Stop hook を置き、合言葉（例: `SEAMLESS-T02-OK`）を含む `additionalContext` を返す。hook が受け取る標準入力の JSON（会話 ID、作業場所、理由）と、hook から見た TUI の pid の取り方と、updates.jsonl の hook_execution の行の項目（時刻、hook の識別、状態、依頼 ID が入るか）も evidence.md に写す。Grok に「文脈にある合言葉を答えて」と頼む | T0-1、H0 が可（evidence.md に記録） | updates.jsonl に hook_execution の行があり、その後の発話に合言葉がそのまま含まれ、evidence.md に hook の入力の項目名（会話 ID、作業場所、Stop の理由が入っているか否か）、pid の取り方（取った pid が台帳の行の pid と一致したこと）、hook_execution の行に依頼 ID が入るか否かの確認結果（入る／入らない）、がある |
| T0-3a | `~/.grok/bin/grok` の署名を `codesign --verify` で確かめ、開発元の識別子を evidence.md に写す | なし | evidence.md に識別子の値がある（Yes）。確かめられなければ「確認不能」と書く（No） |
| T0-3b | T0-3a が No のときだけ: 代わりの確かめ方（実行ファイルの実体の道とハッシュの固定）を spec の Open question Q2 に書き（Open questions の更新は承認済みの本文の変更に当たらない。AC や不変条件は変えない）、立花さんに可否を聞く（H8）。可なら T1-7 はその確かめ方で進め、否なら T1-7 と T1-10c、T1-10d は着手禁止のまま（AC3 は未達として evidence.md に書く） | T0-3a が No | spec の Q2 に代わりの確かめ方と、立花さんの「可」か「否」の記録がある |
| T0-4a | Grok Bot の webhook の事実（1 回の POST の上限、応答の形、順序、再送）を `.local/grok-consult/questions.md` に 4 問で書き、立花さんに「茶々丸に聞いて」と頼む（ハンドオフの手順。答え手は茶々丸） | なし | questions.md に webhook の 4 問がある（T0-6 の 5 問目が同じファイルにあってもよい） |
| T0-4b | 茶々丸の答えを evidence.md に写す。「未公開」の問いには、Plans.md の保守的な既定を採ると書く | T0-4a | evidence.md に 4 問それぞれ、答え（数値か、Plans.md の既定との比較を 1 行で書いたもの）か「未公開」（「分からない」も未公開として扱う）があり、4 問とも「採る値」（答えから採ったか、既定か）が 1 行で書いてある |
| T0-5 | MCP Events の一次仕様（2026-07-28 版）を読み、4 項目（イベントの発見の方法、購読の方法と保持、callback の呼び方、署名の方式）を evidence.md に写す | なし | evidence.md に 4 項目（発見、購読、callback、署名）それぞれの引用と出典の URL がある |
| T0-6 | 茶々丸が Mac で CLI を実行する経路（既存の Tailscale の経路か、新しい常駐処理や口が要るか）を T0-4a と同じ `.local/grok-consult/questions.md` に 5 問目として書いて聞き、答えを evidence.md に写す | なし | evidence.md に「既存の経路」か「新しい口が要る」のどちらかがある（「分からない」と未回答は「新しい口が要る」として扱い、そう書く） |
| T0-6b | T0-6 が「新しい口が要る」のときだけ: 止まる条件に当たるので止まり、立花さんに H9 の判断を聞く。「範囲から外す」なら T2-3、T2-4、T2-5、T2-8c〜f は未達として evidence.md に書き、T2-9 は送る経路（T2-1、T2-2、T2-6、T2-8a、T2-8b）だけを判定する | T0-6 が「新しい口が要る」 | evidence.md に立花さんの H9 の判断と、未達にした作業の一覧がある |

## P1 Grok CLI

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| T1-1 | 製品の種類に `grok` を足す（型、名簿、席の記録、帯の集計） | なし | `bash scripts/verify.sh` が exit 0 |
| T1-2 | 動いている会話の観測（active_sessions.json の読み取り、pid の生存と開始時刻の照合、世代 `pid@開始時刻`、作業場所の範囲判定）と試験 `tests/grok-scan.test.ts` | T0-1 | その試験で、生きている行が製品 `grok`、ホスト `local`、状態 `online`（帯では「動いている」）で一覧に出て、pid が死んだ行と台帳に無い TUI の会話は既定で出ず offlineHidden に数えられ includeOffline では `offline`（帯では「止まっている」）で出て、headless の会話と範囲外の行はどちらでも出ない |
| T1-3 | 本文の読み取り（updates.jsonl の発話の連結と道具の呼び出し。思考と生の履歴は読まない）と見本 `tests/fixtures/grok-updates.jsonl` と試験 `tests/grok-read.test.ts` | なし | その試験で、見本から可視の発話（利用者 1 件、相手 2 件、道具の呼び出し 1 件）だけがこの順に出て、思考の行が出ない |
| T1-4 | 受信箱と hook のスクリプト `src/grok-hook.ts`（pending → delivering → delivered の原子的な移動、1 回に 1 封筒、壊れた封筒は failed、世代の不一致は配達しない、終了時の Stop は配達しない、返す前に死んだ hook の delivering は pending に戻す、返した後に死んだ handed は unknown に移して戻さない、受領記録（依頼 ID、会話 ID、世代、時刻、Stop の理由）を書く）と試験 `tests/grok-hook.test.ts` | T0-2 | その試験で: 正常 1 件 → delivered と受領記録; 壊れた 1 件の後の正常 1 件 → failed と delivered; 世代違い → pending のまま出力なし; 終了時の Stop → pending のまま出力なし; 同時起動の 2 本 → delivered は 1 件; 返す前に死んだ hook の delivering → pending に戻る; 返した後に死んだ handed → unknown に移り pending に戻らない。7 場面が全部この結果 |
| T1-5 | 送る経路（受信箱へ置く = 受理。同じ依頼 ID と同じ内容の別 ID は置き直さない。8,000 字超は text_too_long）と試験 `tests/grok-send.test.ts` | T1-4 | その試験で: 受理 → pending に封筒 1 件と status submitted; 同じ ID → duplicate で封筒は 1 件のまま; 同じ内容の別 ID → duplicate で封筒は 1 件のまま; 8,001 字 → text_too_long で封筒なし; 置いた後の切断 → status unknown で封筒は 1 件のまま。5 場面が全部この結果 |
| T1-6 | 段の観測（受領記録 + hook_execution = 配信確認、その後の発話 = 処理開始、replyTo の返信 = 返答完了）と循環の試験 `tests/grok-status.test.ts` | T1-5 | その試験で: 4 段の見本 → 4 段とも observed; 受領記録だけ → 配信確認 unobserved; hook_execution だけ → 配信確認 unobserved; 別プロセスが同じ会話を開いた見本 → 配信確認 unobserved; 受領記録の後に利用者の発話を挟んで別の Stop の hook_execution だけがある見本 → 配信確認 unobserved（無関係な Stop を結ばない）; 返信の受信後 10 分（試験の時計）→ 依頼の件数が前後で同じ。6 場面が全部この結果（T0-2 で hook_execution に依頼 ID か hook の識別が入ると分かったときは、識別の不一致の見本 → 配信確認 unobserved を 7 場面目として足し、7 場面が全部この結果） |
| T1-6b | 帯（入力欄の上の 1 行）とパネル「チーム」（帯の ×n で開く一覧）に「未配信」、相手の記録に 5 分以上動きが無いときの「相手は 5 分以上動いていない。次の 1 手の後に届く」、unknown の封筒の「成否不明。立花さんの確認が要る」を出す（D5 の (b)） | T1-6 | 帯の試験 `mods/seamless-band/tests/exchanges.test.tsx` で、配信確認が無い Grok の相手に「受理・未配信」が出て、5 分以上動きが無い見本にだけ添え書きが出て、unknown の封筒がある見本に「成否不明」が出る |
| T1-7 | 呼び手の特定に Grok CLI の道を足す（祖先の grok の pid と台帳の行の一致、作業場所の一致、署名または H8 で可とした代わりの確かめ方）と試験（caller-scan.test.ts に追加） | T0-3a が Yes、または T0-3b で「可」 | その試験で、見本の台帳の行と pid と作業場所が一致し署名の確認（H8 の代わりの確かめ方なら、実体の道とハッシュの一致）が通る祖先では呼び手がその会話（製品 grok、会話 ID、世代）として特定され、pid の不一致、作業場所の不一致、署名の確認の失敗（代わりの確かめ方ならハッシュの不一致）、名乗りだけ（環境変数や引数の会話 ID）、の 4 つはそれぞれ `caller_unobserved` になる |
| T1-8 | Grok CLI 側の認可の拒否（台帳の行の作業場所が無いか読めない、制限の設定が壊れている、範囲外の名指し）と、受信後に承認設定と sandbox が変わらない比較の試験（automatic.test.ts に追加） | T1-2 | その試験で、3 条件それぞれで一覧、読む、送るの 3 操作が拒否され（9 場面）、受信の前後で `~/.claude/settings.json` の permissions と crossSessionInbound、`~/.codex/config.toml` の approval と sandbox の節、`~/.grok/config.toml` を TOML として読んで hooks の表を除き、表と鍵を名前順に並べて JSON にした文字列、の hash が一致する |
| T1-9 | H1 と H5 の差分と手順を立花さんに提示する（config.toml の hook の行、wire.sh の `--mcp-grok`。H8 が否なら H5 は提示から外す） | T1-4、T1-5、T1-6、T1-8、T0-3a（T0-3a が No なら T0-3b の H8 の判断の記録も。H5 を提示に含めるかは H8 で決まる。T1-7 は含めない。H8 が否でも AC2 と AC9 の実会話に進めるため） | evidence.md に立花さんの「可」か「否」の記録がある（否なら T1-10 以降は着手禁止） |
| T1-10a | 実会話: Claude → Grok CLI を 1 回。送信前後の会話 ID と世代、時刻、段、製品の版を evidence.md に記録 | T1-9 が可、H1 の適用完了（evidence.md に記録） | 記録に、受理と配信確認と処理開始と返答完了の 4 段すべての時刻があり、世代が前後で一致し、製品の版が書いてある |
| T1-10b | 実会話: Codex → Grok CLI を 1 回（同上） | T1-9 が可、H1 の適用完了 | T1-10a と同じ条件 |
| T1-10c | 実会話: Grok CLI の会話から Claude の会話へ依頼を送り、Claude が返信する | T1-9 が可、H5 の適用完了（evidence.md に記録）、T1-7 が済み | 記録に、呼び手が Grok の会話（会話 ID と世代）として特定された送信と、Claude の返信が Grok の側で返答完了として観測された時刻と、製品の版がある |
| T1-10d | 実会話: Grok CLI の会話から Codex の会話へ依頼を送り、Codex が返信する | T1-9 が可、H5 の適用完了、T1-7 が済み | T1-10c と同じ条件（相手は Codex） |
| T1-10e | Grok CLI の本文の読み取りを 1 回（AC9） | T1-9 が可 | 記録に読み取った発話の件数と時刻があり、思考の行が含まれていない |
| T1-10f | Grok CLI との返信の受信後 10 分の実観測（依頼の件数が増えない。AC6） | T1-10a | 記録の 10 分の前後で依頼の件数が同じ |
| T1-11 | 作った側と逆の家系の判定役（リーダーが作れば Codex Astra。読み取り専用）に P1 を判定させる。H8 が否で T1-10c と T1-10d が未達なら、AC3 を未達として evidence.md に書いたうえで判定を頼む | T1-1、T1-2、T1-3、T1-6b、T1-10a、T1-10b、T1-10e、T1-10f、TC-1、TC-3a（T1-10c と T1-10d は H8 が可のときだけ） | evidence.md に判定の結果（PASS か FAIL と指摘）がある |
| T1-12 | T1-11 の指摘を直し、再判定を頼む（PASS まで繰り返す。1 回を 1 ターン） | T1-11 | evidence.md に PASS がある |

## P2 Grok Bot

| # | 作業 | 前提 | Done when |
|---|---|---|---|
| T2-1 | 名簿（`~/.seamless/peers.json`。環境変数の名前だけ、送信鍵と受信鍵は別、鍵の版、失効、操作、範囲）の読み取りと検証（mode 0600、所有者、形、失効、操作のたびに読み直し）と試験 `tests/peers.test.ts`。一覧で read 不可と出る | なし | その試験で、壊れた名簿、所有者違い、失効した登録が拒否され、一覧に read 不可が出る |
| T2-2 | 送る経路（webhook へ POST、送信鍵の署名ヘッダ、受理を HTTP の応答で記録、他の段は未確認、既存の予約で再送禁止、Q3 が未公開なら保守的な既定）と試験 `tests/webhook-send.test.ts` | T2-1、T0-4b | その試験で: 2xx → 受理; 2xx 以外 → 不受理; 切断 → status unknown で POST は 1 回; 同じ ID → duplicate; 同じ内容の別 ID → duplicate; 署名ヘッダが送信鍵で検証できる; 2 件を送って応答が逆順に返っても、2 件それぞれの status（受理、不受理、unknown のどれか）と POST の回数（各 1 回）が、順に返ったときと同じ（順序と再送に依存しない）; 本文 8,001 字 → text_too_long で POST なし（上限に依存しない）。8 場面が全部この結果 |
| T2-3 | 受ける経路（`send --as <登録名>`、標準入力の署名済み封筒、HMAC の正規化した対象、時刻 ±5 分、nonce の原子的な記録、応答の切断後の再実行は duplicate）と AC5 の 5 種の拒否の試験 `tests/signed-inbound.test.ts` | T2-1、T0-6 が「既存の経路」 | その試験で: 鍵なし、別の登録の鍵、失効、再提示、宛先の差し替え、未登録の登録名、送信鍵で署名した封筒（鍵の取り違え）、未来時刻（+6 分）、同時の 2 件のうち 2 件目、がそれぞれ拒否され、正しい封筒は受理され、受理後の応答の切断から同じ封筒を再実行すると duplicate で実行回数 1、同じ内容の別 ID の封筒も duplicate |
| T2-4 | 認可の範囲（`--as` の経路で、名簿の範囲と既存の制限の交差。未設定、壊れた設定、範囲外の名指しの拒否。既定の「制限なしなら許す」に合流しない）と、受信後に承認設定と sandbox が変わらない比較の試験（automatic.test.ts に追加） | T2-3 | その試験で、3 条件それぞれで一覧、読む、送るの 3 操作が拒否され（9 場面）、制限の設定が無い状態でも外の登録が許されず、受信の前後で `~/.claude/settings.json` の permissions と crossSessionInbound、`~/.codex/config.toml` の approval と sandbox の節、の hash が一致する |
| T2-5 | 返信の対応と循環の試験（inbound.test.ts に追加。AC6 の Bot 側の自動試験） | T2-3 | その試験で: 未知の replyTo → invalid_reply; 同じ ID の再送 → duplicate; replyTo なし → 新しい依頼として受理され、その後に seamless が自動で送った返信は 0 件; 返信の受信後 10 分（試験の時計）→ 依頼の件数が前後で同じ。4 場面が全部この結果 |
| T2-6 | 鍵の値が記録、名簿、リポジトリ、会話の記録に無いことの確認を verify.sh に足す（名簿に書いた環境変数の名前ごとに、値を環境から読んで、空なら失敗にし、空でなければ `printf '%s' "$値" | grep -rqF -f - ~/.seamless "$(git rev-parse --show-toplevel)" ~/.claude/projects ~/.codex/sessions ~/.grok/sessions` のように標準入力で渡して、見つかれば失敗にする（AC5 の「会話」= 3 製品の会話の保存先）。値を引数、出力、ファイルのどこにも出さない） | T2-1（受ける経路に依存しないので、H9 で受ける経路を外しても行う） | verify.sh にその確認が入り、exit 0 |
| T2-7 | H2〜H4 と H7 の手順と名簿の雛形を提示する（鍵の値は書かない。H9 で受ける経路を外したときは受信鍵の項を外す） | T2-1、T2-2（T2-3 は H9 で外していないときだけ） | evidence.md に、立花さんの「可」か「否」、H2 の確認カードの承認、H3 の完了（環境変数の名前 3 つが設定されていることを、値を出さない判定 `[ -n "${名前:-}" ] && echo set` で確認。値は表示も記録もしない）、H4 の完了（名簿に登録名がある）の記録がある（否なら T2-8 以降は着手禁止） |
| T2-8a | 実送信: Claude → 茶々丸 を 1 回。時刻と段（受理と、未確認の 3 段）と製品の版を evidence.md に記録 | T2-7 が可、H7 が可 | 記録に受理の HTTP の状態と時刻、配信確認と処理開始と返答完了が「未確認」と書かれていること、製品の版、がある |
| T2-8b | 実送信: Codex → 茶々丸 を 1 回（同上） | 同上 | T2-8a と同じ条件 |
| T2-8c | 実送信: 茶々丸 → Claude を 1 回（署名済みの封筒を Mac の CLI で） | T2-7 が可、T2-3、T0-6 が「既存の経路」（H7 は Mac → Bot の外部送信にだけかかるので含めない） | 記録に、受理の時刻と、送り手が名簿の登録名として確かめられたこと（検証に使った鍵の版と、nonce が記録されたこと）と、製品の版がある |
| T2-8d | 実送信: 茶々丸 → Codex を 1 回 | 同上 | T2-8c と同じ条件（相手は Codex） |
| T2-8e | 返信の受信後 10 分の実観測（依頼の件数が増えない） | T2-8c | 記録の 10 分の前後で依頼の件数が同じ |
| T2-8f | T2-8a と T2-8b の依頼に茶々丸が返信した後、それぞれの依頼の返答完了だけが埋まり、配信確認と処理開始は「未確認」のまま、を記録（AC4。茶々丸の返信は受ける経路で Mac に届くので、H9 で受ける経路を外したときはこの作業も未達になる） | T2-8a、T2-8b、T2-8c（返信が届く経路の実測） | 2 件の記録それぞれに、返答完了の時刻があり、配信確認と処理開始は「未確認」と記録されている |
| T2-9 | 作った側と逆の家系の判定役（リーダーが作れば Codex Astra。読み取り専用）に P2 を判定させる。H9 で受ける経路を外したときは、外した作業を未達として evidence.md に書いたうえで判定を頼む | T2-1〜T2-6、T2-8a〜f、TC-1、TC-3b（H9 で外した作業は除く） | evidence.md に判定の結果（PASS か FAIL と指摘）がある |
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
| TC-1 | 各工程の判定の前に、`bash scripts/verify.sh` を走らせ、既存の Claude⇄Codex の実往復を 1 回行い、壊れていないことを記録（AC10） | P1 なら T1-10a、b、e、f の後（T1-10c、d は H8 が可のときだけ）。P2 なら T2-8a、b の後（T2-8c〜f は H9 で受ける経路を外していないときだけ） | evidence.md に、その工程の verify.sh の exit 0 と、往復の 4 段の時刻がある |
| TC-4 | Claude⇄Codex の相手でも、返信の受信後 10 分で依頼が増えないことを、自動試験（inbound.test.ts に Claude⇄Codex の返信の見本を足し、試験の時計で 10 分後に依頼の件数が同じ）と 1 回の実測で確かめる（AC6 の「相手ごと」の自動試験と実測） | TC-1 | その試験が通り、記録の 10 分の前後で依頼の件数が同じ |
| TC-2 | リポジトリのルートにある GOD_Plans.md（製品全体の台帳）の「Grok CLI、Grok Bot、ChatGPT Dot へ広げる」の行の状態の列と、Plans.md（ルート）のこの計画の節の「最終更新」の行（節が無ければ足す）を、その工程で判定役が読んだ版のコミットの短い SHA（evidence.md の判定の記録に書く SHA と同じもの）に直し、直した分を記録のコミットとして足す | 各工程の PASS | 2 つのファイルの状態の行の SHA が、evidence.md のその工程の判定の記録の SHA と同じである |
| TC-3a | 封筒の印の試験（Grok の受信箱へ置く封筒）を既存の試験に足す | T1-5 | その試験で、markUnapproved が無い設定では humanApproval が無く、markUnapproved:true では humanApproval:false が付き、どちらでも humanApproval:true が無い |
| TC-3b | 封筒の印の試験（webhook へ送る封筒と、署名済みの受信の封筒）を既存の試験に足す | T2-2、T2-3 | その試験で、2 経路とも、markUnapproved が無い設定では humanApproval が無く、markUnapproved:true では humanApproval:false が付き、どちらでも humanApproval:true が無い |
