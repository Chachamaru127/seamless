# 公開の手順と公開面（release）

状態: 2026-10-19 起草（Issue #17 / T13）。2026-10-20 に T18（Issue #19）で同梱物を最終確認し、公開手順と停止条件を確定した。同じ 2026-10-20 に H5 の名前と配布名が決まり（`@chachamaru127/seamless`、D7）、`package.json` の `private` を外して `bin` を設定した（Issue #30）。2026-10-20 の Issue #42 で `dist/` を作るビルドを足し、`bin` と hook と manifest をその側へ付け替えた。install 後の入口は動くようになり、6 章の停止条件 1 を閉じた（1.2）。H6 と公開日は未決で、それが閉じるまで公開しない。正本は `specs/2026-10-universal-wiring/spec.md` の AC12 と Plans.md 1 章 5、8 章。

この文書は 3 つを決める。何を `npm pack` に入れるか、どの内部依存を公開物に載せるか、公開前に誰が何を確認するか。

## 1. 同梱物の正本

同梱物の正本は `package.json` の `files`（許可したものだけを入れる）。加えて npm は `package.json`、`README*`、`LICENSE*`（`LICENCE*` も）を `files` に関係なく必ず入れる。`.npmignore` は `files` を外したときに同じ面を保つための同じ除外で、npm は `files` がある間は読まない。

| 入れる | 中身 | 入る理由 |
|---|---|---|
| `dist/` | ビルド済みの JS（アダプタ、CLI、MCP、配送、状態、`manifests/*.json`） | 製品本体。`npm run build` が `src/*.ts` から作り、`src/status-panel.ts` はビルドから除く |
| `hooks/` | Cursor と Grok CLI の hook 1 枚ずつ | 製品側に置く配線。`dist/` があれば `dist/` の JS を、無ければ `src/` の `.ts` を起動する |
| `packages/opencode-plugin/` | opencode の plugin（`index.ts` と、ビルドが置く `index.js`） | `opencode.json` がこの directory を読み、`dist/adapters/opencode.js` が `index.js` を import する |
| `README.md`、`README.ja.md` | 入口の説明 | `files` の `README.md` と、npm が必ず入れる `README*` |
| `LICENSE` | MIT の本文 | npm が必ず入れる `LICENSE*` |
| `package.json` | 定義 | npm が必ず入れる |

`NOTICE` と `SECURITY.md` はどちらも自動では入らない。2026-10-20 の tarball にも入っていない（1.1 の一覧に無い）。同梱される `README.md` と `README.ja.md` は両方へリンクするので、tarball の中ではその 2 つのリンクが切れる。直し方は `files` に 2 行足すことだが、`package.json` は T18 の触るファイルではない。T18 は決めずに 6 章の停止条件へ送った。

### 1.1 確定一覧（2026-10-20、T18）

60 ファイル、展開後 548,045 バイト（2026-10-20、Issue #42 の実測。ビルド後の `dist/` を含む）。T18（Issue #19）の時点は 57 ファイル、471,913 バイト、Issue #30 の時点は 58 ファイル、483,010 バイト（#27 で `src/manifests/cursor.json` が加わり、`package.json` と README を更新した分を含む）。`npm pack --dry-run --json --ignore-scripts` の `files[].path` を `LC_ALL=C sort` したもの。リポジトリの根元で `npm run build` のあとに次の 1 行を走らせて、実物と突き合わせる。出力が空で終了 0 なら一致。T18（Issue #19）の Done when は、この 1 行が終了 0 になること。

```sh
npm pack --dry-run --json --ignore-scripts \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s)[0].files)console.log(f.path)})' \
  | LC_ALL=C sort \
  | diff - <(awk '/^<!-- pack-list:start -->$/{f=1;next} /^<!-- pack-list:end -->$/{f=0} f' docs/release.md)
```

`awk` は下の目印の間だけを取り出す。`diff` の左が実物、右がこの文書の予定。

```text
<!-- pack-list:start -->
LICENSE
README.ja.md
README.md
dist/adapters/antigravity.js
dist/adapters/claude.js
dist/adapters/codex.js
dist/adapters/cursor.js
dist/adapters/grok.js
dist/adapters/opencode.js
dist/adapters/read.js
dist/adapters/session.js
dist/appearance.js
dist/automatic.js
dist/bot-executor.js
dist/bot-sign.js
dist/caller.js
dist/cli.js
dist/compat-check.js
dist/compat.js
dist/core/manifest.js
dist/delivery.js
dist/discovery.js
dist/doctor.js
dist/external-inbound.js
dist/git-context.js
dist/grok-hook.js
dist/grok-inbox.js
dist/inbound.js
dist/io.js
dist/limits.js
dist/manifests/antigravity.json
dist/manifests/claude.json
dist/manifests/codex.json
dist/manifests/cursor.json
dist/manifests/grok-bot.json
dist/manifests/grok-cli.json
dist/manifests/opencode.json
dist/manifests/phase2/antigravity.json
dist/mcp.js
dist/native-runtime.js
dist/nonce-store.js
dist/peers.js
dist/protocol.js
dist/registry.js
dist/request-store.js
dist/secrets.js
dist/seen.js
dist/serve.js
dist/sessions-scan.js
dist/setup.js
dist/signed-envelope.js
dist/status-exchanges.js
dist/status.js
dist/text.js
dist/webhook-send.js
hooks/cursor/seamless-hook.sh
hooks/grok-cli/seamless-hook.sh
package.json
packages/opencode-plugin/index.js
packages/opencode-plugin/index.ts
<!-- pack-list:end -->
```

一覧は 2026-10-20 に確定した（T18）。根拠は 3 つ。(1) 2 章の 4 つ（`mods/`、`experiments/`、`status-panel`、旧 `--registry` の登録例）が入っていない。(2) `node scripts/pack-check.ts` が、同梱する各ファイルの相対 import を一覧の中で解決する。(3) 3 章の公開面スキャンが 0 件。`package.json` の `files` かビルドの対象を変えたら `diff` が落ちるので、そのときにこの一覧を更新する。T18 の実測は、`diff` が出力なしで終了 0、`entryCount` 57、`unpackedSize` 471,913。#30 の実測は 58、483,010。#42 の実測は `diff` が出力なしで終了 0、`entryCount` 60、`unpackedSize` 548,045。

### 1.2 公開物の入口（2026-10-20、Issue #30 / H5、Issue #42）

`package.json` は名前 `@chachamaru127/seamless`、`private` 無し、`bin` の `seamless` → `dist/cli.js`、`publishConfig.access: public`（scoped package の既定は restricted なので明示する）。`src/cli.ts` の 1 行目には `#!/usr/bin/env node` を置き、`npm run build` が `tsconfig.build.json` で `dist/cli.js` に写す（`scripts/build-assets.ts` が manifest と opencode plugin の JS を配置する）。

#30 の実測（2026-10-20、Node 24.19.0）: `bin` が `src/cli.ts` を指していたため、`npm pack` の tarball を `npm install --prefix <tmp> --offline` で入れ、`node_modules/.bin/seamless doctor --json` を実行すると終了 1。`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` で、Node は `node_modules` の下にある `.ts` の型注釈を取り除かない（`--experimental-strip-types` を付けても同じ。`node_modules` の外の同じファイルは動く）。`npx` の cache は `_npx/<hash>/node_modules/` なので同じ制約に入る。

#42 で入口を `dist/` へ移した。`hooks/cursor/seamless-hook.sh` と `hooks/grok-cli/seamless-hook.sh` は `dist/` があれば `dist/adapters/cursor.js` と `dist/grok-hook.js` を、無ければ `src/` の `.ts` を起動する。`src/setup.ts` は `dist/` から実行されたとき `~/.claude.json` に `dist/cli.js` を書き、hook と manifest はパッケージ根元の `hooks/` と `dist/manifests/` を読む。実測（2026-10-20、Node 24.19.0）: `npm run build && npm pack` の tarball を一時フォルダに展開し、`HOME=$(mktemp -d) node <展開先>/package/dist/cli.js setup --dry-run` は終了 0、標準エラーに `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` を含まない。同じ検査を `scripts/verify.sh` が毎回走らせる。

## 2. 同梱物から外すもの

Plans.md 1 章 5 の 4 つ。どれもリポジトリと試験には残す。

| 対象 | 同梱物から外すもの | 内部と試験に残るもの | 外す理由 |
|---|---|---|---|
| 旧 `--registry` 方式 | 登録例（`specs/`）、旧手順（T14 で書き直した README から削除済み）、`tests/` | `src/registry.ts`、`--registry` / `--caller` / `migrate` の経路、その試験 | 既定の自動方式と共通の型と配送を使うため、コードだけを先に切れない。公開物は `src/registry.ts` を含む（1.1） |
| Claude Desktop の band mod | `mods/seamless-band/`、`.claude-plugin/` | 同左（別 plugin として配布） | 独立した plugin。上流ライセンスは NOTICE に収録する（T14） |
| status panel | `src/status-panel.ts`、`src/status-panel.html`、`codex-plugin/` | 同左、`scripts/mcp-panel.ts`（内部の起動口）、`tests/status-panel.test.ts` | Codex の右パネルは実験。v1 の公開面は CLI と MCP の 4 道具に絞る |
| Dot の実験 | `experiments/` | 同左 | 非接続の試作。Dot は v1 の対象外（spec.md の対象外） |

### 同梱物の中だけで閉じていること（T13 で解消済み）

同梱物のファイルが同梱物の外を import すると、公開後に `mcp` や CLI が読み込めなくなる。T13 の判定で 2 件見つかり、どちらも直した（2026-10-19）。

1. `src/mcp.ts` は `./status-panel.ts` を import しない。status panel は内部の起動口 `scripts/mcp-panel.ts` から `createMcp` へ渡し、同梱する MCP は 4 道具だけを並べる。
2. `src/status-exchanges.ts` は band mod を import しない。色は `src/appearance.ts`、文字は `src/text.ts` に移し、どちらも同梱物に含める。

`node scripts/pack-check.ts` が `npm pack --dry-run --json` の一覧を読み、同梱するファイルの相対 import を解決して、一覧の外なら終了 1。公開物が `dist/` を含むときは `dist/*.js` と manifest が指す adapter を、含まないとき（リポジトリの最小コピー）は従来どおり `.ts` を見る。`bash scripts/verify.sh` も typecheck とビルドの次にこれを走らせる。

T18 の時点で既知の差は 2 つあった。1 つ目（`private: true` と `bin` の不在）は 2026-10-20 に `package.json` へ反映し、install 後の入口が動かなかった分は #42 で `dist/` へのビルドと `bin` の付け替えで閉じた（1.2）。2 つ目も 6 章 2 に残す。

1. `NOTICE` と `SECURITY.md` が `files` に無く、同梱 README から張られたリンクが tarball の中で切れる。

同梱物の一覧を先に固定するのは、この差を閉じたときに差分がここへ 1 行で出るようにするためで、公開を先に進めるためではない。

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

2026-10-20 の実測:

- 同梱物（1.1 の 58 ファイル）: 0 件。`peer-secrets.sh` の公開面スキャンと同じ手順（一覧の各ファイルを `grep -aqF` で 3 目印に当てる）を、Keychain を読まない形で単独に走らせた結果。2026-10-20 の T18 は 57 ファイルで同じ 0 件、#30 で `src/manifests/cursor.json` を足した 58 ファイルでも再確認して 0 件。
- リポジトリ全体で目印が現れるのは 4 か所だけ。`specs/`（要件文そのもの、5 行）、`docs/reports/`（Reason 比較の社内資料、3 行）、`scripts/peer-secrets.sh`（この検査の目印、2 行）、この文書（同じ目印、3 行）。合計 13 行。
- したがってリポジトリ全体の grep は、検査器と要件文が目印を書く以上 0 にならない。Done when の意図は「公開物にアカウント固有情報が無い」なので、0 にできる範囲を公開物とする。`specs/` は本 Issue の禁止事項で編集しない。`docs/` と `scripts/` は同梱しない。

公開物に限った確認は次の 1 行で、0 件になる。

```sh
git grep -n -e "grok-bot-vm" -e "Bot ID" -e "accountRef" -- . ':!specs' ':!docs' ':!scripts'
```

### 3.3 同梱物の一覧に禁止の 3 つが無いこと

```sh
npm pack --dry-run --json --ignore-scripts | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s)[0].files)console.log(f.path)})' | grep -E "^(mods|experiments)/|status-panel"
```

0 件（`grep` の終了 1）なら良い。2026-10-20 は 0 件。

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
| Antigravity CLI | 実行ファイルの場所と `~/.gemini/antigravity-cli/settings.json`、同 `hooks/` | `src/adapters/antigravity.ts`、`src/setup.ts`、`src/doctor.ts` | 実行ファイルの有無、hooks の有無 | 検出だけ。会話は読まない（phase 2、S5）。利用規約の確認: 未（本人の目視待ち）、確認日: 未、該当条項: 未（4.3） |
| 全製品（doctor） | `.claude/settings.json`、`.claude/settings.local.json`、`.codex/config.toml`、`.grok/config.toml`、`.cursor/hooks.json`、`.config/opencode/opencode.json`、`.gemini/settings.json`、`.gemini/antigravity-cli/settings.json` | `src/doctor.ts` | hooks 表の中の文字列 | Reason Network の配線の検出だけ。値は返さない |

Cursor CLI と opencode は、製品の内部形式を読まない。Cursor は公式 hooks の標準入力、opencode は公式 plugin API で会話の識別子を受け取り、seamless 側の `~/.seamless/peers/` と受信箱だけを使う。

### 4.2 内部 API の再現（この表にあるものだけ許す）

| 対象 | 形式 / 手順 | 実装 | v1 での使用 | 決定 |
|---|---|---|---|---|
| Codex Desktop IPC | `~/.codex/ipc/ipc.sock`、4 バイト little-endian の長さ + JSON。`initialize`、`thread-owner-discovery`、`thread-stream-following-changed`、`thread-follower-load` | `src/adapters/codex.ts`、`src/native-runtime.ts` | 会話の所有者と状態の読取り | H2 で決定済み（2026-10-19、読取りに使い続ける）。利用規約の確認欄は H2 の判断で閉じた（確認日 2026-10-19、該当条項 —） |

**既知の差（#22）**: 現在の送信経路（`src/native-runtime.ts` の Codex 分岐）は `thread-follower-start-turn` も呼ぶ。T03 で作った `codex queue --thread` への切替が送信経路にまだ接続されていないため。H2 が認めたのは読取りで、書込みはこの差が解消するまでの暫定。公開前に、queue へ切り替えるか H2 の範囲を広げるかを決める。決めるまで公開しない。

**この表に無いもの**: Grok Bot の玄関口（gateway）。v1 では実装しない（webhook だけ）。実装するときは、この表に載せて H6 の確認を通すまで公開物に入れない。Claude の会話 socket は公式文書の peer protocol に対応する経路で、内部 API の再現ではない（sessions JSON の読取りは 4.1）。

**外部への送信**: Grok Bot の webhook は 4.1 の受動的な読取りにも 4.2 の再現にも当たらない。公開物に含む唯一の外部送信として、4.3 の 1 行目で扱う。利用規約の確認: 未（本人の目視待ち）、確認日: 未、該当条項: 未。

### 4.3 H6 の確認欄（公開前）

H6 は、外部へ出る経路と製品側の hooks を、各社の規約で確認すること。3 つとも未（本人の目視待ち）の間は公開しない（spec.md S7）。確認したら日付、出典 URL、該当条項、版を書く。担当は立花さん（ループの外、H6）。各経路が拠る公開文書の URL と 1 行の引用は、README の「Supported counterparts（対応している相手）」に置いた。ここは規約の確認だけを扱う。

| 対象 | 確認する文書 | 確認する内容 | 利用規約の確認 | 確認日 | 該当条項 | 記録 |
|---|---|---|---|---|---|---|
| Grok Bot の webhook | xAI Grok Bot の利用規約と webhook の仕様 | 自動投稿が許されるか。外部（Mac の外）へ本文が出る範囲。レート制限。再配布 | 未（本人の目視待ち） | 未 | 未 | 公開物に含む唯一の外部送信。内部依存の一覧ではこの行だけが送信で、ほかは受動的な読取り |
| Cursor の hooks | Cursor の利用規約と hooks の文書 | hook からの注入と自動実行が許されるか。会話への書き込みの扱い | 未（本人の目視待ち） | 未 | 未 | hooks の文書の URL は README に置いた |
| Antigravity の hooks | Google Antigravity の利用規約と hooks / 設定の文書 | hook の自動実行と、T3 Code 管理の実行ファイルの利用が許されるか | 未（本人の目視待ち） | 未 | 未 | 4.1 の Antigravity CLI の行にも同じ欄を置いた |

## 5. 公開までの順番（T18 で確定）

1. H5 の名前と配布名は決まった（2026-10-20、`@chachamaru127/seamless`、D7）。ライセンスは `MIT License`（T14 で設置済み）。残るのは公開日で、決めたら 1 行目に書く。MIT 以外にするなら `LICENSE` と README 2 枚の計 3 か所を差し替える。
2. H6 の 3 行（4.3）を埋める。埋まらないまま公開日が来たら延期する（spec.md S7）。
3. 6 章の停止条件を空にする。1 つでも残っている間は `npm publish` を実行しない。
4. 次の 5 つを上から順に走らせ、すべて期待どおりにする。

| # | コマンド | 期待する結果 | 2026-10-20 の実測 |
|---|---|---|---|
| 0 | `npm run build` | 終了 0、`dist/cli.js` ができる | 0（#42） |
| 1 | `bash scripts/verify.sh` | 終了 0（ビルドと tarball の起動検査を含む） | 0（#30 時点で試験 847 件、失敗 0。T18 は 842 件。#42 の tarball 検査は 1.2） |
| 2 | 1.1 の `diff` 1 行 | 出力なし、終了 0 | 一致（終了 0、60 ファイル） |
| 3 | `bash scripts/peer-secrets.sh` | `peer-secrets: ok`、終了 0 | 未実行。名簿があれば Keychain を読むのでループでは走らせない。人が実行する |
| 4 | 3.3 の `grep` | 0 件（`grep` の終了 1） | 0 件 |

5. `npm publish` はループから実行しない。H6 と公開日が決まり、上の 5 つが揃った時点で人が実行する。`npm publish` は `prepublishOnly` で `npm run build && node scripts/pack-check.ts` を先に走らせる。実行の直前にもう一度 `npm pack --dry-run` を見て、1.1 の一覧と一致することを確かめる。`npm publish` は scoped package を `publishConfig.access: public` で出すので、`--access` の指定は要らない。

## 6. 公開の停止条件（2026-10-20 時点）

`npm publish` を止めている理由。閉じたら日付と閉じ方をここに書く。上から順に閉じる必要はない。

| # | 止めている理由 | 今の状態 | 閉じる条件 | 閉じる人 |
|---|---|---|---|---|
| 1 | 同梱する実行コードが変換前の `.ts` だけで、ビルド済み JS も JS の起動役も無い。`bin` は `src/cli.ts` を指すが、Node は `node_modules` 内の `.ts` を実行しないため、`npm i -g` の後に `seamless` というコマンドは動かない | 閉じた（2026-10-20、Issue #42）。`dist/` に JS を出力し、`bin` を `dist/cli.js` へ、hook と manifest を `dist/` 側へ移した。tarball を展開して `HOME=$(mktemp -d) node <展開先>/package/dist/cli.js setup --dry-run` が終了 0（1.2、Node 24.19.0） | ビルド済み JS、または JS の起動役を同梱し、`bin` をそこへ向ける。変えたら 1.1 と 1.2 を更新する | #42 |
| 2 | `NOTICE` と `SECURITY.md` が tarball に入らず、同梱 README 2 枚から張られたリンクが切れる。AC12 の内部依存の一覧（4 章の 2 種の分類）はこの文書にだけあり、同梱物には無い（README は短い段落 1 つ、`NOTICE` は「Interfaces」の段落 1 つ） | 未対応（`package.json` の `files`） | `files` に `NOTICE` と `SECURITY.md` を足すか、4 章の表を README へ移す。足したら 1.1 を更新する | `package.json` を触る次の Issue |
| 3 | Codex の送信経路が `thread-follower-start-turn` をまだ呼ぶ（#22、4.2） | 未対応 | `codex queue --thread` へ切り替えるか、H2 の範囲を書込みまで広げる | 立花さん（H2 の範囲） |
| 4 | H5（名前、配布名、ライセンス、公開日） | 名前と配布名は決まった（`@chachamaru127/seamless`、2026-10-20、D7）。ライセンスは MIT。公開日は未決 | 公開日を決める。決めたら 1 行目に書く | 立花さん |
| 5 | H6 の 3 行（4.3） | 未確認 | 各社の規約を読み、日付、出典 URL、版を書く | 立花さん |
