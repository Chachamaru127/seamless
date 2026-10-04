# 小型検証セット

2026-10-01 / Mac / Codex 0.159.3 / Claude Code 2.1.286 / Claude Agent SDK 0.2.163

目的は、元の会話へ接続して読む構成の成立条件を切り分けること。
**相互通信の完成品ではない。MCP共通窓口もまだ実装していない。**
共有SQLiteもagmsgのforkも含まない。

## 再現

このディレクトリの2階層上（claudex）で実行する。
Codexは通常の認証と設定を使う。Claude接続試験は専用CLAUDE_CONFIG_DIRを指定する。既存業務セッションへ送信しない。
新しい専用プロセスを作り、finallyでそのプロセスだけを終了する。
上の接続試験と固定fixture試験はモデルへの非空プロンプトを送らない。既存履歴を探索しない。

```sh
uv venv .local/native-interop/venv
uv pip install --python .local/native-interop/venv/bin/python -r experiments/native-interop/requirements.txt
codex app-server generate-json-schema --experimental --out .local/probe-schema
python3 experiments/native-interop/probe.py
python3 experiments/native-interop/claude_probe.py
.local/native-interop/venv/bin/python experiments/native-interop/test_contract.py
```

## 実際の結果

| 種別 | 内容 | 実終了コード |
|---|---|---|
| 実CLI | Codex初期化、同じ一時thread IDのread、未知ID拒否 | 0、3項目PASS |
| 実CLI | ClaudeのSessionStartでsocket所在を取得、本文を送らず接続 | 最終版runner 0。子プロセスは意図した終了143 |
| 公式SDK + 固定fixture | session/message ID保持とpagination、未知IDが空配列 | 0、2件PASS |
| 生成schema | CodexのtoolOutput入力欄 | 0、1件PASS |

結果の固定写しはresults/。再実行の出力は.local/native-interop/。
fixtureは一時フォルダ内の作り物。元の会話がliveに読めたとは数えない。
Codexは本文を作っていない一時会話。metadataのread成功である。
Claudeは接続後に本文を送らず閉じる。connect成功は配送成功ではない。
SDKは未知IDも空配列を返す。存在確認は別契約が必要。

## 未検証

- Claudeへの非空本文配送と、Codexの純正著者表示。
- 元の文脈を使った両方向の返信。
- 2つのモデルが共通MCP窓口で相手を読むこと。
- busy中の受信、重複、切断時の状態。
- 開いている既存Desktopの会話への接続。

Claudeのroute-cli判定はquota_exhausted。Codexのroute判定はunverifiedだった。
後述の追加試験では、Codex自身の公式応答ordinaryUsageAllowed=trueを取得してからモデルを呼んだ。
最終計画は../../specs/202610-session-interop/Plans.md。

## Codexの実モデル配送試験

次の試験はgpt-6.1-sol / effort lowで各2 turnを実行する。対象は専用の一時会話だけ。
account/rateLimits/readでordinaryUsageAllowed=trueを確認してから開始する。

```sh
python3 experiments/native-interop/codex_delivery_probe.py
python3 experiments/native-interop/codex_delivery_probe.py --authorize-peer
```

- 基準条件: 事前ルールなし。実exit 1。期待BASE17 PONG17に対しBASE17のみ。接続だけでは依頼に応じない反例。
- 比較条件: 最初の指示で、この窓口の固定文依頼への応答を許可。実exit 0。BASE17 → BASE17 PONG17。同じthread IDとapp-server PIDを維持。
- 基準条件1試行、応答ルールあり条件2試行で同じ結果。確率的な再現性や通常業務への一般化は未測定。
- Claude本人からの送信ではない。送り主はsynthetic-other-sessionという試験用文字列。
- 生の設定、認証値、思考過程は結果に含めず、返答とイベント種別を記録した。

結果はresults/codex-delivery-baseline.jsonとcodex-delivery-authorized.json。
最初の基準条件は、失敗時の記録強化前に実行したため返答はreason欄に残る。

## 独立レビュー後の修正

- Claude接続試験は専用CLAUDE_CONFIG_DIRを使用し、アプリケーション本文を一切送らない。
- 初回試験は標準設定領域にsession-envの空ディレクトリを残した。既存領域から削除はしていない。本文の複製ではない。
- Codexは要求フラグだけでなく応答のephemeral=true、path=nullもassertする。これはサーバの応答であり、全ディスク無書込みの証明ではない。
- 各自が作ったprocess groupを終了する。他の既存プロセスを名前で探して停止しない。
