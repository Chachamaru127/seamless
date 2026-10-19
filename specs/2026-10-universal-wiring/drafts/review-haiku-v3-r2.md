**判定: 図面検査 FAIL。** 食い違い 20 件（AC / S / Open decision / 不変条件に結び付くもの 16、タスク 3、その他 1）。敵対は依頼の範囲外のため含めない。

## 指摘（番号 / 何が / 直し方）

**AC**
- **AC1** 「初見の Mac 相当」が未定義。文言自体が H5 待ち（spec 注記）。→ 一時 HOME と Keychain の有無など条件を書き、H5 を文言から外す。
- **AC2** 3 状態の判定基準が Plans 3 章に無いのに、T20 が「Plans 3 章」を参照。日本語名（すぐ渡せる 等）と enum（ready 等）の対応も無い。Cursor 行の「人が起こすまで待つ」は spec では「次の区切り」。→ Plans 3 に判定表を足し、名称対応を 1 表にする。
- **AC7** 15 往復の内訳（Claude 5、Codex 5、Grok Bot 5、各状態）と、Codex が CLI か Desktop かが Plans 8 の `batch --n 15` に無い。→ 内訳と対象を Plans 8 に書く。
- **AC8** 「Mac の外への接続 0」を Mac 全体の `lsof` で見ると、受信側 AI のモデル API 通信で必ず FAIL し、S9 が常時発動する。→ 判定対象を seamless のプロセスに限定する。
- **AC9** T09 の Done when に共通部分の差分 0 が無い。Plans 1.3（manifest + 1 ファイル）と AC9（定義ファイル 1 枚 + hook 1 枚）も一致しない。→ T09 に追加し、ファイル数の文言を 1 つに揃える。
- **AC11** T01 は 4 行（Claude、Codex CLI、Codex Desktop、Grok CLI）のみ。v1 の 7 製品に足りない。接続方式、確認日、「未確認（Desktop）」表示が Done when に無い。→ 7 行と列を Done when に足す。
- **AC12** 「内部 API の再現は H6 を経たもの」の H6 は webhook と hooks の規約。Codex Desktop IPC（H2 決定済み）には掛からない。→ H2 と H6 を分けて書く。
- **AC14** Plans 5 の週表に無い。→ 人の作業の週を足す。
- **AC3 / 4 / 5 / 10 / 14** T15 の Done when に roundtrip と hold の判定が無い（`--help`、batch、footprint、compare だけ）。→ 2 副コマンドの試験を足す。

**停止条件**
- **S2** 回帰先「渡ったを相手の記録で確認だけに戻す」は、現行の段階 2 と AC7 の定義と同一で効果が無い。→ 別の回帰先を書く。
- **S5 / S7 / S8** どの AC にも対応しない（spec の見出し「AC に対応」と不一致）。→ 対応先（H6、H7 など）を書く。
- **S9** spec にあるが、Plans 冒頭（S1〜S8）と本依頼（S1〜S7）に無い。→ 両方を S1〜S9 にする。
- **S3「その機能」、S6「該当アダプタ」** が特定できない。→ 名前を列挙する。

**Open decisions**
- Plans 7 は「AI が決めない」とするが、T03（Open decision 2）と T04（Open decision 1）が既定値として採用している。Plans 6 は作業ブランチ（Open decision 3）を確定扱い。→ 値を未決へ戻すか、決定を記録する。

**不変条件（ルート spec.md）**
- **不変条件 1** 要素が一致しない（root: 製品、ホスト、会話、実行主体 / spec: 製品、ホスト、会話 ID、世代、作業場所）。→ 用語を root に合わせるか、追加を明記する。
- **不変条件 3** Plans 1.7 の「名簿なしの経路だけが付ける」は、root の「`markUnapproved:true` のときだけ」と別の条件。→ root の文言に戻す。
- **不変条件 8** 対象の列挙が root と違う（Dot を v1 対象外にし、opencode、Cursor、Antigravity を追加）。spec 冒頭は「1〜8 は変えない」。→ root の改訂を別に通すか、spec 冒頭を直す。

**段階**
- 段階 1「受理 = 書込み成功」と、Plans 1.1「`submitted` に進む前に失敗」の位置が一致しない。→ `submitted` を spec の段階名へ対応づける（AC6 の観測に関わる）。
- 段階 5「不明」は root 4 の 4 項目に無い（root 6 の対応）。→ 不変条件 6 の状態として書く。

**tasks.md**
- **T12** ヘッダは「最初」、表では `[P]`。T01 などの依存欄に T12 が無い（Plans 6 は T12 より前に ready にしないと定める）。→ 全タスクに依存を入れ、`[P]` を外す。
- **T05 と T20** が `[P]` だが、両方が `src/cli.ts` を改修（ヘッダの「別ファイルなので並列可」に反する）。→ どちらかの `[P]` を外す。
- **T04、T12、T14、T17** Done when の「証拠の読み手だけ」「読める」「抜けの指摘 0」「強調」は Yes / No で判定できない。→ 手順を 1 文ずつ書く。

**その他**
- 版の宣言が食い違う。依頼の「git main 87a4162」に対し、gitStatus の main 最新は ee10203、evidence の統合ブランチは c1d582d。→ 版を commit で 1 つに統一する。
- 2026-10-19 の「承認」が改訂 3 のどの版かが記録に無い。→ 承認した版の commit を evidence に書く。

## 確かめること（Yes / No）

1. **対応: No。** Plans 8 は 16 件すべてに手段があるが、tasks の Done when が覆わない: AC3、AC7、AC9（T09）、AC11、AC14（週表）。
2. **Done when が Yes / No で判定できる: No。** T04、T12、T14、T17 が該当。
3. **S1〜S7 の発動 AC が明確: No。** S2 は同一定義への回帰、S5 / S7 / S8 は AC 非対応、S3 / S6 は対象不明。
4. **H の「決定済み」が指示と食い違う: No（食い違いは無い）。** H1〜H4 は 2026-10-19 の指示と一致。ただし H7 のループ指示は「本人の指示の出典」の引用に無い。
5. **Plans.md が不変条件を定義し直している: Yes。** Plans 1.7 の markUnapproved 条件が root 3 と別物。
6. **spec.md に手段が混ざっている: Yes。** 内部状態名（accepted、reached 等）、AC12 の sessions / active_sessions / IPC、AC15 の html_render、`humanApproval:false` などの鍵名、`drafts/` のパス。
7. **T3 Code の主張が実機事実と矛盾: Yes。** Plans 4.3「MCP を呼べる」、4.6「html_render で出せる」は現在形だが、evidence は AC14 / AC15 を未実測と記録し、該当する行が無い。Plans 4.4 は「実機で判定する」と書きつつ、v1 の表示を先に決めている。Nestra 側の AC24 は、この検査では外部文書を未確認。

---
注記: 読み取りのみ。ファイルは変更していない。Bash が使えないため `git log` は未確認で、版は gitStatus の snapshot に依拠した。計画モードのため、この判定は返答として出し、計画ファイルは作っていない。
