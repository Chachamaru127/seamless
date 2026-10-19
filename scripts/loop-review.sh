#!/usr/bin/env bash
# loop:review の Issue を 1 件判定する（Plans.md 6 章）。
# 使い方: bash scripts/loop-review.sh <issue番号>
#   1. ブランチ loop/<番号> の HEAD と loop/integration の差分を取る
#   2. 図面検査（Claude Haiku 5.5、読み取り）: Issue の Done when と差分の食い違い
#   3. 判定役（Codex gpt-6-astra、読み取り）: Done when を同じ版で確かめ PASS / FAIL
#   4. PASS なら Issue を閉じて loop/integration へ --no-ff で merge。FAIL なら loop:blocked
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)
num="${1:?issue number}"
BASE="loop/integration"; LOG_DIR=".local/loop"; mkdir -p "$LOG_DIR"
STAMP=$(date +%Y%m%dT%H%M%S); branch="loop/$num"
git show-ref --verify --quiet "refs/heads/$branch" || { echo "no branch $branch"; exit 1; }
sha=$(git rev-parse --short "$branch")
title=$(gh issue view "$num" --json title --jq .title)
body=$(gh issue view "$num" --json body --jq .body)
done_when=$(printf '%s' "$body" | awk '/^## Done when/{f=1;next}/^## /{f=0}f')
diff_file="$ROOT_DIR/$LOG_DIR/$STAMP-issue-$num-diff.patch"
git diff "$BASE...$branch" > "$diff_file"
stat=$(git diff --stat "$BASE...$branch" | tail -1)

req="$ROOT_DIR/$LOG_DIR/$STAMP-issue-$num-review-request.md"
cat > "$req" <<EOF
# 判定依頼（Issue #$num: ${title}）
対象の版: ブランチ ${branch}（${sha}）。基点: ${BASE}。差分は $PWD/${diff_file}（${stat}）。
読み取り専用。ファイルを変更しない。

## 確かめること（Yes / No。番号ごとに答える）
$done_when

## 判定の線
- すべて Yes なら PASS。1 つでも No なら FAIL とし、No の番号と理由を書く。判定できない項目は「判定不能」と書き、その理由を書く。
- 施工役の自己申告（Issue のコメントや commit message）は根拠にしない。差分とファイルの中身、実行できる検査の出力だけを根拠にする。
- 実行してよいもの: \`git diff\`、\`git show\`、ファイルの読取り、\`bash scripts/verify.sh\`（Keychain を読まない）、\`node --test\`、\`rg\`。
- 実行してはいけないもの: ファイルの変更、commit、~/ の設定の読み書き、本物の送信、外部通信。

## 返し方
先頭に PASS / FAIL / 判定不能。次に番号ごとの Yes / No と根拠 1 行。最後に「残件」（Done when の外で気づいた穴。判定には使わない）。日本語、1,500 字以内。
EOF

# 作業ツリーを判定対象の版にする（判定役が実行検査できるように）。WT が指定されていれば worktree で判定する
cur=$(git branch --show-current)
if [ -n "${WT:-}" ]; then
  cd "$WT" || exit 2
else
  if ! git diff --quiet || ! git diff --cached --quiet; then echo "作業ツリーが汚れている。判定を中止"; exit 2; fi
  git switch -q "$branch"
fi

# 判定役の環境は読み取り専用で実行検査ができないことがある。リーダーが同じ版で機械検査を走らせ、出力を証拠として渡す。
ev="$ROOT_DIR/$LOG_DIR/$STAMP-issue-$num-evidence.log"
if [ -n "${EVIDENCE_FILE:-}" ] && [ -s "$EVIDENCE_FILE" ]; then cp "$EVIDENCE_FILE" "$ev"; else
{
  echo "== git rev-parse HEAD"; git rev-parse HEAD
  echo "== HOME=\$(mktemp -d) bash scripts/verify.sh (tail)"; HOME=$(mktemp -d) bash scripts/verify.sh 2>&1 | tail -12; echo "exit=${PIPESTATUS[0]}"
  echo "== node --test の件数行"; rg -n "^ℹ (tests|pass|fail)" "$ev" 2>/dev/null || true
} > "$ev" 2>&1
fi
cat >> "$req" <<EOF2

## リーダーが同じ版（${sha}）で走らせた機械検査の出力（証拠。施工役の自己申告ではない）
\`\`\`
$(cat "$ev" | tail -40)
\`\`\`
判定役が自分で実行できない項目は、この出力と差分を根拠に判定してよい。出力に無い項目は「判定不能」ではなく、差分とファイルの中身から判定する。
EOF2

haiku="$ROOT_DIR/$LOG_DIR/$STAMP-issue-$num-haiku.md"
{ echo "あなたは図面検査役です。Issue の Done when と差分の食い違いだけを、行間を読まずに挙げてください。合格を出さず、食い違いの一覧（無ければ「食い違いなし」）を返してください。"; echo; cat "$req"; } \
  | claude-headless -p --model claude-haiku-5-5 --effort medium --permission-mode plan --tools Read,Glob,Grep,Bash --strict-mcp-config > "$haiku" 2>"$haiku.err"
echo "haiku: exit=$? ($haiku)"

judge="$ROOT_DIR/$LOG_DIR/$STAMP-issue-$num-judge.md"
codex-headless exec -s read-only -m gpt-6-astra -c 'model_reasoning_effort="high"' "あなたは判定役です。作った家系（DeepSeek、opencode）と別の家系として、同じ版で Done when を確かめてください。
$(cat "$req")" </dev/null > "$judge" 2>"$judge.err"
echo "judge: exit=$? ($judge)"
if [ -z "${WT:-}" ]; then git switch -q "$cur"; else cd "$ROOT_DIR"; fi

verdict=$(head -c 400 "$judge" | rg -o -m1 "PASS|FAIL|判定不能" | head -1)
echo "verdict: ${verdict:-none}"
summary="判定 ${STAMP}（版 ${sha}）: 図面検査 Haiku 5.5 → $(head -c 300 "$haiku" | LC_ALL=C tr '\n' ' ')
判定役 Codex gpt-6-astra → ${verdict:-不明}
$(head -c 1200 "$judge")"
gh issue comment "$num" --body "$summary" >/dev/null
if [ -n "${NO_MERGE:-}" ]; then
  echo "NO_MERGE: 判定だけ（${verdict}）"; exit 0
fi
if [ "$verdict" = "PASS" ]; then
  git switch -q "$BASE" && git merge -q --no-ff "$branch" -m "merge loop/$num: ${title}（判定 PASS、${sha}）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git switch -q "$cur"
  gh issue edit "$num" --remove-label "loop:review" >/dev/null
  gh issue close "$num" --comment "判定 PASS（Codex gpt-6-astra、版 ${sha}）。$BASE へ merge。" >/dev/null
  echo "merged #$num into $BASE"
else
  gh issue edit "$num" --add-label "loop:blocked" --remove-label "loop:review" >/dev/null
  echo "#$num -> loop:blocked"
fi
