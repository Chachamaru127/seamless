# 公開の手順と公開面（release）

状態: 2026-10-19 起草（Issue #17 / T13）。最終確認は T18（H5 と H6 の後）。正本は `specs/2026-10-universal-wiring/spec.md` の AC12 と Plans.md 1 章 5、8 章。

この文書は 3 つを決める。何を `npm pack` に入れるか、どの内部依存を公開物に載せるか、公開前に誰が何を確認するか。

## 1. 同梱物の正本

同梱物の正本は `package.json` の `files`（許可したものだけを入れる）。`.npmignore` は `files` を外したときに同じ面を保つための同じ除外で、npm は `files` がある間は読まない。

| 入れる | 中身 | 理由 |
|---|---|---|
| `src/` | 実行する TypeScript（アダプタ、manifest、CLI、MCP、配送、状態） | 製品本体 |
| `hooks/` | Cursor と Grok CLI の hook 1 枚ずつ | 製品側に置く配線 |
| `packages/opencode-plugin/` | opencode の plugin | `src/adapters/opencode.ts` が import する実行時依存 |
| `README.md` | 入口の説明 | T14 で書き直す |
| `package.json` | 定義 | npm が必ず入れる |

`LICENSE` / `NOTICE` / `SECURITY.md` は T14 で足す。npm は `LICENSE*` を自動で入れるが、`NOTICE` と `SECURITY.md` は `files` に足す必要がある（T18 で確定）。

### 今の予定一覧（2026-10-19 時点、T18 で更新）

`npm pack --dry-run --json --ignore-scripts` の出力。T18 はこの一覧と実物を `diff` で突き合わせる。

```text
README.md
hooks/cursor/seamless-hook.sh
hooks/grok-cli/seamless-hook.sh
package.json
packages/opencode-plugin/index.ts
src/adapters/antigravity.ts
src/adapters/claude.ts
src/adapters/codex.ts
src/adapters/cursor.ts
src/adapters/grok.ts
src/adapters/opencode.ts
src/adapters/read.ts
src/adapters/session.ts
src/appearance.ts
src/automatic.ts
src/bot-executor.ts
src/bot-sign.ts
src/caller.ts
src/cli.ts
src/compat-check.ts
src/compat.ts
src/core/manifest.ts
src/delivery.ts
src/discovery.ts
src/doctor.ts
src/external-inbound.ts
src/git-context.ts
src/grok-hook.ts
src/grok-inbox.ts
src/inbound.ts
src/io.ts
src/limits.ts
src/manifests/claude.json
src/manifests/codex.json
src/manifests/grok-bot.json
src/manifests/grok-cli.json
src/manifests/phase2/antigravity.json
src/mcp.ts
src/native-runtime.ts
src/nonce-store.ts
src/peers.ts
src/protocol.ts
src/registry.ts
src/request-store.ts
src/secrets.ts
src/seen.ts
src/serve.ts
src/sessions-scan.ts
src/setup.ts
src/signed-envelope.ts
src/status-exchanges.ts
src/status.ts
src/text.ts
src/webhook-send.ts
```

54 ファイル、展開後 447,205 バイト（2026-10-19、T13 の修正後）。

## 2. 同梱物から外すもの

Plans.md 1 章 5 の 4 つ。どれもリポジトリと試験には残す。

| 対象 | 同梱物から外すもの | 内部と試験に残るもの | 外す理由 |
|---|---|---|---|
| 旧 `--registry` 方式 | 登録例（`specs/`）、旧手順（現在の README。T14 で書き直す）、`tests/` | `src/registry.ts`、`--registry` / `--caller` / `migrate` の経路、その試験 | 既定の自動方式と共通の型と配送を使うため、コードだけを先に切れない。公開ビルドの分離は T18 で行う |
| Claude Desktop の band mod | `mods/seamless-band/`、`.claude-plugin/` | 同左（別 plugin として配布） | 独立した plugin。上流ライセンスは NOTICE に収録する（T14） |
| status panel | `src/status-panel.ts`、`src/status-panel.html`、`codex-plugin/` | 同左、`scripts/mcp-panel.ts`（内部の起動口）、`tests/status-panel.test.ts` | Codex の右パネルは実験。v1 の公開面は CLI と MCP の 4 道具に絞る |
| Dot の実験 | `experiments/` | 同左 | 非接続の試作。Dot は v1 の対象外（spec.md の対象外） |

### 同梱物の中だけで閉じていること（T13 で解消済み）

同梱物のファイルが同梱物の外を import すると、公開後に `mcp` や CLI が読み込めなくなる。T13 の判定で 2 件見つかり、どちらも直した（2026-10-19）。

1. `src/mcp.ts` は `./status-panel.ts` を import しない。status panel は内部の起動口 `scripts/mcp-panel.ts` から `createMcp` へ渡し、同梱する MCP は 4 道具だけを並べる。
2. `src/status-exchanges.ts` は band mod を import しない。色は `src/appearance.ts`、文字は `src/text.ts` に移し、どちらも同梱物に含める。

`node scripts/pack-check.ts` が `npm pack --dry-run --json` の一覧を読み、各 `.ts` の相対 import を解決して、一覧の外なら終了 1。`bash scripts/verify.sh` も typecheck の次にこれを走らせる。

残る既知の差は 1 つ。`package.json` は `private: true` で、`src/*.ts` をそのまま実行する。ビルド済み JS と `bin` は T18 で入れる。

同梱物の一覧を先に固定するのは、この差を T18 で閉じるためで、公開を先に進めるためではない。

## 3. 秘密とアカウント情報の検査

### 3.1 名簿の値（秘密）

```sh
bash scripts/peer-secrets.sh
```

`~/.seamless/peers.json` の名前が指す値（環境変数、無ければ Keychain）を、リポジトリ（本線と worktree）と `~/.seamless` から探す。1 件でも見つかれば終了 1。値は出力にも引数にも出さない。会話の保存先まで見る場合は `SEAMLESS_PEER_SECRETS_FULL=1`（数十分かかる）。

T13 で足したのは、名簿の有無に関係なく走る公開面の検査。`npm pack --dry-run` の一覧に載るファイルだけを、アカウント情報の目印（`grok-bot-vm`、`Bot ID`、`accountRef`）で走査する。目印は名簿の値ではないので、登録が無い機械でも走る。きれいなら何も出力しない。

### 3.2 アカウント情報（リポジトリ全体と同梱物）

```sh
git grep -n -e "grok-bot-vm" -e "Bot ID" -e "accountRef"
npm pack --dry-run --json --ignore-scripts
```

2026-10-19 の実測:

- 同梱物（上の 54 ファイル）: 0 件。
- リポジトリ全体で目印が現れるのは 4 か所だけ。`specs/`（要件文そのもの、5 行）、`docs/reports/`（Reason 比較の社内資料、3 行）、`scripts/peer-secrets.sh`（この検査の目印、2 行）、この文書（同じ目印、3 行）。
- したがってリポジトリ全体の grep は、検査器と要件文が目印を書く以上 0 にならない。Done when の意図は「公開物にアカウント固有情報が無い」なので、0 にできる範囲を公開物とする。`specs/` は本 Issue の禁止事項で編集しない。`docs/` と `scripts/` は同梱しない。

公開物に限った確認は次の 1 行で、0 件になる。

```sh
git grep -n -e "grok-bot-vm" -e "Bot ID" -e "accountRef" -- . ':!specs' ':!docs' ':!scripts'
```

### 3.3 同梱物の一覧に禁止の 3 つが無いこと

```sh
npm pack --dry-run --json --ignore-scripts | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s)[0].files)console.log(f.path)})' | grep -E "^(mods|experiments)/|status-panel"
```

0 件（`grep` の終了 1）なら良い。2026-10-19 は 0 件。

## 4. 内部依存の一覧（AC12）

内部依存は 2 種に分ける。**内部形式の受動的な読取り**は許す。**内部 API の再現**（公開文書にない通信手順をコードで再現したもの）は、この表に載せたものだけ許す。載っていないものが見つかったら、公開物から外す（spec.md S6）。

### 4.1 内部形式の受動的な読取り（許す）

| 製品 | 形式 | 実装 | 読む内容 | 用途 |
|---|---|---|---|---|
| Claude Code | `~/.claude/sessions/<pid>.json` | `src/adapters/claude.ts`、`src/native-runtime.ts` | `sessionId`、`cwd`、`startedAt`、`procStart`、`messagingSocketPath`、`kind`、`status`、`name`、`peerProtocol` | 会話の発見と受信口の有無 |
| Claude Code | `~/.claude/projects/<cwd を符号化した名前>/<sessionId>.jsonl` | `src/adapters/claude.ts`、`src/adapters/read.ts` | 依頼 ID の出現、ターン開始、`replyTo` | 渡った / 処理中 / 返事の証拠 |
| Codex Desktop | `~/.codex/state_5.sqlite` の `threads` 表 | `src/sessions-scan.ts` | `id`、`cwd`、`archived`、`updated_at_ms` | 会話の一覧 |
| Codex | `~/.codex/sessions/`、`~/.codex/archived_sessions/` の rollout | `src/adapters/codex.ts` | 会話の存在、依頼 ID、turn、`replyTo` | 発見の補助と証拠 |
| Grok CLI | `~/.grok/active_sessions.json` | `src/adapters/grok.ts` | `session_id`、`pid`、`cwd`、`opened_at` | 動いている会話の発見 |
| Grok CLI | `~/.grok/sessions/<cwd を符号化した名前>/<id>/summary.json`、`updates.jsonl` | `src/adapters/grok.ts` | `info`、`last_active_at`、`session_kind`、user / agent の message chunk | 発見、本文の読取り、証拠。`thoughts`、`chat_history.jsonl`、`tool_inputs`、`tool_results`、`hook_executions` は読まない |
| Antigravity CLI | 実行ファイルの場所と `~/.gemini/antigravity-cli/settings.json`、同 `hooks/` | `src/adapters/antigravity.ts`、`src/setup.ts`、`src/doctor.ts` | 実行ファイルの有無、hooks の有無 | 検出だけ。会話は読まない（phase 2、S5） |
| 全製品（doctor） | `.claude/settings.json`、`.claude/settings.local.json`、`.codex/config.toml`、`.grok/config.toml`、`.cursor/hooks.json`、`.config/opencode/opencode.json`、`.gemini/settings.json`、`.gemini/antigravity-cli/settings.json` | `src/doctor.ts` | hooks 表の中の文字列 | Reason Network の配線の検出だけ。値は返さない |

Cursor CLI と opencode は、製品の内部形式を読まない。Cursor は公式 hooks の標準入力、opencode は公式 plugin API で会話の識別子を受け取り、seamless 側の `~/.seamless/peers/` と受信箱だけを使う。

### 4.2 内部 API の再現（この表にあるものだけ許す）

| 対象 | 形式 / 手順 | 実装 | v1 での使用 | 決定 |
|---|---|---|---|---|
| Codex Desktop IPC | `~/.codex/ipc/ipc.sock`、4 バイト little-endian の長さ + JSON。`initialize`、`thread-owner-discovery`、`thread-stream-following-changed`、`thread-follower-load` | `src/adapters/codex.ts`、`src/native-runtime.ts` | 会話の所有者と状態の読取り | H2（2026-10-19、読取りに使い続ける） |

**既知の差（#22）**: 現在の送信経路（`src/native-runtime.ts` の Codex 分岐）は `thread-follower-start-turn` も呼ぶ。T03 で作った `codex queue --thread` への切替が送信経路にまだ接続されていないため。H2 が認めたのは読取りで、書込みはこの差が解消するまでの暫定。公開前に、queue へ切り替えるか H2 の範囲を広げるかを決める。決めるまで公開しない。

**この表に無いもの**: Grok Bot の玄関口（gateway）。v1 では実装しない（webhook だけ）。実装するときは、この表に載せて H6 の確認を通すまで公開物に入れない。Claude の会話 socket は公式文書の peer protocol に対応する経路で、内部 API の再現ではない（sessions JSON の読取りは 4.1）。

### 4.3 H6 の確認欄（公開前）

H6 は、外部へ出る経路と製品側の hooks を、各社の規約で確認すること。3 つとも未確認の間は公開しない（spec.md S7）。確認したら日付、出典 URL、版を書く。担当は立花さん（ループの外、H6）。

| 対象 | 確認する文書 | 確認する内容 | 状態 | 確認日 | 記録 |
|---|---|---|---|---|---|
| Grok Bot の webhook | xAI Grok Bot の利用規約と webhook の仕様 | 自動投稿が許されるか。外部（Mac の外）へ本文が出る範囲。レート制限。再配布 | 未確認 | | |
| Cursor の hooks | Cursor の利用規約と hooks の文書 | hook からの注入と自動実行が許されるか。会話への書き込みの扱い | 未確認 | | |
| Antigravity の hooks | Google Antigravity の利用規約と hooks / 設定の文書 | hook の自動実行と、T3 Code 管理の実行ファイルの利用が許されるか | 未確認 | | |

## 5. 公開までの順番（T18）

1. H5（名前、配布名、ライセンス、公開日）を決める。
2. H6 の 3 行を埋める。埋まらないまま公開日が来たら公開を延期する（S7）。
3. T14 で README（EN / JA）、LICENSE、NOTICE、SECURITY.md を書き、4 章の内部依存の一覧を README か NOTICE に載せる（AC12 の「公開物の説明に載せる」）。
4. T18 で、この文書の予定一覧と `npm pack --dry-run` を `diff` し、ビルド済み JS、`bin`、2 章の既知の差を閉じる。
5. `npm publish` はループから実行しない。H5 と H6 の後に、人が実行する。
