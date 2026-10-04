# claudex

CodexとClaudeが、許可された元セッションを同じ条件で探す共通処理です。
登録、一覧、候補選択、元会話のread/sendと返信相関を実装しています。
`--native` を明示すると、対応版の既存Codex DesktopとClaude Codeの実行体へ接続します。省略時は探索用の窓口だけを起動し、native状態はunknownです。
グローバル設定への常用導入は行っていません。検収の最新状態は [今回の製品検証](specs/202610-session-interop/product-evidence.md) に記録します。

## 試す

Node.js 22.22.xを使います。追加パッケージ、会話本文の保存、SQLiteはありません。

```sh
bash scripts/verify.sh
node src/cli.ts context /Users/tachibanashuuta/LocalWork/Code/claudex
node src/cli.ts sessions --registry specs/202610-session-discovery/bootstrap-example.json --caller codex-example
node src/cli.ts sessions --registry specs/202610-session-discovery/bootstrap-example.json --caller claude-example
```

登録例は実会話ではありません。ファイルはmode0600が必要です。
登録には公開登録キー、製品、native会話ID、世代、host、表示名、任意の担当、宣言workspace、操作能力、向き付きgrantsを置きます。
秘密の鍵、本文、status、観測時刻は入力項目にありません。未知項目は拒否します。
workspaceの宣言だけでは、その会話がそこで動いている証拠になりません。

許可は、呼出し元のoutboundと受信先のinboundの両方がそろった操作だけです。
一覧にはreadかsendを許可された相手を出します。相手のgrantsや本文は返しません。
名簿は明示された1ファイルを要求ごとに再読込みします。
同じOSユーザーが名簿を変更できる前提です。caller引数自体は認証ではありません。

## CLIとMCP

```sh
node src/cli.ts serve --registry specs/202610-session-discovery/bootstrap-example.json --caller codex-example
```

持続serveへJSON行を送ります。

```json
{"id":1,"method":"sessions","params":{"operation":"send","scope":"current_work"}}
{"id":2,"method":"select","params":{"operation":"send","role":"review"}}
{"id":3,"method":"revalidate","params":{"binding":"selectが返したID"}}
```

通常起動のselectはcaller_unobservedとなり、bindingを発行しません。
成功する往復はtests/supportの専用観測器で検証しています。環境変数やJSONから試験観測器を有効にできません。
bindingは同一プロセス内で60秒有効です。再照合は1回だけ成功し、送信済みを意味しません。

```sh
node src/cli.ts mcp --registry specs/202610-session-discovery/bootstrap-example.json --caller claude-example
```

MCPはstdio、protocolVersion 2025-06-18です。
initializeとnotifications/initializedの後、sessionsを呼べます。`--native` 起動ではreadとsendも提供します。
入力operationはreadまたはsendです。一覧はreadかsendを双方で許可した相手を返し、各操作の可否を表示します。operationによる選択判定と操作実行は、このMCP一覧では行いません。
selectとrevalidateは内部の宛先照合とCLI探索に使います。MCPの製品操作はsessions/read/sendの3つです。
このコマンドは常用MCP設定を変更しません。

[stdio仕様](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)と[初期化仕様](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)に合わせ、stdoutはJSON行だけ、通知への応答なし、EOFで終了としています。

## 相手の選び方

| scope | 候補にする作業場所 |
|---|---|
| current_work（既定） | 同じ論理workspace、同じworktree、同じbranch/HEAD状態 |
| same_repository | 同じローカルGit common directoryまで |
| any_registered | 同じhostの認可済み登録まで |

順位は同じ作業場所、同じrepo、別repoの順です。
同順位が複数ならambiguous。状態が古い相手を飛ばして別の相手へ自動で乗り換えません。
明示targetにも認可、scope、担当、最新観測を適用します。
同じremote URLの別cloneは別ローカルrepoです。
Git外、detached、unborn、取得失敗を区別します。
dirtyは未コミット変更の有無だけで、変更内容の一致は保証しません。submodule内部はdirty対象外です。

## 正本と検証

- [仕様](specs/202610-session-discovery/spec.md)
- [実装計画](specs/202610-session-discovery/Plans.md)
- [試験ケース](specs/202610-session-discovery/acceptance-matrix.md)
- [証拠](specs/202610-session-discovery/evidence.md)
- [説明資料](docs/reports/2026-10-02-claudex-explained.html)

実Git観測は複数コマンドのbest-effortです。コード状態の原子的な一致は保証しません。
nativeモードは会話ID、実行世代、実際のcwd、socketの所有者、Codex ownerを照合します。接続不能時はunknown/offline等を返し、別プロセスを起こして代替しません。
名簿とcaller引数は同じOSユーザー内の明示許可を表します。別OSユーザーに対する認証サービスではありません。

## 既存会話を使う

本人が通信を許可した起動済みペアだけを、`observeAuthorizedPair()` の実観測から名簿に登録します。モデルがnative IDやPIDを推測して登録してはいけません。作業場所が一致しない場合、この同じ作業場所用の登録処理は拒否します。

```sh
node src/cli.ts serve --native --registry .local/interop-pair.json --caller codex-current
node src/cli.ts mcp --native --registry .local/interop-pair.json --caller claude-current
```

```json
{"id":1,"method":"read","params":{"target":"claude-current","limit":10}}
{"id":2,"method":"send","params":{"target":"claude-current","id":"呼出し前に生成した一意ID","text":"確認したい依頼"}}
{"id":3,"method":"send","params":{"target":"claude-current","id":"返信用の新しい一意ID","text":"回答","replyTo":"受信した依頼ID"}}
```

本人の操作は「同じ作業場所のClaudeに確認して」「その元の会話を読んで」でよい。登録済みの相手選択とID生成は依頼を受けたモデルが行います。MCP設定をまだ接続していない会話では、モデルがローカル製品CLIを使います。純正一覧の中に他社の会話を差し込む方式ではありません。

readは可視user/assistant本文とpeerの由来、元IDを返します。思考、認証値、添付実体は相互変換しません。native履歴の全取得に制約があれば`olderUnavailable`等を返し、空会話と取得失敗を区別します。

sendの`submitted`はnative書込み受付です。相手が処理した証拠は、元履歴の依頼IDと返信の`replyTo`を別に照合します。書込み後に成否が不明なら`unknown`です。自動再送しません。peer文は本人の承認になりません。

対応版: Codex Desktop `26.928.31416+12553`、`26.928.40906+12694`。Claude Desktop同梱Code `2.1.284`、peerProtocol 1。公開安定SDKではない接続部分があり、他版の利用は未検証です。

重複抑止の保存先は `~/.claudex/reservations/`（0700）です。1依頼につきhash、status、時刻だけを0600のファイルへ原子的に予約します。本文、会話履歴、秘密は保存しません。同じ元会話とIDの予約は、別の窓口プロセスや再起動後も使います。書込み前に予約した状態が残ればunknownとし、再配送しません。SQLiteや配送待ちキューではありません。
