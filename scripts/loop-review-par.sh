#!/usr/bin/env bash
# worktree で施工した Issue の判定を並列に回し、PASS を順に loop/integration へ merge する。
# 使い方: bash scripts/loop-review-par.sh <issue番号>...
#   判定（Haiku 図面検査 + Codex 判定役）は worktree ごとに並列。merge は本線で 1 件ずつ（衝突したら blocked にして人へ）。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); BASE="loop/integration"; LOG_DIR="$ROOT/.local/loop"
[ $# -gt 0 ] || { echo "issue numbers required"; exit 1; }

# 0. 機械検査（verify）は並列だと不安定（2026-10-19 23:30 に setup の試験が落ちた）ので、worktree ごとに順番に走らせて証拠にする
for n in "$@"; do
  wt="$ROOT/.local/wt/$n"; evf="$LOG_DIR/evidence-par-$n.log"
  { echo "== git rev-parse HEAD"; (cd "$wt" && git rev-parse HEAD)
    echo "== HOME=\$(mktemp -d) bash scripts/verify.sh (tail)"; (cd "$wt" && HOME=$(mktemp -d) bash scripts/verify.sh 2>&1 | tail -12; echo "exit=${PIPESTATUS[0]}")
  } > "$evf" 2>&1
  echo "#$n evidence: $(rg -o 'verify: exit=[0-9]+' "$evf" | tail -1)"
done
# 1. 判定だけ並列（merge は後で本線で 1 件ずつ）
for n in "$@"; do
  ( WT="$ROOT/.local/wt/$n" NO_MERGE=1 EVIDENCE_FILE="$LOG_DIR/evidence-par-$n.log" bash scripts/loop-review.sh "$n" > "$LOG_DIR/review-par-$n.out" 2>&1 ) &
done
wait

# 2. 結果を集め、PASS を順に merge
for n in "$@"; do
  v=$(rg -o -m1 "verdict: (PASS|FAIL|判定不能|none)" "$LOG_DIR/review-par-$n.out" | sed 's/verdict: //')
  echo "#$n: ${v:-?}"
  if [ "$v" = "PASS" ]; then
    branch="loop/$n"; sha=$(git rev-parse --short "$branch"); title=$(gh issue view "$n" --json title --jq .title)
    if git switch -q "$BASE" && git merge -q --no-ff "$branch" -m "merge loop/$n: ${title}（判定 PASS、${sha}）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"; then
      git switch -q main
      gh issue edit "$n" --remove-label "loop:review" >/dev/null
      gh issue close "$n" --comment "判定 PASS（Codex gpt-6-astra、版 ${sha}）。$BASE へ merge。" >/dev/null
      echo "#$n: merged"
    else
      git merge --abort 2>/dev/null; git switch -q main
      gh issue edit "$n" --add-label "loop:blocked" --remove-label "loop:review" >/dev/null
      gh issue comment "$n" --body "判定 PASS だが $BASE への merge が衝突。人の確認待ち（loop:blocked）。" >/dev/null
      echo "#$n: merge conflict -> blocked"
    fi
  elif [ -n "$v" ]; then
    gh issue edit "$n" --add-label "loop:blocked" --remove-label "loop:review" >/dev/null
  fi
done
