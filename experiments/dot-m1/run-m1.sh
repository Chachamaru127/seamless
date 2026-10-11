#!/bin/bash
# M1 の測定（specs/202610-more-peers T3-14）で、立花さんが自分の端末から起動する。測定専用で、本体、CLI、常用設定からは呼ばれない。
# 使い方: bash experiments/dot-m1/run-m1.sh tools|notools|notify    止めるときは Ctrl-C。notify は M2（購読を受理し、callback へ通知を 1 件送る）。
# 鍵と tunnel ID は Keychain（サービス名 seamless-dot-m1）から読み、tunnel-client の環境にだけ渡す。画面、引数、ファイルには出さない。
# pro-review 用の tunnel-client（~/.pro-review/bin、設定は ~/.config/tunnel-client）には触らない。
set -euo pipefail
set +x
state="$HOME/LocalWork/Code/seamless/.local/dot-m1"
bin=/opt/homebrew/bin/tunnel-client
# A folder only this user can use: checked before anything is made inside it, and made 0700 when it does not exist.
private_dir(){
 if [[ ! -e $1 && ! -L $1 ]]; then mkdir -m 700 "$1" || return 1; fi
 [[ -d $1 && ! -L $1 && $(stat -f %Lp "$1") == 700 && $(stat -f %u "$1") == "$(id -u)" ]]
}
case "${1:-}" in
 tools) script=stub.ts; extra=''; log=m1-tools.jsonl;;
 notools) script=stub.ts; extra=' --no-tools'; log=m1-notools.jsonl;;
 notify) script=../dot-m2/notify.ts; extra=''; log=m2-notify.jsonl;;
 *) echo '使い方: bash run-m1.sh tools|notools|notify' >&2; exit 2;;
esac
private_dir "$state" && private_dir "$state/profiles" || { echo "記録の置き場が 0700 の本人のディレクトリではありません: $state" >&2; exit 2; }
if [[ ${M1_STAGE:-} != inner ]]; then
 here=$(cd "$(dirname "$0")" && pwd -P)
 [[ -x $bin ]] || { echo "tunnel-client がありません。先に brew install openai/tools/tunnel-client" >&2; exit 2; }
 version=$("$bin" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
 IFS=. read -r ma mi pa <<<"${version:-0.0.0}"
 if (( ma == 0 && mi == 0 && pa < 15 )); then echo "tunnel-client の版が古い（${version:-不明}）。0.0.15 以上が要る" >&2; exit 2; fi
 node=$(mise which node 2>/dev/null || true)
 [[ -n $node && -x $node ]] || { echo 'node の実体が見つかりません（mise which node）' >&2; exit 2; }
 for p in "$node" "$here" "$state"; do [[ $p != *[[:space:]]* ]] || { echo "空白を含むパスは使えません: $p" >&2; exit 2; }; done
 [[ -f $here/$script ]] || { echo "起動するスクリプトがありません: $here/$script" >&2; exit 2; }
 # Start again with an empty environment (nothing of this shell, such as another tunnel-client's MCP_COMMAND or OPENAI_API_KEY,
 # reaches tunnel-client). The keys are read only after that, inside the new shell, so they are never an argument of a command.
 exec /usr/bin/env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="${TMPDIR:-/tmp}" \
  M1_STAGE=inner M1_NODE="$node" M1_HERE="$here" M1_VERSION="$version" /bin/bash "$here/run-m1.sh" "$1"
fi
key=$(security find-generic-password -s seamless-dot-m1 -a runtime-key -w 2>/dev/null) || { echo 'Keychain に runtime-key がありません' >&2; exit 2; }
tid=$(security find-generic-password -s seamless-dot-m1 -a tunnel-id -w 2>/dev/null) || { echo 'Keychain に tunnel-id がありません' >&2; exit 2; }
[[ $tid =~ ^tunnel_([a-z0-9]{4}_)?[a-z0-9]{32}$ ]] || { echo 'tunnel-id の形が tunnel_… ではありません（値は表示しません）' >&2; exit 2; }
[[ -n $key && $key != *[[:space:]]* ]] || { echo 'runtime-key が空か、空白を含みます（値は表示しません）' >&2; exit 2; }
export TUNNEL_CLIENT_PROFILE_DIR="$state/profiles" SEAMLESS_M1_KEY="$key" CONTROL_PLANE_TUNNEL_ID="$tid"
unset key tid
url_file="$state/health-$1.$$.url"
echo "tunnel-client $M1_VERSION、記録 $state/$log、健康の URL $url_file。止めるときは Ctrl-C"
# One tunnel-client per tunnel ID (configuration.md "Stdio deployment limits"): a lock in the shared record folder, held by lockf
# until tunnel-client ends, so a second start from any work folder stops here.
set +e
/usr/bin/lockf -s -k -t 0 "$state/run.lock" "$bin" run --control-plane.api-key=env:SEAMLESS_M1_KEY \
 --mcp.command "$M1_NODE $M1_HERE/$script$extra --log $state/$log" \
 --health.listen-addr 127.0.0.1:0 --health.url-file "$url_file"
code=$?
if (( code == 75 )); then echo '別の測定がまだ動いています。前の端末で Ctrl-C で止めてから起動してください' >&2; fi
exit $code
