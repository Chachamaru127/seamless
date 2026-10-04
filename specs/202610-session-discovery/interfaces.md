# 実装担当間の境界

- GitContext: state = git / no_git / unknown。workspaceは観測native cwdのrealpath。gitではworktree、repository（common dir）、headState（attached / detached / unborn）、branch（full symbolic refまたはnull）、head（commitまたはnull）、dirty（boolean）。unknownは理由コードだけを持ち、stderrのpathなどを公開しない。
- observeGit(cwd, options?) は Promise<GitContext>。製品は既定のgitを引数配列で実行。試験はtimeout用の実行器を注入可能。nativeの稼働はこの関数の対象外。
- Registration: id, provider, nativeId, generation, host, displayName, role?, workspace（宣言値）, operations, grants。grants = peer / operation / direction。秘密項目なし。
- Observation: nativeId, generation, status（online / offline / unknown）, observedAt（壁時計ms）, source, cwd, context（GitContext）, contextObservedAt。観測器はnative cwdを起点にGitContextを作る。P1製品のnative稼働観測器は未接続でnull。sourceはnative観測器の識別子。GitContextの取得元は固定のobserveGit関数で、P1には独立したGit source識別子を持たない。nativeとGitの取得元を別々に識別する契約は、P2で実アダプターを接続する前に満たす。
- Registry: メモリ内のreplace / get / list、観測器のobserve。replaceは要求ごとの信頼したファイル再読込みまたは単体試験だけで使い、保存APIではない。単体試験だけが稼働観測器を注入する。
- Discovery: 固定caller、Registry、壁時計と単調時計を受ける。sessionsは公開projection、selectはQuery、revalidateはbinding ID。製品serveの入力はcallerを持たない。
- Query: scope?（default current_work）, operation（read / sendを明示）, role?, target?。未知項目を拒否する。
- MCP sessions: Queryを受け取るが一覧projectionだけを返す。選択やbindingなし。
- binding予約は観測awaitの前。発行時の登録fingerprintと実観測を保存し、権限、native ID / 世代、host、観測作業場所を再照合。dirtyは比較から除く。
