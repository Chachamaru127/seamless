# seamless

同じ Mac で開いている AI の会話同士をつなぐ、非公式の配線です。対象は Claude Code、Codex、opencode、
Cursor CLI、Antigravity CLI、Grok CLI、そして本人が登録した Grok Bot です。

ある会話から、同じ作業場所にいる別の会話へ依頼を渡します。seamless は各製品の正規の経路で運び、観測できた
ことだけを返します。受理、相手への到達、処理中、返事、不明の 5 段階です。判断は足しません。本文を保存せず、
履歴データベースも常駐プロセスも持ちません。通信は、本人が登録した外の実行主体への webhook だけです。

Node.js 22.22 以降を使います。以下のコマンドはすべて、チェックアウトの根から実行します。

## 試す

アカウントも起動中の AI 製品も要りません。`verify.sh` はファイルを変えず、`setup --dry-run` は何も書きません。
バージョン管理の Node shim が、導入時と違うホームを拒否することがあります。下の PATH の前置きは macOS の
Homebrew の Node を先にします。別の素の Node があるなら前置きは外してください。

```sh
bash scripts/verify.sh
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts setup --dry-run
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts setup
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts "この作業場所の続きを確認して"
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" node src/cli.ts status REQUEST_ID
```

`setup` が変えるのは `~/.claude.json` の MCP 登録 1 件だけです。`REQUEST_ID` は送った依頼の ID です。
相手がいない新しいホームでは、その ID の依頼が無い旨を返し、失敗にはなりません。

## setup

`setup` はこの Mac の製品（Claude Code、Codex、opencode、Cursor CLI、Antigravity CLI、Grok CLI、Grok Bot の
登録）を検出し、受信口を持つ Claude の会話を一覧し、`~/.claude.json` へ `seamless` という MCP サーバーを
1 件だけ登録します。

- Keychain を読まず、製品を起動せず、Mac の外へ何も送りません。
- 既存の `~/.claude.json` は変更前に `~/.seamless/backups/` へ写します。
- 2 回目以降は同じ登録をそのまま残し、backup を増やしません。
- 読めない、または壊れた設定ファイルは上書きせず `config_unusable` で止まります。
- `--dry-run` は同じ一覧と、行うはずの 1 件の変更を出し、書きません。

診断は `doctor` が読み取りだけで行います。

```sh
node src/cli.ts doctor --json
```

Node、各製品と実行ファイル、Claude の受信口、対応表の件数、Reason Network の hooks が製品の hooks 表に
あるか、Antigravity の在処を返します。

## 1 コマンド

コマンド名でもフラグでもない引数 1 つは、そのまま渡す本文です。

```sh
node src/cli.ts "この作業場所の続きを確認して"
```

既定の宛先は、呼ぶ側と同じ作業場所にいる相手です。送れる相手がちょうど 1 件なら渡します。0 件なら
`target_unavailable`、2 件以上なら `ambiguous` と候補を出し、書き込みの前に止まります。表示名だけで宛先を
選ばず、別の作業場所へ探しに行きません。

返りは JSON 1 行で、配送状態を含みます。返事は `replyTo` を付けた 2 回目の呼び出しです。1 コマンドは
最初の依頼用です。`status` は、`send` の呼び出しで決めた依頼 ID を追います。

## status

依頼 ID で 1 件を追います。

```sh
node src/cli.ts status REQUEST_ID
node src/cli.ts status REQUEST_ID --wait 60
```

`--wait` は返事が観測されるか、指定秒（0 から 600）が過ぎるまで繰り返します。出力は 5 段階
`accepted`、`reached`、`processing`、`replied`、`unknown` を分けて返します。各段階は `observed` か
`unobserved` で、観測の根拠が付きます。`reached` を書くのは相手の記録を読む側だけで、送る側は書きません。
段階の横に状態が付きます。`held` は相手の記録が読めて、`heldAfterSec`（既定 20 秒）を過ぎても出ない場合、
`read_failed` は記録を開けない場合、`refused` は正規の経路が書き込みを断った場合です。

いま依頼を受けられる相手は次で分かります。

```sh
node src/cli.ts who --json
```

各相手は `ready`、`next_turn`、`wake_needed`、`unreachable` のいずれかで、`no_inbox_socket` などの理由が
付きます。

## 併用の注意

Reason Network は製品の hooks 表を使って届けます。seamless も Cursor CLI、Antigravity CLI、Grok CLI では
hooks と受信箱を使います。2 つは共存できますが、偶然に任せると壊れます。

- `doctor --json` の `reason_network_hooks: true` は、どれかの製品の hooks 表に Reason の記述があるという
  検出です。いま Reason が動いているという主張ではありません。
- `setup` が触るのは `~/.claude.json` の `mcpServers.seamless` だけです。Reason の hooks を消したり、
  並べ替えたり、書き換えたりしません。外すときは製品側の設定で、写しを取ってから行います。
- 同じ受信箱ファイルや同じ hook の枠へ 2 つを向けないでください。配送を測る間は製品ごとに 1 つにします。
  書き手が 2 つあると、`reached` と `replied` の意味が曖昧になります。
- `setup` が作る backup と、自分で編集する hook ファイルの写しを残してください。Reason を戻す
  アンインストーラは seamless にありません。

## Orca との役割

Orca は worktree と端末を管理し、seamless は会話を配線します。Orca がこのメッセージを代わりに送ることは
ありません。

## 非公式の但し書き

これは非公式のプロジェクトです。Anthropic、OpenAI、xAI、Anysphere、Google、Orca、Reason Network の
承認や支援を受けたものではありません。製品名は相互運用を説明するためだけに使い、権利はそれぞれの
所有者にあります。

一部のアダプタは公開された安定 SDK ではない接続を使います。Claude の session socket、Codex の `queue` と
Desktop IPC、Grok の session ファイルです。予告なく変わり得ます。対応表は観測した版と日付を記録し、
表にない版は動くと決めつけず `versionStatus: unverified` と表示します。自己責任で使い、製品側の承認と
sandbox はそのまま残してください。seamless で届いた文は、人の承認の代わりにはなりません。

## 保存するもの

| 場所 | 中身 | 権限 |
|---|---|---|
| `~/.seamless/reservations/` | 依頼ごとに 1 ファイル。hash、状態、時刻、ID。本文は無い | 0600、ディレクトリ 0700 |
| `~/.seamless/limits.json` | 任意の制限。除外、範囲、read/send、`markUnapproved`、`strictVersions`、`codexMessageMaxChars`、`heldAfterSec` | 0600 |
| `~/.seamless/backups/` | `setup` が変更前に取る `~/.claude.json` の写し | 0600、ディレクトリ 0700 |
| `~/.seamless/peers.json` | 本人が登録した外の実行主体（Grok Bot など） | 0600 |
| `~/.claude.json` | `setup` が行う唯一の書き込み。`mcpServers.seamless` | 元の権限 |

予約は製品への書き込み前に作ります。途中で落ちると `unknown` が残り、同じ依頼 ID を自動で二重に
配送しません。

## 対応版

観測した製品と版は[対応表](specs/202610-everyday-use/compat.md)にあります。表にない版も既定で使い、
`unverified` と表示します。`fix_required` の版は止まります。確認済みの版だけに限るときは
`~/.seamless/limits.json` へ `"strictVersions": true` を書きます。未確認の版からも limits の道具は使える
ので、更新後に設定を外せます。

## 文書とライセンス

- [製品仕様](spec.md)、[配線の仕様](specs/2026-10-universal-wiring/spec.md)、[計画](specs/2026-10-universal-wiring/Plans.md)
- [Reason との比較](docs/reports/2026-10-19-seamless-beyond-reason.html)
- ライセンス: [MIT](LICENSE)。第三者と商標の記載: [NOTICE](NOTICE)。報告: [SECURITY.md](SECURITY.md)。
- English: [README.md](README.md)
