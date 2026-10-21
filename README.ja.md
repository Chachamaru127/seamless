<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/seamless/main/docs/brand/hero.svg" alt="seamless" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/seamless"><img src="https://img.shields.io/npm/v/%40chachamaru127%2Fseamless?color=2f8f5b&label=npm" alt="npm"></a>
  <a href="https://github.com/Chachamaru127/seamless/actions/workflows/verify.yml"><img src="https://github.com/Chachamaru127/seamless/actions/workflows/verify.yml/badge.svg" alt="verify"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.22-8d8b85" alt="node 22.22 以降">
  <img src="https://img.shields.io/badge/platform-macOS-8d8b85" alt="macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8d8b85" alt="MIT"></a>
</p>

<p align="center">
  <b>Claude Code · Codex · opencode · Cursor CLI · Antigravity CLI · Grok CLI · Grok Bot</b><br>
  <sub><a href="README.md">English</a> · 日本語</sub>
</p>

片方のターミナルに Claude Code、隣に Codex。片方がもう片方の一言を必要とする場面で、今はコピーして、切り替えて、貼って、待って、また
コピーして戻ります。**seamless** はそれを 1 コマンドにします。各製品が自分で用意している経路で運び、相手側で何が起きたかを返します。

```sh
npx @chachamaru127/seamless setup
npx @chachamaru127/seamless "失敗しているテストを走らせて、見えたことを教えて"
```

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/seamless/main/docs/brand/terminal.svg" alt="seamless の status 出力。accepted、reached、processing、replied が証拠つきで observed と出る" width="100%">
</p>

## 何が変わるか

- **AI の会話どうしのコピー＆ペーストが消える。** 今いる会話から隣の会話へ送れます。`setup` が登録する `seamless` MCP ツールで、AI 自身が送ることもできます。
- **届いたことが分かる。** 配送を 5 段階で報告します。各段階は受け手の製品が自分で持つ記録から観測したもので、送り手の自己申告ではありません。
- **裏で何も動かない。** 常駐プロセスなし、履歴データベースなし、本文の保存なし。依頼ごとに id と状態だけの小さな記録を 1 つ残します。
- **この Mac の製品を 1 回の setup で。** `setup` が入っている製品を見つけ、配線できるものを配線します（Antigravity は検出のみ）。`setup --remove` で元に戻せます。
- **返事が正しい場所に戻る。** 返事は答える相手の id を持って運ばれるので、製品をまたいでも 1 本のやりとりのままです。

## すぐ試す

```sh
# 1. この Mac の製品を配線する（まず下見、次に反映）
npx @chachamaru127/seamless setup --dry-run
npx @chachamaru127/seamless setup

# 2. 同じ作業場所の会話へ 1 行送る
npx @chachamaru127/seamless "この作業場所の続きを確認して"

# 3. 返事が観測されるまで追う（最大 60 秒）
npx @chachamaru127/seamless status REQUEST_ID --wait 60
```

`npm i -g @chachamaru127/seamless` で素の `seamless` コマンドが使えます。Node.js 22.22 以降。検証した
プラットフォームは macOS です。

## 対応している相手

| 製品 | seamless が届ける経路 | 向き |
|---|---|---|
| Claude Code | セッション自身の受信 socket（cross-session messaging） | 送信と受信 |
| Codex | `codex queue` で既存の thread へ | 送信と受信 |
| opencode | 公式 plugin API（`session.prompt`） | 送信と受信 |
| Cursor CLI | `~/.cursor/hooks.json` の hooks | 送信と受信 |
| Antigravity CLI | `doctor` が検出のみ。配送は phase 2 で未検証 | 下見 |
| Grok CLI | hooks と受信箱ファイル | 送信と受信 |
| Grok Bot | 本人が登録した実行主体への webhook | 送信と返信 |

どの行も、作り手が公開している経路を使います。seamless は自前の通信手順を作りません。各行が拠って立つ文書は
[公式経路](#公式経路)にあります。

## hook だけで足りない理由

| | コピー＆ペースト | hook だけの中継 | seamless |
|---|---|---|---|
| 開いている会話そのものに届く | 自分でやる | 新しいプロセスになることがある | 届く。既存の会話へ |
| 読まれたことが分かる | 分からない | 分からない | 分かる。相手の記録から |
| 答えたことが分かる | 自分で見る | 分からない | 分かる。返事の id つき |
| 常駐プロセス | なし | 多い | なし |
| 本文の保存 | なし | 多い | なし |
| 取り外し | 不要 | まちまち | `setup --remove` |

Reason Network との比較（1 台の Mac での実測）は
[docs/reports/2026-10-19-seamless-beyond-reason.html](docs/reports/2026-10-19-seamless-beyond-reason.html) にあります。

## 今、誰が受け取れるか

```sh
seamless who --json
```

相手ごとに `ready`、`next_turn`、`wake_needed`、`unreachable` のいずれかと、`no_inbox_socket` のような理由が
出ます。1 行送信の既定の宛先は、同じ作業場所で送れる相手が 1 件に絞れたときのその相手です。2 件以上なら
`ambiguous` と候補を出して何も書きません。表示名で選ぶことも、別の作業場所へ踏み込むこともしません。

## 任意: Claude Code の帯

`mods/seamless-band` は、Claude Desktop の Code タブの入力欄の上に、今の会話がしていることと相手ごとの最新の
やりとりを描きます。`claude --plugin-dir mods/seamless-band` で 1 セッションだけ読み込めます（Claude Code
2.1.287 以降）。

---

## リファレンス

### setup

`setup` は Claude Code、Codex、opencode、Cursor CLI、Antigravity CLI、Grok CLI、登録済みの Grok Bot を検出し、
見つけた製品ごとに配線します。`~/.claude.json` の `seamless` MCP サーバー、opencode の plugin、Cursor と Grok の
hooks です。Antigravity は検出だけです。

- `--dry-run` は同じ検出結果と、行うはずの変更を全部表示し、何も書きません。
- `--remove` は登録を取り外します。
- 変更するファイルは、先に `~/.seamless/backups/` へ写します。
- 2 回走らせても、同じ登録は触らず、新しい backup も作りません。
- 読めない、壊れた設定ファイルは `config_unusable` と報告し、上書きしません。
- Keychain を読まず、製品を起動せず、Mac の外へ何も送りません。

`doctor --json` は同じ Mac を読み取りだけで説明します。Node、各製品と実行ファイル、Claude の受信 socket、対応表の
件数、どれかの製品の hooks 表に Reason Network があるか、Antigravity の場所です。

### 1 コマンド

コマンド名ではない引数が 1 つだけなら、それが届ける本文です。答えは依頼 id と配送状態の JSON 1 行です。返事は
`replyTo` を持つ 2 回目の送信です。

### status

```sh
seamless status REQUEST_ID
seamless status REQUEST_ID --wait 60
```

`--wait` は返事が観測されるか、秒数（0 から 600）が尽きるまで待ちます。5 段階は `accepted`、`reached`、
`processing`、`replied`、`unknown` です。各段階は `observed` か `unobserved` で、それを示した証拠がつきます。
`reached` は相手自身の記録を読んだ側だけが書きます。段階の横に状態が 1 つ出ます。`held`（相手の記録は読めたが
`heldAfterSec`、既定 20 秒を過ぎて沈黙）、`read_failed`（記録を開けなかった）、`refused`（公式経路が書き込みを
拒否した）です。

### 保存するもの

| 場所 | 中身 | モード |
|---|---|---|
| `~/.seamless/reservations/` | 依頼ごとに 1 ファイル。hash、状態、時刻、id。本文は無い | 0600、ディレクトリ 0700 |
| `~/.seamless/limits.json` | 任意の制限。除外、範囲、読む/送る、`markUnapproved`、`strictVersions`、`codexMessageMaxChars`、`heldAfterSec` | 0600 |
| `~/.seamless/backups/` | `setup` が変更した設定ファイルの写し | 0600、ディレクトリ 0700 |
| `~/.seamless/peers.json` | 本人が登録した外の実行主体（Grok Bot など） | 0600 |
| 製品の設定 | `~/.claude.json` の `mcpServers.seamless`、opencode の plugin 項目、Cursor と Grok の hook 項目 | 元のまま |

予約は native の書き込みより先に書かれるので、途中で落ちても `unknown` が残り、同じ依頼 id が自動で 2 回届く
ことはありません。

### 公式経路

| 製品 | 公開文書 | 読んだ 1 行 |
|---|---|---|
| Claude Code | https://code.claude.com/docs/en/cross-session-messaging | 「The session's inbox socket」（節の見出し。2026-10-19 に取得）。socket の場所は `CLAUDE_CODE_MESSAGING_SOCKET` として渡る |
| Codex | https://github.com/openai/codex | 「Queue a message for an existing session」（`codex queue --help`、codex-cli 0.163.0、2026-10-20 に実行） |
| opencode | https://opencode.ai/docs/plugins/ | plugin context の `session.prompt`（`@opencode-ai/plugin` 1.19.0 の型） |
| Cursor | https://cursor.com/docs/hooks | 「Hooks are scripts or prompt-based checks that exchange JSON over stdin/stdout and can observe, block, modify, or follow up on behavior.」（Cursor 同梱の hook 手引き、2026-10-20） |

製品が同梱する help や型から取った行は、URL の文書そのものを開いた確認ではありません。経路に頼る前に、その
URL を開いて確かめてください。Grok Bot webhook、Cursor hooks、Antigravity hooks の利用規約の確認は、
`docs/release.md` の 4.3 で未です。

### 対応表

観測した製品と版は[対応表](specs/202610-everyday-use/compat.md)にあります。表にない版もそのまま使い、
`unverified` と表示します。`fix_required` の版は止まります。検証済みの版だけを受け入れるには
`~/.seamless/limits.json` に `"strictVersions": true` を足します。

### Reason Network との併用

Reason Network は同じ製品の hooks 表を通して届けます。seamless の一部のアダプタ（Cursor CLI、Antigravity CLI、
Grok CLI）も hooks と受信箱ファイルを使います。2 層は共存できますが、無自覚にはできません。

- `doctor --json` は、どれかの製品の hooks 表に Reason の名前があると `reason_network_hooks: true` を返します。
  検出であって、Reason が今動いているという主張ではありません。
- `setup` は自分の項目だけを足し、外します。Reason の hooks を消したり、並べ替えたり、書き換えたりしません。
- 同じ受信箱ファイルや同じ hook の枠に 2 層を向けないでください。配送を計測する間は製品ごとに 1 層にします。
  書き手が 2 つあると「reached」と「replied」が曖昧になります。
- `setup` が書く backup と、自分で編集した hook ファイルの写しを残してください。

### 非公式

これは非公式のプロジェクトです。Anthropic、OpenAI、xAI、Anysphere（Cursor）、Google、Orca、Reason Network の
承認や支援を受けたものではありません。製品名は相互運用を説明するためだけに使い、権利はそれぞれの所有者に
あります。

一部のアダプタは、公開された安定 SDK ではない接続を使います。Claude の session socket、Codex の `queue` と
Desktop IPC、Grok の session ファイルです。製品の更新で予告なく壊れ得ます。対応表は観測した版と日付を記録
します。自己責任で使い、製品側の承認と sandbox はそのまま残してください。seamless で届いた文は、人の承認の
代わりにはなりません。

### 開発

```sh
git clone https://github.com/Chachamaru127/seamless.git && cd seamless
bash scripts/verify.sh          # 外に触れない検査。dist/ を作り、~/ には触れない
node src/cli.ts setup --dry-run
```

### 文書とライセンス

- [製品仕様](spec.md)、[配線仕様](specs/2026-10-universal-wiring/spec.md)、[計画](specs/2026-10-universal-wiring/Plans.md)
- [ブランド](specs/202610-brand/design.md)
- ライセンス: [MIT](LICENSE)。第三者と商標の注記: [NOTICE](NOTICE)。報告: [SECURITY.md](SECURITY.md)。
