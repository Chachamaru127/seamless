# claudex 現在地監査

観測日: 2026-10-02 JST  
対象: `docs/reports/2026-10-02-claudex-explained.html` の現状説明、現行コード、2026-10-02時点の最新検収記録。

## 結論

「方式が実機で成立した」「探索の共通核を検収した」「普段のCodex / Claudeから使える製品がある」は別の状態である。今あるのは前二つで、三つ目は未接続。HTML内に`agmsg`との数値採点表は見つからず、本文ではforkしない方針だけに触れている。新しい採点を載せる場合は、製品として今日使える機能、ローカル共通核、実機方式検証、設計案を別軸にし、未知を0点にしない。

## 現時点でできること

今日のCodex→Claudeは、実際の会話に対して自動では動かない。`src/registry.ts`の製品用observerは`null`観測を返し、`README.md`は通常起動の選択を`caller_unobserved`としてbindingなしと規定する。Codex側のMCPを起動しても現行MCPが提供するのは`sessions`一覧だけで、read/send/select/revalidate toolはない。名簿に実会話を手登録したとしても、候補はnative稼働状態`unknown`となり、実際の宛先選択や送信へ進まない。登録例のIDは作り物である。 (根拠: `README.md:19-27,43-55`; `src/registry.ts:5-13`; `src/mcp.ts:22-26`)

一方、テスト専用の観測器を使うfixtureでは、CodexとClaudeの呼出し元を入れ替えても同じ探索規則が働き、権限、scope、担当、鮮度、曖昧性、短命bindingを検査する。これは探索部の契約試験である。実会話の稼働、read/send、Desktopへの設定導入を試したものではない。 (根拠: `specs/202610-session-discovery/acceptance-matrix.md:27-41`; `specs/202610-session-discovery/Plans.md:21-25`; `specs/202610-session-discovery/evidence.md:41-57`)

## 検収された共通核

2026-10-02の現行版は66/66試験PASS、試験とstrict型検査の実終了コードはともに0。HaikuとOpusの独立判定もPASSで、manifestの15ファイルは今回現物とSHA-256一致を確認した。この証拠が支えるのはP1のD1〜D6探索共通核までである。試験はCLI / MCPの候補分類と規則、実Gitの一時fixture、registryやbindingの拒否条件を検査する。製品observerは未接続のままである。 (根拠: `specs/202610-session-discovery/evidence.md:41-57`; `reviews/verification.json:2-7,25-38`; `reviews/build-haiku-66.txt:1-8`; `reviews/build-opus-66.txt:1-14`)

「P1完了」は「探索共通核の範囲で完了」と限定すれば正確である。日常利用する製品のセッション登録・native観測まで完了した意味ではない。READMEの「P1の登録、一覧、候補選択、宛先の再照合」という短い説明は、明示的なmode 0600 bootstrapファイルへメタデータを手入力する形と、native観測器未接続の制限も合わせて読む必要がある。MCPから登録・read・sendはできず、常用MCP設定も変更しない。したがって比較資料の見出しは「P1探索共通核 完了。native登録・観測とread/send製品接続は未完了」が誤解を最も減らす。 (根拠: `README.md:3-6,19-27,43-55`; `GOD_Plans.md:9-11`; `specs/202610-session-discovery/Plans.md:64-68`)

このcheckoutは親GitのHEADに含まれず、`claudex`ディレクトリ自体が親repoでignoreされている。親HEAD `4e574de8b3b8af2117d4a00bbbc3a29dbf006c6f`をこのコードのcommit SHAとして表示してはいけない。現行の識別根拠はP1 manifestのファイル別ハッシュである。 (根拠: `specs/202610-session-discovery/evidence.md:27-31`; `reviews/verification.json:8-23`)

## 2026-10-01の実機方式検証

2026-10-01に専用CLIと専用Desktop条件で接続方式を調べた。CLIではCodex 0.159.3 / gpt-6.1-sol lowとClaude Code 2.1.286 / Haiku 4.5 lowが試験用共通MCPを使い、相互read、両方向send/reply、busy中の受信など17/17 PASS、実終了0だった。追加の重複・停止・peer権限観測は7項目、履歴投影とDesktop履歴判定は6項目である。native記録でmessage IDと、その時点の事前文脈にないnonceを照合した。 (根拠: `specs/202610-session-interop/evidence.md:3-5,20-37,39-47`)

Desktopでも当時の既存Codex研究会話と専用Claude Desktop fixtureの双方でreadと往復を確認した。ただし、完成版MCPをDesktopへ組み込んだ試験ではない。Desktopのnative接続は固定Python接続部を通常のBash道具から手動で呼び、純正の一度だけの許可を通して成立させた。Codex Desktop IPCとClaude Desktop socketは版依存の内部接続として条件を固定している。グローバルMCP設定への導入、製品の登録UI、自動稼働観測は未実施。観測記録は2026-10-01時点であり、今日のアプリ起動状態や将来版の保証ではない。 (根拠: `specs/202610-session-interop/evidence.md:13-18,28-37,68-89`; `specs/202610-session-interop/Plans.md:72-92`)

初期のnative接続probeはさらに狭い。Codexの一時thread metadata read、Claude SessionStart socketへの本文なし接続、固定fixtureとschema検査を通した。実Claude本文配送、元の文脈での返信、共通MCP、既存Desktopへの接続はその初期probeの完了範囲ではない。後続の10月1日live-interop記録が別途これらの方式を実証したが、どちらも常用製品の導入を証明しない。 (根拠: `experiments/native-interop/README.md:25-47`; `experiments/live-interop/README.md:13-20`)

## Codex→Claudeの探索規則

Codex呼出し元は起動時のcaller登録で固定される。送信候補にするには、呼出し元にsend能力とClaude向け`outbound`許可があり、Claude側にもsend能力とCodex向け`inbound`許可が必要である。readも別々に同じ双方向grantを要する。MCPや要求本文がcallerを名乗り直すことはできない。今日の製品observerはnullなので、権限のある名簿行があってもClaudeの起動中・native ID・世代・実cwdを確かめられず、デフォルトでは選択を止める。fixtureでは観測結果を注入するため、この後段の分岐を試験できる。 (根拠: `src/registry.ts:15-16`; `specs/202610-session-discovery/Plans.md:47-50`; `README.md:43-45`)

| 実際の作業場所 | `current_work`（既定） | `same_repository` | 要点 |
|---|---|---|---|
| 同じ論理workspace、同じGit worktree、branchとHEADも一致 | 候補にできる | 候補にできる | 最上位rank 1。同じ登録・grant・live観測条件も必要 |
| 同じローカルrepo、別branchの別worktree | 自動選択しない | 候補にできる | rank 2。目的scopeを自動で広げない |
| 同じbranch名だが別worktree | 自動選択しない | 候補にできる | branch名だけで同一作業場所にしない。rank 2 |
| 同じremote URLだが別clone | 自動選択しない | 自動選択しない | 別ローカルrepo。明示scope `any_registered` でのみ候補にできる（rank 3） |

同順位が複数なら`ambiguous`で止まり、古い候補を飛び越えて下位候補へ自動切替しない。未観測・stale・未来時刻・取得失敗が候補に混じる場合も、自動的に下位のonline候補を選ばず`blocked_unobserved`にする。明示targetも認可、host、role、scope、最新観測を通す。bindingはcallerとClaude双方のnative ID、generation、作業場所に結び、60秒で失効する。再照合は一回だけ成功し、成功しても送信済みを意味しない。dirtyは未コミット変更の有無であり、編集内容が同じという保証はない。 (根拠: `specs/202610-session-discovery/spec.md:19-25,30-40`; `README.md:61-72`; `specs/202610-session-discovery/Plans.md:41-43`)

## 履歴保存について

「共有SQLiteも会話本文の永続コピーも置かない」は正本を各製品に残す設計方針である。readに必要な間のローカルメモリ上snapshot / transient buffer、本文を返す呼出し結果、短い配送metadata（時刻、世代、message ID、送り主、宛先、状態）は許容される。全履歴の永続中継DBは要求されず、むしろ仕様は本文・思考・認証値を中継の永続記録へ置かないとしている。 (根拠: `specs/202610-session-interop/Plans.md:48-54`; `specs/202610-session-interop/evidence.md:76-78`; HTML `docs/reports/2026-10-02-claudex-explained.html:1150-1154`)

## agmsg比較の採点単位

実現段階と品質点は別々に表示する。段階は「設計のみ / ローカル共通核 / 限定実機検証 / 製品接続済み」のどこまで実物があるかを示す。品質点は、その段階で実装・検証した項目の信頼性や使い勝手を評価する。ローカル探索核の品質を高く評価しても、使える製品があることにはならない。候補選択のローカルコードを、導入済みの読み書き製品や、方式だけ確認したDesktop接続と同じ機能として数えない。比較用の欄は次の4つにする。

| 欄 | 採点するもの | 今回の証拠で言える範囲 |
|---|---|---|
| 今日の製品機能 | 利用者が追加準備なしで通常のCodex/Claudeから使えるread/send/登録 | claudexについてはobserver未接続、read/send未提供と確認済みなので、この「提供有無」欄なら0。これはコード品質の0ではない |
| ローカル共通核 | コードとして実装され、現行manifestに対する試験・独立判定がある機能 | P1 discovery D1-D6は完了。read/send/MCP/Desktop常用導入は含まない |
| 実機方式検証 | 限定された版・アカウント・会話で観測した動作 | CLI相互read/sendと対象Desktop経路を2026-10-01に確認。固定条件の結果として別掲 |
| 設計のみ | 仕様・計画・完了条件に書かれた未実装機能 | 将来欄へ置き、現状得点・current totalには加えない |

agmsg側も同じ証拠水準で比較する。機能の存在、ローカルで使える状態、実会話での受信、Desktop常用導入を別々に判定する。根拠がなく観測できていないものは「未知 / N/A」であり、0点にしない。確認済みの未提供は「今日使えるか」という可用性欄に限って0とする。実験失敗はその固定条件での負の観測である。未実装の計画を現在点へ加算しない。総合点が必要なら、評価対象と重みを先に表示し、N/Aを0へ置き換えず比較可能項目だけで算出する。

## 証拠一覧と確信度

| 主張 | 一次証拠 | 判定 |
|---|---|---|
| P1共通核は現行manifest上で66試験・strict型検査・独立Haiku/Opus判定を通過 | `specs/202610-session-discovery/evidence.md:41-57`; `reviews/verification.json:2-38`; 15ファイルのSHA-256を今回read-only照合 | high |
| P1製品observerは未接続。通常起動でnative相手を選べない | `src/registry.ts:5-13`; `README.md:43-45`; `mcp.ts:22-26` | high |
| 2026-10-01にCLI/限定Desktopで実会話方式を確認 | `specs/202610-session-interop/evidence.md:20-37,68-99`; `experiments/live-interop/README.md:13-20` | 当日の記録の範囲でhigh。現在の起動や将来版へ一般化しない |
| 完成版MCPのDesktop常用導入は未実施 | `specs/202610-session-interop/evidence.md:37`; `experiments/live-interop/README.md:18` | high |
| HTMLはagmsgの数値採点をしていない | `docs/reports/2026-10-02-claudex-explained.html`内の`agmsg`言及は本文のforkしない方針のみ（1168行） | high |

レビュー向け注意: Opusの最終独立判定はD1-D6のP1探索共通核に限る。10月1日の実機方式検証へのGrok判定も方式と実装計画の範囲に限る。どちらも製品全体の完成判定ではない。 (根拠: `specs/202610-session-discovery/reviews/verification.json:31-36`; `specs/202610-session-interop/evidence.md:91-99`)
