# Dot Events の非接続試作

MCP Events の署名、発見、購読、再起動後の保持、送信前の予約をローカルの偽の接続で確かめる。Q5 の認証は実装していない。本体 `src/`、CLI、常用設定から呼ばれない。

```sh
node --test experiments/dot-events/events.test.ts
```

ネットワーク処理は無い。callback は `https://receiver.example.invalid/events` だけを受け付ける。`post` はテストが渡す偽物。認証された主体もテストが渡す偽物で、実機の認証を意味しない。署名キーは公開の試験用の32文字 `0123456789abcdef0123456789abcdef`。実際の鍵や会話の本文を渡してはならない。

参照: [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events) の2026-10-08取得版と、既存specが固定する [SEP-3415 の commit 6859def4ba24ab41678d0e6799fe3f4c84228f9a](https://github.com/pja-ant/modelcontextprotocol/blob/6859def4ba24ab41678d0e6799fe3f4c84228f9a/seps/0000-events-extension.md)。仕様の提案と接続前の条件は [内包案](../../specs/202610-more-peers/dot-events-integration.md)。既存の2025-06-18入口とは分離する。

合格しても AC11a〜c の製品合格や Dot の稼働には数えない。未実装: 実機の認証と登録、HTTP MCP transport、実DNSとTLSソケットへの接続先固定、実 callback 配送、元会話との read/send、状態パネル。完成後の本体への取り込みは Q5 の確定後。

2026-10-09 の追加検証では、DNSも注入された偽物を使う。解決した公開宛先をpostへ渡し、返された接続先が一致するかを照合する。危険なIPと混在回答を拒否し、1回の送信中は再解決しない。実際のネットワーク実装がこの宛先指定とTLS hostnameを守ることは未検証で、一般用途のSSRF対策ではない。
challengeの10秒の期限は実際のタイマーでAbortSignalを発火する。通信を実装する側がsignalを守ることは別途必要。試験では未応答のmockがabortで中断することを確認する。
同じsecretの再確認に失敗しても有効期限を延ばさず既存購読を保つ。secret変更時は新しい確認が通るまで配送を止める。宛先が無くPOSTしていない依頼は予約を消費しない。POST後の成否不明は再送しない。

固定署名ベクトルは Python 標準ライブラリーの hmac/hashlib を別途実行して計算した。署名対象は `evt_sample.1791468000.{"text":"sample"}`。Node の同じ実装から期待値を作っていない。
