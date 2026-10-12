#!/bin/bash
# 測定 M3-4（specs/202610-more-peers）: 茶々丸の受け口のルーチンが持つ CURSOR_CONVERSATION_ID が、実行ごとに変わるかを見る。
# その値（英数字とハイフンだけ。ほかの文字があれば形が想定外とだけ書く）と時刻を、本線の .local/m3/ids.txt（0600）に 1 行足す。ほかには何もしない。
set -u
d="$HOME/LocalWork/Code/seamless/.local/m3"
mkdir -p "$d" && chmod 700 "$d"
v="${CURSOR_CONVERSATION_ID-}"
case "$v" in
 '') v='(無い)';;
 *[!A-Za-z0-9-]*) v="(形が想定外、長さ ${#v})";;
esac
[ ${#v} -le 100 ] || v="(長すぎる、長さ ${#v})"
printf '%s %s\n' "$(date '+%F %T')" "$v" >> "$d/ids.txt"
chmod 600 "$d/ids.txt"
echo "記録した"
