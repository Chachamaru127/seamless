# 実会話での検証記録

観測日: 2026-10-01 JST
最新の根拠は本ファイル。過去の「相互読取り未検証」「Claudeの利用枠待ち」は解消した。
本番の常駐製品や、全モデルと全将来版の保証はこの検証の対象ではない。

## 対象と同一性

| 対象 | 版 / モデル | 元の会話 | 元の実行体 |
|---|---|---|---|
| 専用Codex CLI | 0.159.3 / gpt-6.1-sol、low | live.json initial.codex_id | 同じPIDを終了前まで照合 |
| 専用Claude CLI | 2.1.286 / claude-haiku-4-5、low | live.json initial.claude_id | 同じPIDを終了前まで照合 |
| 既存Codex Desktop研究会話 | 26.928.31416 build12553 / 同梱0.159.2 | 01a0f59d-d3d1-79a2-948c-4a1f12a0a1a5 | Desktop41846 → runtime43343 |
| Claude Desktop専用fixture | 2.16120.0 / 同梱Code2.1.284 / Haiku4.5 | UI local_e26ffe30-1e62-412b-becb-0dac809813c8、native44043390-7770-4427-8d7b-edd91f804f8a | Desktop76019 →43098→43099 |

標準Claude契約は利用上限だった。既存の別プロファイルを公式get_usageで再照合し、利用可能を確認した。専用CLIの設定フォルダーだけでそのプロファイルを参照した。標準ログインの識別情報のハッシュは前後一致。認証値は結果へ保存していない。

Codexの最終CLI試験はread-only、approvalPolicy on-request。初期から終了まで保存された全turn_contextでmodel=gpt-6.1-sol、effort=low、同じ承認方針を確認した。MCPの承認reviewはこの専用試験だけauto_review。現在の研究会話や既存業務会話の設定は変えていない。

## 最新の合否

| 検証群 | 結果 | 証拠 |
|---|---|---|
| 実モデルの共通MCP相互read、両方向send/reply、busy受信、元ID/PID維持、peer履歴 | **17/17 PASS、実終了0** | experiments/live-interop/results/live.json |
| native履歴との独立照合 | **PASS、実終了0** | native-evidence.json、verify_evidence.py |
| 重複送信、停止、peer承認の意味の確認 | **7/7 観測完了、実終了0** | edges.json。重複の挙動は下記に分離 |
| 可視履歴とpeerの抽出、他session/思考の除外、Desktop履歴判定 | **6/6 PASS、実終了0** | test_projection.py、test_desktop_history.py |
| 既存Codex Desktopへの入力 | **受信PASS** | desktop-codex-acceptance.json と rootのtool message実受信 |
| CodexからClaude Desktopへの入力 | **受信と応答PASS** | desktop-claude-receipt.json、通常画面のpeer表示、公式SDKの元assistant ID |
| Claude Desktop本人がCodexの正本を読む | **PASS** | desktop.json の実Bash呼出し、owner snapshotの元item ID |
| Codex Desktop全履歴ロード | **PASS、実終了0** | full-history-result.json。要求とsnapshotのrevision一致、canonicalIsComplete=true |
| Claude Desktop本人がCodexへ返信 | **PASS** | desktop.json の実Bash呼出しとrootへのDESKTOP_FROM_CLAUDE_91到着 |

証拠ディレクトリは `experiments/live-interop/results/`。CLI17項目の原記録は `.local/live-interop/12faa30c-467d-4619-8662-30c444c18edb/`。
追加7項目の原記録は `.local/live-interop/8bcd3513-328f-4573-b085-f71e43fdd482/`。

CLIのMCPとDesktopの接続部は、別の実証である。Desktopでは固定のPython接続部を通常のBash道具から呼び、一度だけの純正許可を通した。グローバルMCPへ導入した状態での製品試験とは言わない。Desktop上のMCP組込みは実装タスク。

## 「読めた」「届いた」の判定

readはハーネス直呼びとモデルのMCP呼出しを区別した。`calls.source=mcp` の記録だけをモデル呼出しとして扱う。元のseed message IDがMCP返却にも残ることを集合比較する。相手のmarkerを回答できたことだけで済ませない。

sendには、配送直前に生成した `receipt_nonce` を添えた。これは受信者の事前文脈にない乱数。返信の受信判定はnonceとmessage_idの両方が、該当応答に含まれること。native記録でもenvelopeとreply_toを照合した。

Codexのpeer受信はnative `functionCallOutput` の `namespace=claudex_test`、`name=external_message`。user入力への置換ではない。Claudeのidle受信はnative `origin.kind=peer`、`turnOrigin=peer`、`isMeta=true`。busy受信は `queued_command` attachmentのoriginにpeerが残る。sender文字列は中継が決めた名前であり、他社製品による身元認証の意味はない。

busy試験は、5秒のhold道具の実行中に送った。双方でholdが完了し、届いたnonceを応答した。Codexは同じturn ID。Claudeは元プロセスとsession IDが同じでholdが完了したことを確認したが、「同じlogical turn ID」とは主張しない。

## 失敗と限界から確定したこと

| 条件 | 実測 | 計画への反映 |
|---|---|---|
| Codex一時会話のincludeTurns | -32600 `ephemeral threads do not support includeTurns` | 通常会話だけread可 |
| 既知markerだけの受信判定 | 独立レビューで証拠が弱いと指摘 | nonceとmessage_idへ変更して再実行 |
| Codexへ同IDの再送 | 2つの異なるturnが動いた | 配送前に中継で重複排除 |
| Claudeへ同IDの再送 | 最初は応答。2回目は12秒内のresultなし | 有限観測であり永続的重複排除の保証にしない |
| 停止したClaude | socket送信がFileNotFoundError | offline、再送0。再起動して代用しない |
| SDKのみでClaude busy履歴を読む | peer attachmentが通常メッセージに出ない | 登録済み正本のpeer型だけ補助読取り |
| Codexのreadでuser/assistantだけ抽出 | peer functionCallOutputが落ちた | peerを抽出対象に加え、相互readで再検査 |
| read-only / approvalPolicy=never、readOnly注釈なしの専用試験 | MCP readが承認方針で拒否。approval-policy-rejection.jsonに保存 | 純正承認方式とreadOnly注釈を正しく扱う |
| Claude Desktop最初の英語fixture入力 | preambleと解釈して拒否 | 通常の日本語chat入力で再度markerを設定し、実応答を確認 |
| Desktop IPC | 所有者接続、配送、snapshot読取りが成功 | 公開安定SDKとは言わず版検査を必須化 |

peerが承認にならないと両モデルは回答した。ただしこのNO_AUTH試験は固定条件の理解確認であり、任意の攻撃文に対する権限保証ではない。製品の認可、重複排除、sender固定はモデルの返答で代替せずコードで実装する。

未知targetとself-sendの拒否はハーネスの境界試験。native製品そのものが同じ認可方式を備えるという意味ではない。

## Desktopの実証

Codexはinitialize v0、owner discovery v1、start-turn v2を使用。custom clientTypeを使用し、reservedな製品/アプリの発信元を名乗っていない。元のDesktopとruntimeのPID、親子関係、owner IDを照合した。toolOutputだけを送った。modelと権限のoverride、別runtimeへのresume、UIのユーザー入力への置換はしていない。

受信した `DESKTOP_RX_73` は、現在のroot modelのtool messageにも到着した。さらにowner snapshotから実item `fco_01a0f6be-8d6e-78c1-b7bf-8d866bddc3fc` と元turn IDを抽出した。コード中の文字列や説明文をヒット扱いにしていない。

Claude Desktopのnative sessionとsocketを照合して送信した。通常画面に「別のセッションからのメッセージ」と出た。応答 `CDESK84 PEER_OK85` を公式SDKで再取得した元assistant IDは `3ca2994a-9654-40e5-8bfa-bbf71df90bf2`。

Claude本人は `read_marker.py` をBashで実行し、Codex owner snapshotの元IDを報告した。その後 `claude_reply.py` をBashで実行し、現在のCodex rootへ `DESKTOP_FROM_CLAUDE_91` がtool messageとして到着した。固定コマンド以外をClaudeへ許可していない。両方のnative tool_useとtool_resultをdesktop.jsonに残した。

snapshotは対象会話全体をローカルメモリで受けるが、返却は固定試験項目だけ。全履歴本文は保存も他モデルへ転送もしていない。解除はfollowing=false書込みとcloseを確認。解除専用ACKの保証にはしない。

## 再現コマンド

```sh
.local/native-interop/venv/bin/python experiments/live-interop/run.py --profile <確認済みの試験用Claudeプロファイル>
.local/native-interop/venv/bin/python experiments/live-interop/edge_cases.py --profile <同じ試験用プロファイル>
python3 experiments/live-interop/verify_evidence.py .local/live-interop/12faa30c-467d-4619-8662-30c444c18edb
python3 -m unittest discover -s experiments/live-interop -p test_projection.py -v
```

Desktopスクリプトは、今回の研究会話と専用fixtureのID/PIDに固定した試験物。別会話へ流用して実行するものではない。再試験では専用fixtureを新しく照合する。

## 独立検査

Grok Build / grok-4.7 / medium。第1回はREQUEST_CHANGES、実終了0。元IDの実比較、未知nonce、Claude busyの表現、peer履歴、Desktop契約の更新、hold秒数を修正した。修正後はAPPROVE、レビューCLI実終了0。判定範囲は方式検証と実装計画。plan-review.mdとresults/independent-review.txtに保存した。

全履歴ロードは `read_full_marker.py` で実行した。最終の応答revisionと同ownerのsnapshot revisionはともに1444。canonicalIsCompleteとturnsHaveLoadedOldestは明示true。個別turnのpaginationはtrue=0、false=0、missing=8であり、明示trueとは記録しない。インストール済みDesktopのSl/jl/Al/Elを別担当が照合し、canonicalでも欠測を許容するnative完了条件を確認した。版26.928.31416 build12553に限定してこの規則を適用し、fullHistoryConfirmed=true、実終了0だった。sourceは今回観測したnullだけを許可する。

全turnに明示trueを要求した独自のstrict試験は実終了1。その負の観測もstrict-full-history-result.jsonへ保存した。これはnative完了判定の失敗ではない。初回revision1000の結果はfull-history-initial.jsonに残したが、旧itemsHaveLoadedOldest=trueはnative規則による算出値であり、生の明示フラグではない。欠測、明示false、版不一致を分ける3件の回帰試験も通った。本文は保存せず、同じ試験markerの元IDだけを返した。

実プロセスの終了コードはexecution-observations.jsonに、rootのexec/write_stdin応答を出典として保存した。PASS欄からの推定ではない。
