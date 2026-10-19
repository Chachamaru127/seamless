判定: **図面検査 FAIL**（食い違い 37 件。AC の検証対応の抜け、判定不能な記述、本人指示との衝突、不変条件の書き換えを含む）

**AC**
1. AC1: 検証は `npx . setup --dry-run`、AC1 は `npx @chachamaru/seamless setup`。dry-run は設定を変えないので「変更ファイル数」が取れない。→ Plans 8 を AC1 の形に合わせる。
2. AC2: 3 状態を判定する task も `who --json` の task も無い。→ T06 に `who --json` と製品ごとの判定基準を足す。
3. AC3: 実相手での依頼 ID と返信 ID の一致、操作 3 以下が Done when に無い。T05 は偽 send のみ。→ 実往復を人の作業へ入れる。
4. AC4: Plans 3 が保留理由 `claude_hold` の観測元（crossSessionInbound、bypass）を定義していない。→ Claude 行に読む設定名を書く。
5. AC6: 「不明」段階、二重送信防止、予約ストアの task が無い。tests/delivery-unknown.test.ts も無い。→ task を新設する。
6. AC7: 15 往復の実機記録が task に無い。T15 は batch --n 2 のみ。→ 件数 15 を Done when に入れる。
7. AC8: T15 の Done when に footprint が無い。→ ps、~/.seamless、lsof の判定条件を書く。
8. AC9: Plans 8 は `git diff --stat main --`、T07 などは作業ツリー基準。→ Plans 8 の基準に統一。
9. AC10: T07 は偽 API のみ。依頼 ID と返信 ID の一致が無い。→ 実 opencode の往復を人の作業へ。
10. AC11: versionStatus の task が無い。→ T01 に追加。
11. AC12: Plans 8 の `git grep` が T13 に無い。「内部 API の再現が無い」の基準も無い。→ T13 に両方を書く。
12. AC13: 5 指標が T16 に無い。Plans 8 の `measure.ts compare` は T15 に無い。→ T15 に compare、T16 に 5 指標を列挙。
13. AC14: src/mcp.ts の 4 道具を判定する task が無い。T17 の「evidence.md に記録」は判定でない。→ 「MCP send の依頼 ID と返信 ID が一致」に書き換える。
14. AC15: T17「5 段階を描く」は判定不能。→ 「表示の段階が status --json と一致」にする。
15. AC16: 確認パスが食い違う。spec と research A2 は `/tmp/cc-socks-<uid>`、evidence は `/tmp/cc-socks/<pid>.sock`。→ 実測の形に一本化。
16. 全 AC: Plans 5 の週表に AC2、AC6、AC11 が無い。AC14 は人の作業なのに週 5〜6 の完了に入っている。→ 週表を直す。

**停止条件**
17. S1: 「週 1 の検証」の実行主体と時期が無い。→ 週次 task を置く。
18. S2: AC6、AC7 に対応する停止条件が無い。AC7 は核心。→ S2 に加える。
19. S4: 対応する AC も task も無い。→ AC2 か AC11 の Desktop 行に結び付ける。
20. S7: 「公開予定日」が未定義。→ H5 の日付に置き換える。

**Human gates**
21. H1: Grok CLI と Grok Bot は 2026-10-19 の本人指示（opencode、Cursor CLI、Antigravity CLI）に無い。「決定済み」の根拠が無い。→ 出典日を書くか未決に戻す。
22. H1 と S5: S5 は evidence の観測（PATH に実行ファイル無し）で既に発動条件を満たす。v1 に入れる本人指示と衝突。→ 本人に扱いを確認する。
23. H7: Plans 6 は verify 終了 0 で commit と Issue クローズ。自動自走規程は CI/CD 整備を条件にし、team-review の判定を要求。→ 停止条件と team-review を足す。
24. H5: AC1 と Plans 8 が `@chachamaru/seamless` を前提にしている。→ 「H5 決定後」と注記。

**Open decisions（Plans 7）**
25. Open 1〜3 は既定値として固定済み（T04 は 20 秒、T03 は 4,000 字、Plans 6 は Issue ごとのブランチ）。「AI が決めない」と矛盾。→ 「案」表記に戻す。spec の未決 1〜3 との番号衝突も解く。

**不変条件（ルート spec.md）**
26. 不変条件 8: ルートは外の実行主体を「名簿と鍵で確かめる」と定める。spec は「自前の鍵 0」。対象 ChatGPT Dot は v1 外とも phase 2とも書かれていない。→ Bot の署名検証の鍵と Dot の扱いを書く。
27. 不変条件 4: 「受理」が段階に無い（預かりが未書込みと書込み後を兼ねる）。→ 分ける。
28. 不変条件 3: humanApproval と markUnapproved の扱いが spec、Plans、tasks のどこにも無い。→ T05 か T11 に入れる。
29. 不変条件 1: 相手の特定要素からホストが落ちている。→ 同一 Mac 限定を注記。

**その他**
30. Plans 4 の「受信 socket を持つのは Claude Desktop の対話セッションだけ」の「だけ」は、evidence（Desktop 11 件、T3 プロセス 2 件）を超える。→ 「観測した範囲では」に直す。
31. T04 が保留中を段階に加えている。spec では状態。→ 直す。
32. spec.md に手段が混ざる（npx 名、ps、lsof、git diff、npm pack、html_render、/tmp パス、launchd）。→ Plans 8 へ移す。
33. Done when の曖昧語: T12「act か手動」、T14「別の頭で読んで」、T16「元に戻った確認」。→ 判定者と形式を書く。
34. Plans 2 の adapters に grok-cli.ts、grok-bot.ts とあるが実在は grok.ts。T06 の setup.ts、doctor.ts も実在しない。→ 表に新規か改修かを書く。
35. Nestra spec O5、AC24 は未読。判定不能。
36. evidence.md の判定が（未）のまま。drafts/review-haiku-v3.md と review-astra-v3.md は既に存在する。本検査は独立性のため読んでいない。→ 本判定の後に記録する。
37. 保留理由の英語 ID（submitted、reached、held）が spec の日本語段階と対応づけられていない。→ 対応表を 1 行足す。

**確かめること**
1. No。対応 task が無い AC は AC2、AC6、AC11。部分的にしか無い AC は AC3、AC7、AC8、AC10、AC13、AC14。
2. No。「描く」（T17）、「別の頭で読んで」（T14）、「act か手動」（T12）、「元に戻った確認」（T16）。
3. No。S1 は実行主体が無い。AC6、AC7 に停止条件が無い。S4 は AC に結び付かない。S5 は既に発動条件を満たす。
4. No。H1 の Grok 2 件と H7 の完了条件が本人指示や自動自走規程と食い違う。Open 1〜3 は既定値化されている。H2、H3、H4 は一致。
5. No。不変条件 1、3、4、8 について、Plans と spec が定義し直すか、落としている。
6. No。spec.md の AC1、AC8、AC9、AC11、AC12、AC15、AC16 に、コマンド、パス、製品の内部名が入っている。
7. No。AC16 のパスが evidence と一致しない。Plans 4 の「だけ」は観測を超える。

読み取りだけで進めた。ファイルは変更していない。plan file は作っていない（依頼が読み取り専用の検査だったため）。
