#!/usr/bin/env bash
# One run registers a Grok Bot on this Mac (default: chachamaru, 茶々丸, every place: a Bot works across projects).
#   bash scripts/peer-setup.sh [--rotate] [--bot-id <the Bot's UUID>] [registration name] [display name] [scope folder]
# --bot-id adds the Bot's own UUID to the row (src/bot-executor.ts uses it when the Bot sends from its chat); it never replaces one.
# A new registration gets the display name 茶々丸 and the scope "all" (every place) unless a folder is given. A registration that is in the roster keeps what
# the owner decided (scope, whether it may send, display name, key version) unless a folder or a name is given; it is said before anything is
# asked. A revoked registration is not touched without --rotate, which makes a new receive key and a new key version and lifts the revocation.
# 1. Asks you to copy the Webhook URL, waits (2 minutes) for a newly copied https:// text, keeps it in the Keychain.
# 2. Asks you to copy the Authorization header value, waits for a newly copied text ("Bearer <key>" or the key alone), keeps the key.
# 3. Makes the receive key (openssl rand -hex 32) and keeps it, unless one is already there; --rotate makes a new one. Whenever a new
#    receive key is made for a registration that is already in the roster, its key version goes up by one.
# 4. Adds the registration to ~/.seamless/peers.json (private folder 0700, file 0600), or updates the row of the same name; the
#    other registrations stay.
# The address shown after it is kept is its host only (the rest of it is a secret). The values live in the Keychain only (generic password, service "seamless", account SEAMLESS_<NAME>_URL, _SEND_KEY, _RECV_KEY), where
# seamless reads them when the environment has none (src/secrets.ts). The clipboard is emptied after each value. Only names and lengths
# are shown. A value is in an argument list for the moment of `security add-generic-password -w`, as in experiments/dot-m1/save-key.sh,
# and nowhere else; it is never echoed, written to a file or traced.
# Turn tracing off first: bash -x, or SHELLOPTS=xtrace in the environment, would print every value to standard error.
{ set +x; } 2>/dev/null
set -euo pipefail
# Visible ASCII is the only text a key or an address can be made of here, and the character classes below must mean the same everywhere.
export LC_ALL=C
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
usage() { echo "使い方: bash scripts/peer-setup.sh [--rotate] [--bot-id <Bot の UUID>] [登録名] [表示名] [範囲のフォルダ]（省略時: 既存の登録はその表示名と範囲のまま、新規は 茶々丸 と すべての場所。フォルダを渡すとそこだけ）" >&2; exit 2; }
rotate=0; args=(); botid=""; want_id=0
for a in "$@"; do
  if [ "$want_id" -eq 1 ]; then
    want_id=0
    if ! [[ $a =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then echo "peer-setup: --bot-id は Bot の UUID（小文字の 8-4-4-4-12 桁）にしてください" >&2; exit 1; fi
    botid="$a"; continue
  fi
  case "$a" in
    --rotate) rotate=1 ;;
    --bot-id) want_id=1 ;;
    -*) usage ;;
    *) args+=("$a") ;;
  esac
done
if [ "$want_id" -eq 1 ]; then usage; fi
if [ "${#args[@]}" -gt 3 ]; then usage; fi
# Not given is empty here; the defaults (and what an existing row keeps) are decided in peer-roster-write.ts. Given but empty is a mistake.
name="${args[0]-chachamaru}"; display="${args[1]-}"; root="${args[2]-}"
if [ "${#args[@]}" -ge 2 ] && [ -z "$display" ]; then echo "peer-setup: 表示名が空です" >&2; exit 1; fi
if [ "${#args[@]}" -ge 3 ] && [ -z "$root" ]; then echo "peer-setup: 範囲のフォルダが空です" >&2; exit 1; fi
if ! [[ $name =~ ^[a-z0-9-]{1,63}$ ]]; then echo "peer-setup: 登録名は小文字・数字・ハイフンの 1〜63 文字にしてください" >&2; exit 1; fi
upper="$(printf '%s' "$name" | tr 'a-z-' 'A-Z_')"
urlname="SEAMLESS_${upper}_URL"; sendname="SEAMLESS_${upper}_SEND_KEY"; recvname="SEAMLESS_${upper}_RECV_KEY"
# Everything that can be checked without a value is checked first: the folder, the display name, whether the roster can be used and
# whether this registration would be valid in it. Nothing is asked for until then.
if ! node "$here/peer-roster-write.ts" check "$name" "$display" "$root" "$urlname" "$sendname" "$recvname" "$rotate" "$botid"; then
  echo "peer-setup: 名簿、引数、または登録の状態に問題があり、何も変更していません（上の理由を直してください）" >&2; exit 1
fi
had_recv=0
if security find-generic-password -s seamless -a "$recvname" >/dev/null 2>&1; then had_recv=1; fi

# Waits for a newly copied text of the given kind and leaves it in $got (and, for an address, its host in $host); returns 1 after two
# minutes. A text that was already on the clipboard when the wait began does not count. A copy that does not fit is passed over, and said
# once without being shown.
got=""; host=""; passed=0
host_re='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'
wait_copy() {
  local kind="$1" first c k a i
  first="$(pbpaste 2>/dev/null || true)"
  for ((i=0; i<120; i++)); do
    c="$(pbpaste 2>/dev/null || true)"
    if [[ $c != "$first" && -n $c ]]; then
      case "$kind" in
        url)
          # https, no space, and a host of letters, digits, dots and hyphens with no user part: what follows the host is the secret.
          if [[ $c == https://* && $c != *[[:space:]]* && ${#c} -le 2048 ]]; then
            a="${c#https://}"; a="${a%%[/?#]*}"
            if [[ $a =~ $host_re ]]; then got="$c"; host="${a%%:*}"; return 0; fi
          fi ;;
        header)
          k="$c"; if [[ $k == "Bearer "* ]]; then k="${k#Bearer }"; fi
          # One visible token of 16 characters or more, and not an address: a second copy of the URL is not the key.
          if [[ ${#k} -ge 16 && $k != *[![:graph:]]* && $k != https://* && ${#k} -le 2048 ]]; then got="$k"; return 0; fi ;;
      esac
      if [ "$passed" -eq 0 ]; then echo "形が合わないコピーは使わない（待ち続ける）"; passed=1; fi
    fi
    sleep 1
  done
  return 1
}
# Keeps $got in the Keychain under the account $1, empties the clipboard, forgets the value.
keep() {
  if ! security add-generic-password -U -s seamless -a "$1" -w "$got" >/dev/null 2>&1; then
    pbcopy </dev/null 2>/dev/null || true
    echo "peer-setup: Keychain に保存できませんでした（$1）" >&2; exit 1
  fi
  pbcopy </dev/null
  echo "保存した: $1（${#got} 文字）"
  got=""
}

echo "Webhook URL をコピーしてください（2 分待ちます）"
if ! wait_copy url; then echo "peer-setup: 2 分以内に新しくコピーされた https:// の文字列が見つかりませんでした。同じ文字列がすでにクリップボードにある場合は、別の文字列を一度コピーしてから、もう一度コピーしてください。それでも駄目なら、もう一度実行してください" >&2; exit 1; fi
keep "$urlname"
echo "宛先のホスト: $host（Bot の宛先と違うときは、Keychain の $urlname を消してから、もう一度実行してください）"
passed=0
echo "Authorization header の値をコピーしてください（Bearer 付きでも鍵だけでもよい。2 分待ちます）"
if ! wait_copy header; then echo "peer-setup: 2 分以内に新しくコピーされた鍵（16 文字以上）が見つかりませんでした。もう一度実行してください（Webhook URL は保存済みです）" >&2; exit 1; fi
keep "$sendname"

newkey=0
if [ "$had_recv" -eq 1 ] && [ "$rotate" -eq 0 ]; then
  echo "受信鍵: 既存をそのまま使う（$recvname）"
else
  got="$(openssl rand -hex 32)"
  if ! [[ $got =~ ^[0-9a-f]{64}$ ]]; then got=""; echo "peer-setup: 受信鍵を作れませんでした" >&2; exit 1; fi
  if ! security add-generic-password -U -s seamless -a "$recvname" -w "$got" >/dev/null 2>&1; then got=""; echo "peer-setup: Keychain に保存できませんでした（$recvname）" >&2; exit 1; fi
  echo "受信鍵: 作った（$recvname、${#got} 文字）"
  got=""
  newkey=1
fi
summary="$(node "$here/peer-roster-write.ts" put "$name" "$display" "$root" "$urlname" "$sendname" "$recvname" "$rotate" "$newkey" "$botid")"
read -r _ _ version scope <<<"$summary"
echo "名簿: ~/.seamless/peers.json に $name を登録した（keyVersion $version、範囲 $scope）"
echo "クリップボードは空にした"
