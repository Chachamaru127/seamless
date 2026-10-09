#!/bin/bash
# T3-14: Runtime API key を Keychain（サービス名 seamless-dot-m1、項目 runtime-key）に保存する。
# security の入力欄は 128 文字を超えた分を黙って切り捨てるので使わない。代わりに、実行してから 2 分以内に新しくコピーされた
# sk- で始まる文字列を待ち、見つけたら保存してクリップボードを空にする。値は表示しない（長さだけ出す）。
set -euo pipefail
set +x
first=$(pbpaste 2>/dev/null || true)
echo 'Platform の画面で、鍵の全文をコピーしてください（2 分待ちます）'
for _ in $(seq 1 120); do
 c=$(pbpaste 2>/dev/null || true)
 if [[ $c != "$first" && $c == sk-* && $c != *[[:space:]]* ]]; then
  security add-generic-password -U -s seamless-dot-m1 -a runtime-key -w "$c"
  pbcopy </dev/null
  echo "保存した（${#c} 文字）。クリップボードは空にした"
  exit 0
 fi
 sleep 1
done
echo '2 分以内に sk- で始まる鍵のコピーが見つかりませんでした。もう一度実行してください' >&2
exit 1
