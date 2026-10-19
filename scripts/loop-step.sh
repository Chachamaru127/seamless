#!/usr/bin/env bash
# 30 分ループの 1 回分（H7）。Plans.md 6 章の決まりを機械的に行う。
# 使い方: bash scripts/loop-step.sh [--dry-run]
#   1. loop:in-progress が 1 件でもあれば状態を出して終わる（二重起動の回避）
#   2. loop:ready の最も番号が若い Issue を 1 件取り、loop:in-progress を付ける
#   3. 作業ブランチ loop/<番号> を main から作る（既にあれば使う）
#   4. 施工役 opencode（ollama-cloud/deepseek-v4.1-flash:1017、--agent build --auto）に依頼する
#   5. bash scripts/verify.sh を走らせる。0 なら commit して Issue を閉じる。非 0 なら loop:blocked
# push、PR、公開はしない。main には commit しない。
set -uo pipefail
cd "$(dirname "$0")/.."
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
LOG_DIR=".local/loop"; mkdir -p "$LOG_DIR"
STAMP=$(date +%Y%m%dT%H%M%S)
BASE="loop/integration"
LOCK="$LOG_DIR/lock"; PAUSED="$LOG_DIR/paused"; STREAK="$LOG_DIR/blocked-streak"

if [ -f "$PAUSED" ]; then echo "loop: 休止中（$PAUSED を人が外すまで取らない）: $(cat "$PAUSED")"; exit 0; fi
if ! mkdir "$LOCK" 2>/dev/null; then echo "loop: 別の実行がロック中（${LOCK}）。今回は取らない"; exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
git show-ref --verify --quiet "refs/heads/$BASE" || git branch "$BASE" main

# 90 分を超えた in-progress は blocked へ落とす（S8）
now=$(date +%s)
for n in $(gh issue list --label "loop:in-progress" --state open --json number --jq '.[].number'); do
  started=$(gh issue view "$n" --json timelineItems 2>/dev/null | python3 -I -c 'import json,sys,datetime
d=json.load(sys.stdin); ts=[i.get("createdAt") for i in d.get("timelineItems",[]) if i.get("__typename")=="LabeledEvent" and i.get("label",{}).get("name")=="loop:in-progress"]
print(ts[-1] if ts else "")' 2>/dev/null)
  if [ -n "$started" ]; then
    st=$(python3 -I -c "import datetime,sys;print(int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).timestamp()))" "$started")
    if [ $((now - st)) -gt 5400 ]; then
      gh issue edit "$n" --add-label "loop:blocked" --remove-label "loop:in-progress" >/dev/null
      gh issue comment "$n" --body "ループ $STAMP: 着手から 90 分を超えたため blocked にした（S8）。" >/dev/null
      echo "loop: #$n を 90 分超で blocked にした"
    fi
  fi
done

inprog=$(gh issue list --label "loop:in-progress" --state open --json number --jq 'length')
if [ "${inprog:-0}" -gt 0 ]; then
  echo "loop: in-progress が ${inprog} 件あるので今回は取らない"; gh issue list --label "loop:in-progress" --state open; exit 0
fi
# Depends-on: #n がすべて閉じている loop:ready の最も若い番号
num=""
for n in $(gh issue list --label "loop:ready" --state open --limit 100 --json number --jq 'sort_by(.number) | .[].number'); do
  deps=$(gh issue view "$n" --json body --jq .body | rg -o -i 'Depends-on:[^\n]*' | rg -o '#[0-9]+' | tr -d '#')
  ok=1
  for d in $deps; do
    st=$(gh issue view "$d" --json state --jq .state 2>/dev/null || echo UNKNOWN)
    [ "$st" = "CLOSED" ] || { ok=0; break; }
  done
  [ "$ok" = 1 ] && { num="$n"; break; }
done
if [ -z "$num" ]; then echo "loop: 依存が解けた loop:ready の Issue なし"; exit 0; fi
title=$(gh issue view "$num" --json title --jq .title)
body=$(gh issue view "$num" --json body --jq .body)
echo "loop: 取る Issue #$num $title"
[ "$DRY" = 1 ] && { echo "(dry-run) ここで止まる"; exit 0; }

gh issue edit "$num" --add-label "loop:in-progress" --remove-label "loop:ready" >/dev/null
git stash list >/dev/null
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "loop: 作業ツリーに未コミットの変更がある。止める（S8）"; gh issue comment "$num" --body "ループ: 作業ツリーが汚れているため着手できず。人の確認待ち（S8）。"; gh issue edit "$num" --add-label "loop:ready" --remove-label "loop:in-progress" >/dev/null; echo "作業ツリーが汚れている（${STAMP}）" > "$PAUSED"; exit 1
fi
branch="loop/$num"
git switch -q "$branch" 2>/dev/null || git switch -q -c "$branch" "$BASE"

req="$LOG_DIR/$STAMP-issue-$num-request.md"
cat > "$req" <<EOF
# 施工依頼（Issue #${num}）
$title

$body

## 契約
- 目的: 上の Done when を満たす。Done when 以外の範囲を広げない。
- 対象の版: ブランチ ${branch}（$BASE からの作業ブランチ）。
- 承認済みの操作: このリポジトリの中のファイルの追加と変更、\`bash scripts/verify.sh\` の実行、\`node --test\` の実行。
- 禁止: \`~/\` 直下の設定ファイル、Keychain、本物の Claude / Codex / Grok Bot への送信、外部への通信、git commit / push、\`.local/\` の変更、specs/ の変更（tasks.md の進捗欄も変えない）。
- 終わり方: Done when を満たしたら止める。最後に \`bash scripts/verify.sh\` を走らせ、その終了コードと、変更したファイルの一覧を出力の末尾に書く。途中の報告だけで終えない。
- 判定の線: 完了は verify.sh の終了コード 0 と、Done when の各条件が Yes になること。自己申告は完了にしない。
EOF
out="$LOG_DIR/$STAMP-issue-$num-opencode.log"
echo "loop: opencode を起動（ログ ${out}）"
# 見張り: 施工役が 20 分で終わらなければ止める（出力が 0 バイトのまま固まることがあった。2026-10-19 #2）
opencode run --model ollama-cloud/deepseek-v4.1-flash:1017 --agent build --auto "$(cat "$req")" > "$out" 2>&1 &
oc_pid=$!
waited=0
while kill -0 "$oc_pid" 2>/dev/null; do
  sleep 10; waited=$((waited+10))
  if [ "$waited" -ge 1200 ]; then echo "loop: 施工役が 20 分で終わらないので止める" | tee -a "$out"; kill "$oc_pid" 2>/dev/null; sleep 2; kill -9 "$oc_pid" 2>/dev/null; break; fi
done
wait "$oc_pid" 2>/dev/null; oc_exit=$?
echo "loop: 施工の出力 $(wc -c < "$out") バイト、経過 ${waited} 秒"
echo "loop: opencode exit=$oc_exit"

vout="$LOG_DIR/$STAMP-issue-$num-verify.log"
bash scripts/verify.sh > "$vout" 2>&1; v_exit=$?
echo "loop: verify exit=$v_exit"
changed=$(git status --porcelain | wc -l | tr -d ' ')

if [ "$v_exit" = 0 ] && [ "$changed" -gt 0 ]; then
  git add -A
  git commit -q -m "loop #$num: $title

verify.sh exit=0（ループ ${STAMP}）。施工: opencode deepseek-v4.1-flash:1017。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
  sha=$(git rev-parse --short HEAD)
  gh issue comment "$num" --body "ループ $STAMP: 施工 opencode（deepseek-v4.1-flash:1017）exit=${oc_exit}、verify.sh exit=0。commit ${sha}（ブランチ ${branch}、未 push）。判定待ち（team-review、別家系、同じ commit で Done when を確かめる）。PASS で閉じて $BASE へ merge。" >/dev/null
  gh issue edit "$num" --add-label "loop:review" --remove-label "loop:in-progress" >/dev/null
  rm -f "$STREAK"
  echo "loop: #$num を判定待ちにした（${sha}）"
else
  tail -40 "$vout" > "$LOG_DIR/$STAMP-issue-$num-verify-tail.log"
  gh issue comment "$num" --body "ループ $STAMP: 施工 exit=${oc_exit}、verify.sh exit=${v_exit}、変更ファイル $changed 件。verify の末尾:
\`\`\`
$(tail -40 "$vout")
\`\`\`
ブランチ $branch に未コミットのまま残す。人の確認待ち（loop:blocked）。" >/dev/null
  gh issue edit "$num" --add-label "loop:blocked" --remove-label "loop:in-progress" >/dev/null
  if [ "$changed" -gt 0 ]; then
    git add -A
    git commit -q -m "loop #$num wip: verify.sh exit=${v_exit}（ループ ${STAMP}、未判定）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
  fi
  echo "loop: #$num を blocked にした（ブランチ $branch に wip commit）"
  c=$(( $(cat "$STREAK" 2>/dev/null || echo 0) + 1 )); echo "$c" > "$STREAK"
  if [ "$c" -ge 3 ]; then echo "連続 $c 回 blocked（${STAMP}）" > "$PAUSED"; echo "loop: 連続 3 回 blocked。休止の印を置いた（S8）"; fi
fi
git switch -q main 2>/dev/null || true
