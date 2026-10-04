# 両方向のセッション探索

> 2026-10-04 に claudex から seamless へ改名した（独立リポジトリ）。本文の claudex、`~/.claudex`、実行したコマンドは記録当時の旧名のまま残す。

更新: 2026-10-02 JST
承認根拠: 同日、本人の「概ねOK」とteam-plan / team-build指定。直前の探索説明と既存の元会話通信仕様を対象とする。
状態: P1の共通部は66試験PASS、実終了0。最終版のHaiku / Opus独立判定PASS。今回のP1共通核は完了。P2以降は別工程。

> 改訂（2026-10-04、立花さん承認 G4）：名簿（bootstrap）、登録、`--caller` を前提にした記述は、旧方式（`--registry --caller`）の仕様として残す。新方式（名簿なしで自動でつなぐ）の正本は `specs/202610-everyday-use/spec.md`。新旧で食い違う点は新方式の正本を優先する。

## 目的と範囲

CodexからClaude、ClaudeからCodexが同じ判断で相手を探す。連携を認めた名簿だけを見て、依頼目的に合う元会話を特定する。今回の完成単位は、既存計画P1の登録と探索、および送信前に使う宛先再照合。元履歴のread、native send、Desktop常用導入は既存の別工程を維持する。

全会話の無断走査、本文からの権限付与、別会話への自動フォールバック、停止中の自動起動、外部リポジトリへの書込み、常用環境への設定配送は今回に含めない。

## 選択仕様

- 名簿は製品、元会話ID、実行世代、ホスト、稼働状態と観測時刻、表示名、登録担当、許可操作、許可相手、作業場所を持つ。秘密の接続資格を一覧へ返さない。
- Gitの同一ローカルリポジトリは共通管理場所で判定。同じリモートURLでも別cloneは別として扱う。認証入りURLを読む必要はない。
- 作業場所は、論理プロジェクトのworkspace、Git worktreeのroot、Git common directory、現在のブランチ、HEAD、dirty（未コミット変更の有無）を分ける。ブランチ名やディレクトリ名だけで同一にしない。
- Git外、detached HEAD、未作成HEAD、取得失敗は明示する。取得失敗は空リポジトリやfalseで代用しない。
- 自動候補選択は登録済み、認可済み、稼働、metadata新鮮という条件をすべて満たす相手だけ。片方向だけの特例を作らない。
- 依頼目的を current_work / same_repository / any_registered の明示値として渡す。初期値current_work。自然言語の解釈は呼出し側が担い、探索部がタイトルを命令として実行しない。
- current_workは同じ論理workspaceとworktreeに限る。別worktree、別ブランチ、別repoは理由付き候補として見えるが、自動選択へ繰り上げない。同じブランチでも同じ未コミット内容とは保証しない。
- 明示の宛先指定は探索順位より優先するが、認可、稼働、世代、新鮮性は省略しない。目的に合わない作業場所の明示指定はscope_conflictとして確認対象にする。別目的へ自動変更しない。
- 登録担当は任意の正確な絞込み条件。担当不明の候補を指定担当と一致した扱いにしない。未指定時にタイトルや最近の会話から勝手に役割を決定しない。
- 同じ優先順位の候補が複数ならambiguous。自動送信しない。候補0件、停止、metadata不明を認可済み相手について区別する。未登録と未認可は同じtarget_unavailableとする。
- selectionは元会話IDと実行世代へ固定した短命のbindingを返す。send側は直前に元実行主体と最新の作業場所を再照合する。停止、世代変更、branch / HEAD / workspace変更なら拒否。本文を読んで同じコードと推定しない。
- 名簿の一覧と探索は会話本文を読まない。必要な本文の確認は別の認可済みread操作で行う。

## 実装へ渡す詳細条件

- 公開許可は送信元と受信先の双方の登録規則で照合する。未認可IDを明示しても、存在を漏らさない対象利用不可の応答とする。
- caller自身の作業場所も最新観測で照合する。current_workのbranch / HEADに食い違いがあれば同一worktreeでも選択しない。
- 観測なし、未来の観測時刻、取得失敗、60秒を超える観測を区別し、自動選択しない。稼働とGit metadataの観測時刻は別々に保持する。P1のObservation.sourceはnative観測器を識別し、Gitの取得元は固定のobserveGit関数。P1製品のnative観測器は未接続。独立したnative / Git source識別子はP2で実アダプターを接続する前の契約とする。
- bindingはcallerと対象の双方のID / 世代 / 作業場所へ固定する。登録の差替え、権限取消、caller側の作業場所変更も再照合拒否の対象。
- 再照合は送信と同時の保証ではない。後続native sendは固定した元IDと世代を検査して受け付ける。対応できないアダプターを配達保証済みとして扱わない。
- 公開投影は許可項目を列挙して組み立てる。任意属性や接続資格をそのままコピーしない。
- 試験の具体例はacceptance-matrix.md。実行するまでPASSとしない。
- 探索対象の要求操作はreadまたはsendを明示し、双方の許可を検査する。bindingは要求操作と選択時scopeも保持する。今回はどちらの操作も実行しない。
- 適格候補の順位は同workspaceかつ同worktreeを1、同ローカルrepoの別作業場所を2、別ローカルrepoを3とする。scope内の最小順位に1件だけあれば選択し、同順位が複数ならambiguous。branch名だけで順位を上げない。
- bootstrapに書かれたonlineや観測時刻をlive observationにしない。native IDと世代を照合する信頼した観測アダプター不在ならunknown。取得失敗と旧世代の観測も選択しない。
- CLIのselectとrevalidateは持続serveモードの同一プロセス内で行う。単発コマンド終了後にbindingを復元する経路は作らない。

## 受入条件 AC

| AC | Yesとなる条件 | Evidence of done |
|---|---|---|
| D1 | 許可した相手だけが名簿に現れ、接続資格と本文が返らない | 認可と投影の回帰試験 |
| D2 | 同一worktree、別branch、同branch別worktree、別repo、別clone、Git外、detached、unbornを区別 | 実Gitの一時fixture試験 |
| D3 | 両製品を入れ替えても選択結果の条件が変わらない。複数候補はambiguous | 対称性と候補分類試験 |
| D4 | scope、担当、明示targetを検査し、不適合時に勝手な送信先を返さない | 選択の契約試験 |
| D5 | 停止、古いmetadata、世代変更、最新作業場所の変化でbindingを拒否 | 再照合試験 |
| D6 | CLIとMCP sessionsが同じ共通部を使い、MCP入力からsenderを偽装できない | プロセス単位のstdin/stdout試験 |

## Stop conditions

人間の既存業務会話への試験送信、秘密ファイルの読取り、未登録会話の本文取得、Git境界変更、グローバル設定配送が必要になった操作だけ停止する。独立したローカル実装は継続する。

## 未決事項

今回の探索範囲に未決の製品判断はない。複数cloneを同一repoとして扱う配布識別子、自然言語による担当推定、過去本文の全体検索は後続仕様。初版で採用したと扱わない。

## 独立レビュー反映の確定条件

- 許可はpeer登録キー、operation、direction（outbound / inbound）の組。caller.outboundとtarget.inboundがそろった操作だけ許可。sessionsにはreadかsendの少なくとも一方が双方許可の相手だけ出し、公開投影に操作ごとの可否を付ける。同一登録キーへの再登録は許可を引き継ぐが旧bindingは拒否する。
- 未登録と未認可の明示targetは同一JSONのtarget_unavailable。停止、unknown、staleの詳細は認可済みだけ。
- scopeはcurrent_work=順位1、same_repository=順位1〜2、any_registered=順位1〜3。同じhostのみ対象。別hostは今回の同じMac範囲外。
- Git外は双方の観測workspace実pathが同じときだけ順位1、それ以外は順位3。detachedは双方detachedかつHEAD一致、unbornは双方unbornかつsymbolic ref一致で同一作業内容。片側だけの状態差はcurrent_work不適合。
- 順位は認可済みかつscope内の候補を先に分類する。観測なし、stale、未来時刻、取得失敗は順位を付けずscopeに関係なくblocked_unobserved。freshな世代不一致はcwdで順位を付け最小順位ならblocked_unobserved。下位へ降りない。信頼した停止観測だけ除外可能。
- live observationはnative ID、generation、native cwd、観測時刻、sourceを返す。観測cwdの実pathとそのGit情報で選択する。bootstrap workspaceはdeclaredWorkspaceとして表示用。申告pathを稼働中の作業場所と推定しない。
- bootstrapには接続資格、本文の項目を受け付けない。P1は保存APIを持たず、明示されたローカルmetadataファイルを読み取る。製品起動ではmode0600の通常ファイルのみ読み、登録例は実会話でない例として保存する。既存秘密ファイルは入力として選ばない。利用者が明示したmetadataファイルだけを読む。
- provider名で順位や認可を分岐しない。能力差は登録のoperationsを使う。
- role指定のexplicit targetが不一致ならrole_mismatch。binding IDはrandomUUID。起動時のcallerキーは認証ではなく、同じOSユーザーは別キーで起動できる。P2は接続ごとの資格で主体を確認する。
- dirtyの変化はbinding失効条件に含めない。dirty=trueの間の編集内容一致も保証しない。観測は壁時計でちょうど60秒までfresh。bindingは単調時計で60秒まで有効。

## 着工条件の最終補足

- bootstrapのstatus / observedAt等の未知項目はbootstrap_invalid。unknownは正しいbootstrapを読んだ後の観測器未接続の結果。
- 登録キー重複、provider / host / nativeIdの重複、自分宛てgrantはbootstrap_invalid。caller自身を候補から除外し明示指定はself_target。
- 認可、operation、host、roleの観測に依存しない絞込みを先に行う。未認可の相手をobserveしない。readだけ許可の既知相手にsend指定ならoperation_not_permitted。
- 名簿は1ファイル。callerは起動引数として固定する。要求ごとに同じ明示ファイルを読み直し0600、通常ファイル、schemaを再検査。失敗はregistry_unavailableとし古い名簿へ戻らない。caller削除、nativeId / generation変更なら全要求を拒否する。
- binding状態はissued→checking→consumed / invalid、およびissued / checking→expired / superseded。全await終了後にも状態checkingと期限を再確認する。checking中の新binding発行はsupersededを優先。再照合は候補の曖昧性を選び直さず、固定した相手だけ確認する。
- bootstrap読込み前に64KiB上限を検査し、JSONやschemaエラーを値や例外メッセージ付きで返さない。stdout / stderrへ原文を出さず固定コードのみ。明示パスは利用者が選ぶmetadata入力であり任意秘密ファイルを識別する保証はしない。APIキー等の既存秘密ファイルを指定することは承認範囲外。
- stdin EOFでserve終了、binding破棄。stdoutはJSON行だけ。64KiB超の行はid:nullのinvalid_request後に処理継続。
