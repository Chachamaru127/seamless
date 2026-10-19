#!/usr/bin/env bash
# T2-6: the key and address values behind the names in ~/.seamless/peers.json must not be stored anywhere seamless or the AI
# products write. By default that is the repository (main checkout and worktree) and ~/.seamless, which takes seconds. With
# SEAMLESS_PEER_SECRETS_FULL=1 it is also the three products' conversation stores, ~/.claude/projects, ~/.codex/sessions and
# ~/.grok/sessions, which is tens of gigabytes and takes about ten minutes once a registration exists (specs/202610-more-peers
# evidence T2-1, T2-6); the default pass says that it did not look there.
# A value is read the way the program reads it (src/secrets.ts): the environment variable of that name when it is not empty,
# otherwise the macOS Keychain (generic password, service "seamless", account = the name), whose value comes back on standard
# output only. It is kept in a shell variable and goes to grep only through a pipe on standard input (printf is a builtin, so it
# never appears in any argument list). It is never echoed, written to a file or traced.
# Turn tracing off first: bash -x, or SHELLOPTS=xtrace in the environment, would print every value to standard error.
{ set +x; } 2>/dev/null
set -euo pipefail
# Compare bytes, not characters: under a UTF-8 locale grep skips a line that has an invalid byte, and a value on that line is missed.
export LC_ALL=C
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failed=0
if root="$(git rev-parse --show-toplevel 2>/dev/null)" && root="$(cd "$root" && pwd -P)"; then have_root=1; else have_root=0; fi
# AC12: the files `npm pack` would ship must not carry the account identifiers. These are labels, not roster values, so the
# pass needs no registration and prints nothing when clean. It runs even on a machine without one, so the tarball is still
# checked. Without a git root there is no package to list; that only matters below when a roster exists.
# `npm pack --dry-run` lists exactly what a publish would ship; --ignore-scripts keeps the pass inert.
release_surface() {
  [ -f "$root/package.json" ] || return 0
  if ! command -v npm >/dev/null 2>&1; then echo "peer-secrets: 失敗（npm が無く、同梱物の一覧を作れない）"; return 1; fi
  local listing p bad=0
  if ! listing="$(cd "$root" && npm pack --dry-run --json --ignore-scripts 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}const f=j[0]?.files;if(!Array.isArray(f))process.exit(2);for(const x of f)if(typeof x?.path==="string")console.log(x.path)});')"; then
    echo "peer-secrets: 失敗（同梱物の一覧を作れない）"; return 1
  fi
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      *grok-bot-vm*|*"Bot ID"*|*accountRef*) echo "peer-secrets: 失敗（同梱物の名前にアカウント情報の目印: $p）"; bad=1; continue ;;
    esac
    [ -f "$root/$p" ] || continue
    if command grep -aqF -e 'grok-bot-vm' -e 'Bot ID' -e 'accountRef' -- "$root/$p" 2>/dev/null; then
      echo "peer-secrets: 失敗（同梱物にアカウント情報の目印: $p）"; bad=1
    fi
  done <<<"$listing"
  return "$bad"
}
if [ "$have_root" -eq 1 ]; then release_surface || failed=1; fi
if ! slots="$(node "$here/peer-env-names.ts" 2>/dev/null)"; then
  echo "peer-secrets: 失敗（名簿が使えない）"; exit 1
fi
if [ -z "$slots" ]; then
  if [ "$failed" -ne 0 ]; then exit 1; fi
  echo "peer-secrets: ok（登録なし）"; exit 0
fi
if [ "$have_root" -ne 1 ]; then
  echo "peer-secrets: 失敗（リポジトリの根元が分からない）"; exit 1
fi
# A linked worktree has its own root; the main checkout is the parent of the shared .git directory.
if ! common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || ! common="$(cd "$common" && pwd -P)"; then
  echo "peer-secrets: 失敗（リポジトリの本線が分からない）"; exit 1
fi
main=""
if [ "$(basename "$common")" = ".git" ]; then main="$(dirname "$common")"; fi
dirs=() labels=()
if [ -n "$main" ] && [ "$main" != "$root" ]; then
  dirs+=("$main"); labels+=("リポジトリ（本線）")
  # A worktree inside the main checkout is already covered by scanning the main checkout.
  case "$root/" in "$main"/*) ;; *) dirs+=("$root"); labels+=("リポジトリ") ;; esac
else
  dirs+=("$root"); labels+=("リポジトリ")
fi
full=0
if [ "${SEAMLESS_PEER_SECRETS_FULL:-}" = 1 ]; then full=1; fi
places=(.seamless)
if [ "$full" -eq 1 ]; then places+=(.claude/projects .codex/sessions .grok/sessions); fi
for spec in "${places[@]}"; do
  d="$HOME/$spec"
  if [ -e "$d" ]; then dirs+=("$d"); labels+=("~/$spec")
  elif [ -L "$d" ]; then echo "peer-secrets: 失敗（~/$spec は行き先のない symlink で、中を確認できない）"; failed=1
  fi
done
# `command` skips any shell function named grep; -a reads binary files as text; -S follows symbolic links (BSD grep: -r alone
# follows none, not even the directory named on the command line). A link that goes nowhere makes grep exit 2, which fails below.
scan() { command grep -rSqaF -f - "$@" 2>/dev/null; }
# The value $1, then the same value as a JSON encoder writes it inside a string
# (JSON.stringify, serde_json: \ " tab and CR escaped). Each added spelling costs a full pass over every stored session, so
# the spellings of rarer encoders (\/ and \u0026 for / & < >, \uXXXX for non-ASCII) are left out and the pass says so.
# A value copied from the Bot's field as "Bearer <key>" is sent as <key> (src/peers.ts keyOf), so <key> alone is looked for too.
emit() {
  local v="$1" bs='\' q='"' j k
  local -a forms=("$v")
  case "$v" in "Bearer "?*) forms+=("${v#Bearer }") ;; esac
  for k in "${forms[@]}"; do
    printf '%s\n' "$k"
    j=${k//"$bs"/"$bs$bs"}; j=${j//"$q"/"$bs$q"}; j=${j//$'\t'/"${bs}t"}; j=${j//$'\r'/"${bs}r"}
    if [ "$j" != "$k" ]; then printf '%s\n' "$j"; fi
  done
}
# Seconds a Keychain lookup may take (SEAMLESS_SECURITY_TIMEOUT, 1 to 999; 5 otherwise).
secs=5
if [[ ${SEAMLESS_SECURITY_TIMEOUT:-} =~ ^[1-9][0-9]{0,2}$ ]]; then secs="$SEAMLESS_SECURITY_TIMEOUT"; fi
vals=() slotlabels=() unchecked=0
i=0
while IFS=$'\t' read -r reg role name; do
  if ! [[ $reg =~ ^[a-z0-9-]{1,63}$ && $role =~ ^(addressEnv|sendKeyEnv|receiveKeyEnv)$ ]]; then echo "peer-secrets: 失敗（名簿の出力の形が不正）"; failed=1; continue; fi
  label="$reg の $role"
  if ! [[ $name =~ ^[A-Z_][A-Z0-9_]{0,127}$ ]]; then echo "peer-secrets: 失敗（$label: 名前の形が不正）"; failed=1; continue; fi
  v="${!name:-}"
  # Not in the environment: the Keychain. The value is taken from standard output into the variable and shown nowhere; a missing
  # item, a locked Keychain or no security command at all leaves it empty, and the exit status says which (44: no such item). The
  # lookup is cut off after $secs seconds where perl is there to do it (alarm survives exec: the status is then 142).
  rc=0
  if [ -z "$v" ]; then
    if command -v perl >/dev/null 2>&1; then v="$(perl -e 'alarm shift; exec @ARGV or exit 127' "$secs" security find-generic-password -s seamless -a "$name" -w 2>/dev/null)" || rc=$?
    else v="$(security find-generic-password -s seamless -a "$name" -w 2>/dev/null)" || rc=$?; fi
    if [ "$rc" -ne 0 ]; then v=""; fi
  fi
  if [ -z "$v" ]; then
    case $rc in
      0|44) why="未設定または空。環境変数にも Keychain にも無い" ;;
      142) why="Keychain が $secs 秒以内に答えなかった" ;;
      127) why="security コマンドを実行できない" ;;
      *) why="Keychain を読めなかった（終了 $rc）" ;;
    esac
    echo "peer-secrets: 失敗（$label: $why）"; failed=1; continue
  fi
  case "$v" in
    *$'\n'*) echo "peer-secrets: 失敗（$label: 値に改行があり 1 行ずつ照合できない）"; failed=1; continue ;;
    *[!' '-'~']*|*['/&<>']*) unchecked=1 ;;
  esac
  vals[i]="$v"; slotlabels[i]="$label"; i=$((i+1))
done <<<"$slots"
v=""
if [ "${#vals[@]}" -gt 0 ]; then
  # One pass over everything with all the values as patterns; only a hit leads to the per-name passes that say which one.
  rc=0
  { for ((k=0; k<${#vals[@]}; k++)); do emit "${vals[k]}"; done; } | scan "${dirs[@]}" || rc=$?
  case $rc in
    1) ;;
    0)
      failed=1
      for ((k=0; k<${#vals[@]}; k++)); do
        for ((m=0; m<${#dirs[@]}; m++)); do
          r=0; emit "${vals[k]}" | scan "${dirs[m]}" || r=$?
          case $r in 0) echo "peer-secrets: 失敗（${slotlabels[k]}: ${labels[m]} に残っている）" ;; 1) ;; *) echo "peer-secrets: 失敗（${slotlabels[k]}: ${labels[m]} を確認できない）" ;; esac
        done
      done ;;
    *) failed=1; echo "peer-secrets: 失敗（保存先を確認できない）" ;;
  esac
fi
if [ "$failed" -ne 0 ]; then exit 1; fi
echo "peer-secrets: ok"
if [ "$full" -eq 0 ]; then echo "peer-secrets: 注記（会話の保存先 ~/.claude/projects、~/.codex/sessions、~/.grok/sessions は照合していない。SEAMLESS_PEER_SECRETS_FULL=1 で照合する）"; fi
if [ "$unchecked" -ne 0 ]; then echo "peer-secrets: 注記（非 ASCII の文字を \\uXXXX に、「/」を \\/ に、「&」「<」「>」を \\u0026 などに書き換えた形は照合していない）"; fi
