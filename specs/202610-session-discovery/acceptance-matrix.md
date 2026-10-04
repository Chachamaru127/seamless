# 実装前の試験ケース

状態: 試験設計。下記は実行結果ではない。

| AC | 入力 / 変化 | 期待結果 |
|---|---|---|
| D1 | caller.outbound(send,B)のみ。B.inbound(send,A)は未許可 | BはAの一覧に公開しない。片側の自己申告で許可を増やさない |
| D1 | 未認可target IDを明示 | 未登録と同一JSON、target_unavailable |
| D1 | credentials、transcript、任意extraを含む内部登録 | 公開投影は固定項目だけ。追加属性をコピーしない |
| D2 | 同workspace、同worktree | current_work候補 |
| D2 | 同repo、別branch、別worktree | same_repository候補。既定では選択しない |
| D2 | 同branch、別worktree | 別作業場所と表示。branch一致だけでcurrent_work扱いしない |
| D2 | 親Gitを共有する別論理workspace | 同repoと表示するがcurrent_workから除く |
| D2 | 同remoteの別clone | 別ローカルrepoと表示 |
| D2 | Git外 / detached / unborn / コマンド失敗 | 個別状態を保つ。失敗はunknown |
| D3 | providerだけを入れ替えた同一条件 | 結果の判定理由が同じ |
| D3 | 同順位候補2件 | ambiguous、bindingなし |
| D4 | role指定、相手role未知 | 一致しない |
| D4 | explicit targetがscope外 | scope_conflict、bindingなし |
| D4 | current_workの観測branchまたはHEADが食い違う | 不整合として選択しない |
| D5 | observationなし / 60秒を超える / 未来時刻 | unknown / stale / invalidとして選択しない |
| D5 | caller自身の最新作業場所取得失敗 | 自動選択しない |
| D5 | binding発行後、target停止 / 世代変更 / branch変更 / HEAD変更 | 再照合拒否 |
| D5 | binding発行後、caller workspaceまたはHEAD変更 | 再照合拒否 |
| D5 | 同じ公開IDを再登録、旧bindingを使用 | 再照合拒否。差替え先へ送らない |
| D5 | 60秒経過 / 偽造または未知のbinding ID | expired / invalid。bindingを使い回さない |
| D6 | CLI / MCPへ同一bootstrapとquery | sessionsの公開候補と理由だけが一致 |
| D6 | MCP引数にsender / 任意extra / 不正scope | invalid params。bootstrap主体を上書きしない |
| D6 | native観測アダプター未接続 | sessionsは登録metadataを返すがunknown。selectは成功しない |
| D6 | bootstrapにonlineと新しい時刻を記入 | bootstrap_invalidで拒否。稼働の証拠にもならない |
| D6 | serveへselect、revalidateを連続入力 | 同一プロセスのbindingで照合できる。終了後の別プロセスでは復元できない |
| D6 | read / sendをtools/callへ渡す | 未登録toolのエラー。成功や配達済みを返さない |

bindingの再照合結果は「送信時点まで安全」の保証ではない。後続sendは、固定したnative IDと世代へ原子的に送れるアダプターを使う。検査とsendの間で世代が変わった場合は拒否する契約をP2以降へ渡す。

追加ケース:
- D3: callerとtargetを実際に逆転し、Codex→ClaudeとClaude→Codexの選択理由、曖昧性、世代照合が対称である。
- D4: displayNameに命令風の文字列を入れても選択、順位、認可が変わらない。
- D5: 同じcaller-targetの新binding発行で旧bindingをsupersededとして拒否する。成功した再照合はbindingをconsumedにして再利用を拒否する。

送信との原子性検証はP1範囲外。P2のnative sendアダプター接続時に検証する。

Opus指摘の追加試験:
- D4: 最上位のonline1件とstale1件、最上位staleで下位onlineの双方をblocked_unobserved。
- D2: Git index mtime不変、GIT_DIR混入無効、timeout=unknown、fsmonitor実行なし。
- D5: 観測native cwdと申告workspaceが違えば観測cwdで分類。caller差替えで旧binding拒否。並行revalidateの成功は1件のみ。
- D6: 試験専用子プロセスでbinding往復を検査し、同じbootstrapを製品入口へ渡すとunknown。試験のPASSはnative稼働証拠ではない。
- D1: bootstrapのcredentials / transcript / 任意extraは拒否し、保存APIがない。

最終補足の追加試験:
- D1: outbound(send,B)だけでB.inboundなしなら非公開。両方ある場合A→B一覧はsend=true/read=false、B→A一覧は非公開。
- D1/D4: ID重複、native identity重複、self grantを拒否。明示self targetはself_target。
- D4: staleの旧cwdはscope外でも、同scope fresh候補への自動選択をblocked_unobserved。
- D5/D6: serve中のgrant取消、名簿読込み失敗、caller差替えを次要求で拒否。
- D5: 55秒でchecking開始し観測が10秒遅れたらexpired。checking中の新selectは旧bindingをsuperseded。
- D1/D6: 偽の秘密風文字列の非JSON / 未知項目値を渡してもstdout / stderrに原文なし。
- D2: configured clean filterが実行されない。symlink cwdと実pathは一致。
