#!/usr/bin/env bash
# 並列の施工（2026-10-19 立花さん指示: DeepSeek は最大 16 並列）。
# 使い方: bash scripts/loop-par.sh <issue番号>...
#   各 Issue を独立した worktree（.local/wt/<番号>、ブランチ loop/<番号>、基点 loop/integration）で施工役に任せ、
#   verify.sh 0 なら commit して loop:review、非 0 なら wip commit して loop:blocked。
#   同じファイルを触る Issue は同じ波に入れない（衝突は merge 時に人が見る）。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); BASE="loop/integration"; LOG_DIR="$ROOT/.local/loop"; mkdir -p "$LOG_DIR" "$ROOT/.local/wt"
STAMP=$(date +%Y%m%dT%H%M%S)
[ $# -gt 0 ] || { echo "issue numbers required"; exit 1; }
[ $# -le 16 ] || { echo "max 16"; exit 1; }

one() {
  local num="$1" wt="$ROOT/.local/wt/$1" branch="loop/$1"
  local title body req out vout oc_exit v_exit changed sha
  title=$(gh issue view "$num" --json title --jq .title)
  body=$(gh issue view "$num" --json body --jq .body)
  gh issue edit "$num" --add-label "loop:in-progress" --remove-label "loop:ready" >/dev/null
  if [ ! -d "$wt" ]; then
    if git show-ref --verify --quiet "refs/heads/$branch"; then git worktree add -q "$wt" "$branch"; else git worktree add -q -b "$branch" "$wt" "$BASE"; fi
  fi
  req="$LOG_DIR/$STAMP-issue-$num-request.md"
  cat > "$req" <<EOF
# 施工依頼（Issue #${num}）
$title

$body

## 契約
- 目的: 上の Done when を満たす。Done when 以外の範囲を広げない。
- 対象の版: ブランチ ${branch}（${BASE} からの作業ブランチ）。作業フォルダは ${wt}（この repo の worktree）。
- 承認済みの操作: この worktree の中のファイルの追加と変更、\`bash scripts/verify.sh\` の実行、\`node --test\` の実行。
- 禁止: \`~/\` 直下の設定ファイル、Keychain、本物の Claude / Codex / Grok Bot への送信、外部への通信、git commit / push、\`.local/\` の変更、specs/ の変更、この worktree の外のファイルの変更。
- 終わり方: Done when を満たしたら止める。最後に \`bash scripts/verify.sh\` を走らせ、その終了コードと、変更したファイルの一覧を出力の末尾に書く。途中の報告だけで終えない。
- 判定の線: 完了は verify.sh の終了コード 0 と、Done when の各条件が Yes になること。自己申告は完了にしない。
EOF
  out="$LOG_DIR/$STAMP-issue-$num-opencode.log"
  ( cd "$wt" && opencode run --model ollama-cloud/deepseek-v4.1-flash:1017 --agent build --auto "$(cat "$req")" > "$out" 2>&1 ) &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do sleep 10; waited=$((waited+10)); if [ "$waited" -ge 1500 ]; then echo "#$num: 25 分で打ち切り" | tee -a "$out"; kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null; break; fi; done
  wait "$pid" 2>/dev/null; oc_exit=$?
  vout="$LOG_DIR/$STAMP-issue-$num-verify.log"
  ( cd "$wt" && HOME=$(mktemp -d) bash scripts/verify.sh ) > "$vout" 2>&1; v_exit=$?
  changed=$(cd "$wt" && git status --porcelain | wc -l | tr -d ' ')
  if [ "$v_exit" = 0 ] && [ "$changed" -gt 0 ]; then
    (cd "$wt" && git add -A && git commit -q -m "loop #$num: $title

verify.sh exit=0（並列ループ $STAMP）。施工: opencode deepseek-v4.1-flash:1017。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>")
    sha=$(cd "$wt" && git rev-parse --short HEAD)
    gh issue comment "$num" --body "並列ループ $STAMP: 施工 exit=$oc_exit、verify.sh exit=0（一時 HOME）。commit $sha（ブランチ $branch、worktree、未 push）。判定待ち。" >/dev/null
    gh issue edit "$num" --add-label "loop:review" --remove-label "loop:in-progress" >/dev/null
    echo "#$num: review ($sha, ${waited}s)"
  else
    (cd "$wt" && [ "$changed" -gt 0 ] && git add -A && git commit -q -m "loop #$num wip: verify.sh exit=$v_exit（並列ループ $STAMP、未判定）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>")
    gh issue comment "$num" --body "並列ループ $STAMP: 施工 exit=$oc_exit、verify.sh exit=$v_exit、変更 $changed 件。verify 末尾:
\`\`\`
$(tail -30 "$vout")
\`\`\`
blocked。" >/dev/null
    gh issue edit "$num" --add-label "loop:blocked" --remove-label "loop:in-progress" >/dev/null
    echo "#$num: blocked (verify=$v_exit, changed=$changed)"
  fi
}

for n in "$@"; do one "$n" & done
wait
echo "wave done: $*"
