#!/bin/bash
# 測定 M3（specs/202610-more-peers）: 茶々丸（Grok Bot）が Mac でコマンドを動かすとき、どの起動元から来て、何で見分けられるかを調べる。
# 読み取りだけ。環境変数は名前だけを出し、値は出さない。引数に UUID を 1 つ渡すと、その UUID を値に含む環境変数の名前だけを出す。
set -u
uuid="${1:-}"
case "$uuid" in ''|[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-*) ;; *) echo "引数は UUID だけ" >&2; exit 2;; esac

echo "== 起動元（自分から親へ）"
p=$$; n=0; seen_apps=""
while [ "$p" -gt 1 ] && [ $n -lt 20 ]; do
 line=$(ps -o pid=,ppid=,comm= -p "$p" 2>/dev/null) || break
 [ -n "$line" ] || break
 echo "$line"
 path=$(echo "$line" | awk '{ $1=""; $2=""; sub(/^  /,""); print }')
 app=$(echo "$path" | sed -n 's#^\(.*\.app\)/Contents/.*#\1#p')
 case " $seen_apps " in *" $app "*) app="";; esac
 if [ -n "$app" ]; then
  seen_apps="$seen_apps $app"
  codesign -dv "$app" 2>&1 | grep -E '^(Identifier|TeamIdentifier)=' | sed 's/^/    /'
 fi
 p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
 n=$((n+1))
done

echo "== 環境変数の名前（GROK、XAI、BOT、AGENT、SAND、CURSOR、ANYSPHERE を含むもの。値は出さない）"
compgen -e | grep -i -E 'grok|xai|bot|agent|sand|cursor|anysphere' || echo "(なし)"

if [ -n "$uuid" ]; then
 echo "== 値に $uuid を含む環境変数の名前"
 found=0
 for name in $(compgen -e); do
  case "${!name}" in *"$uuid"*) echo "$name"; found=1;; esac
 done
 [ $found -eq 1 ] || echo "(なし)"
fi
echo "== CURSOR_CONVERSATION_ID の形（UUID の部分は <UUID> に置き換える。最初の 200 文字まで）"
if [ -z "${CURSOR_CONVERSATION_ID+x}" ]; then echo "(無い)"
elif [ -z "$CURSOR_CONVERSATION_ID" ]; then echo "(空)"
else
 printf '%s' "$CURSOR_CONVERSATION_ID" | sed -E 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<UUID>/g' | head -c 200; echo
 echo "長さ ${#CURSOR_CONVERSATION_ID}"
fi
echo "== 作業フォルダ"
pwd
