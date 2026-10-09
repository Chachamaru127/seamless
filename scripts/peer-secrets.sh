#!/usr/bin/env bash
# T2-6: the key and address values behind the names in ~/.seamless/peers.json must not be stored anywhere seamless or the AI
# products write: ~/.seamless, this repository, ~/.claude/projects, ~/.codex/sessions, ~/.grok/sessions.
# A value is read from the environment into a shell variable and goes to grep only through a pipe on standard input
# (printf is a builtin, so it never appears in any argument list). It is never echoed, written to a file or traced.
# Turn tracing off first: bash -x, or SHELLOPTS=xtrace in the environment, would print every value to standard error.
{ set +x; } 2>/dev/null
set -euo pipefail
# Compare bytes, not characters: under a UTF-8 locale grep skips a line that has an invalid byte, and a value on that line is missed.
export LC_ALL=C
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! slots="$(node "$here/peer-env-names.ts" 2>/dev/null)"; then
  echo "peer-secrets: 失敗（名簿が使えない）"; exit 1
fi
if [ -z "$slots" ]; then echo "peer-secrets: ok（登録なし）"; exit 0; fi
if ! root="$(git rev-parse --show-toplevel 2>/dev/null)" || ! root="$(cd "$root" && pwd -P)"; then
  echo "peer-secrets: 失敗（リポジトリの根元が分からない）"; exit 1
fi
# A linked worktree has its own root; the main checkout is the parent of the shared .git directory.
if ! common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || ! common="$(cd "$common" && pwd -P)"; then
  echo "peer-secrets: 失敗（リポジトリの本線が分からない）"; exit 1
fi
main=""
if [ "$(basename "$common")" = ".git" ]; then main="$(dirname "$common")"; fi
failed=0
dirs=() labels=()
if [ -n "$main" ] && [ "$main" != "$root" ]; then
  dirs+=("$main"); labels+=("リポジトリ（本線）")
  # A worktree inside the main checkout is already covered by scanning the main checkout.
  case "$root/" in "$main"/*) ;; *) dirs+=("$root"); labels+=("リポジトリ") ;; esac
else
  dirs+=("$root"); labels+=("リポジトリ")
fi
for spec in .seamless .claude/projects .codex/sessions .grok/sessions; do
  d="$HOME/$spec"
  if [ -e "$d" ]; then dirs+=("$d"); labels+=("~/$spec")
  elif [ -L "$d" ]; then echo "peer-secrets: 失敗（~/$spec は行き先のない symlink で、中を確認できない）"; failed=1
  fi
done
# `command` skips any shell function named grep; -a reads binary files as text; -S follows symbolic links (BSD grep: -r alone
# follows none, not even the directory named on the command line). A link that goes nowhere makes grep exit 2, which fails below.
scan() { command grep -rSqaF -f - "$@" 2>/dev/null; }
# The value of the environment variable named by $1, then the same value as a JSON encoder writes it inside a string
# (JSON.stringify, serde_json: \ " tab and CR escaped). Each added spelling costs a full pass over every stored session, so
# the spellings of rarer encoders (\/ and \u0026 for / & < >, \uXXXX for non-ASCII) are left out and the pass says so.
# A value copied from the Bot's field as "Bearer <key>" is sent as <key> (src/peers.ts keyOf), so <key> alone is looked for too.
emit() {
  local v="${!1:-}" bs='\' q='"' j k
  local -a forms=("$v")
  case "$v" in "Bearer "?*) forms+=("${v#Bearer }") ;; esac
  for k in "${forms[@]}"; do
    printf '%s\n' "$k"
    j=${k//"$bs"/"$bs$bs"}; j=${j//"$q"/"$bs$q"}; j=${j//$'\t'/"${bs}t"}; j=${j//$'\r'/"${bs}r"}
    if [ "$j" != "$k" ]; then printf '%s\n' "$j"; fi
  done
}
checked=() slotlabels=() unchecked=0
i=0
while IFS=$'\t' read -r reg role name; do
  if ! [[ $reg =~ ^[a-z0-9-]{1,63}$ && $role =~ ^(addressEnv|sendKeyEnv|receiveKeyEnv)$ ]]; then echo "peer-secrets: 失敗（名簿の出力の形が不正）"; failed=1; continue; fi
  label="$reg の $role"
  if ! [[ $name =~ ^[A-Z_][A-Z0-9_]{0,127}$ ]]; then echo "peer-secrets: 失敗（$label: 名前の形が不正）"; failed=1; continue; fi
  v="${!name:-}"
  if [ -z "$v" ]; then echo "peer-secrets: 失敗（$label: 未設定または空）"; failed=1; continue; fi
  case "$v" in
    *$'\n'*) echo "peer-secrets: 失敗（$label: 値に改行があり 1 行ずつ照合できない）"; failed=1; continue ;;
    *[!' '-'~']*|*['/&<>']*) unchecked=1 ;;
  esac
  checked+=("$name"); slotlabels[i]="$label"; i=$((i+1))
done <<<"$slots"
v=""
if [ "${#checked[@]}" -gt 0 ]; then
  # One pass over everything with all the values as patterns; only a hit leads to the per-name passes that say which one.
  rc=0
  { for name in "${checked[@]}"; do emit "$name"; done; } | scan "${dirs[@]}" || rc=$?
  case $rc in
    1) ;;
    0)
      failed=1
      for ((k=0; k<${#checked[@]}; k++)); do
        for ((m=0; m<${#dirs[@]}; m++)); do
          r=0; emit "${checked[k]}" | scan "${dirs[m]}" || r=$?
          case $r in 0) echo "peer-secrets: 失敗（${slotlabels[k]}: ${labels[m]} に残っている）" ;; 1) ;; *) echo "peer-secrets: 失敗（${slotlabels[k]}: ${labels[m]} を確認できない）" ;; esac
        done
      done ;;
    *) failed=1; echo "peer-secrets: 失敗（保存先を確認できない）" ;;
  esac
fi
if [ "$failed" -ne 0 ]; then exit 1; fi
echo "peer-secrets: ok"
if [ "$unchecked" -ne 0 ]; then echo "peer-secrets: 注記（非 ASCII の文字を \\uXXXX に、「/」を \\/ に、「&」「<」「>」を \\u0026 などに書き換えた形は照合していない）"; fi
