# 製品別の能力・公式性・規約の表（計画用・2026-10-19）

これは計画の材料で、製品仕様の正本ではない。`公式` は公開文書で確認できたもの、`内部` は非公開のファイル/API、`未確認` はこの調査で確かめていないもの。

| 製品 | 発見 | 配送段階 | 届ける仕組み | 同一性 | 証拠 | 公式性 | seamless 現行 | 規約・法務 | 優先 |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | `~/.claude/sessions/<pid>.json` と pid、cwd、socket | push / turn | 会話ソケット、hooks（SessionStart、Stop、PostToolUse）、MCP、`--remote-control` | session ID、pid、cwd、世代 | ソケット書込み、hook receipt、履歴の `replyTo` | hooks と MCP は公式。session JSON と socket は内部。Remote Control は公式だが Anthropic 契約限定 | 対応済み（socket、hooks） | 内部 socket の利用は公式契約ではない。Remote Control は Pro/Max/Team/Enterprise 限定、API key 不可 | 1 |
| Codex | Desktop: `~/.codex/state_5.sqlite` と IPC。CLI: app-server | push / turn | Desktop IPC、app-server `turn/start`、`codex queue --thread`、hooks（PostToolUse、Stop）、MCP | thread ID、turn ID、cwd、世代 | IPC 応答、turn の位置、履歴 | app-server と hooks は比較的公式。Desktop IPC は内部 | 対応済み（Desktop IPC） | Desktop IPC は非公開。CLI は app-server 契約に従う | 1 |
| Grok CLI | `~/.grok/active_sessions.json`、pid、cwd | turn | hooks（PostToolUse、Stop）、MCP | session ID、pid、cwd、世代 | hook receipt、hook note、次の発話 | hooks は公式。active_sessions は内部 | 対応済み（受信箱 + Stop hook） | 内部ファイルの利用は公式契約ではない | 1 |
| opencode | plugin API、session events | push | plugin の `session.promptAsync` / `prompt`、MCP | session ID、cwd、busy/idle | plugin の応答、session event | plugin API は公式 | 未対応 | 公式 API の範囲。v1 の第4候補 | 2 |
| Cursor | hooks、MCP | turn | postToolUse、stop、background command、MCP | session ID（未確認）、cwd | hook receipt、transcript | hooks は公式。セッション ID の取得は未確認 | 未対応 | 公式 hooks の範囲 | 2 |
| Gemini CLI | hooks、MCP | turn | AfterTool、AfterAgent、experimental background shell、MCP | session ID（未確認） | hook receipt、transcript | hooks は公式。background shell は実験 | 未対応 | 実験機能に依存 | 2 |
| Copilot CLI | hooks、MCP | turn | postToolUse、agentStop、notification、MCP | session ID（未確認） | hook receipt、transcript | hooks は公式 | 未対応 | 公式 hooks の範囲 | 2 |
| Pi | extension API、MCP | push | `sendUserMessage`、session events | session ID、cwd | extension の応答 | extension は公式 | 未対応 | 公式 API の範囲 | 2 |
| Amp | plugin API、MCP | push | `thread.appendUserMessage` | thread ID | plugin の応答 | plugin は公式 | 未対応 | 公式 API の範囲 | 3 |
| DeepSeek Harness | MCP | pull | MCP の `check_inbox` | session（未確認） | MCP の応答 | MCP のみ | 未対応 | 公式 MCP の範囲 | 3 |
| Grok Bot | webhook、玄関口、routine、SSH | push + reply | webhook、玄関口（内部 API）、routine、SSH でログ | Bot ID、依頼 ID、nonce | 受理記録、会話項目、echo ID、返信 | webhook は利用者設定。玄関口は内部 | webhook 対応済み。玄関口は Nestra で開発中 | 玄関口は非公開 API の再現。公開前に規約確認 | 1（遠隔） |
| Dot | MCP Events、Tunnel | push | events/subscribe、callback、tunnel | session、callback | callback 200、会話への表示 | MCP Events は草稿/標準化途中 | 試作のみ | 草稿仕様。公開前に確認 | 2（遠隔） |
| Claude Remote Control | Anthropic API に登録、poll | push（対話） | Anthropic API 経由の remote control | Claude session ID | 画面/会話 | 公式。ただし Anthropic 契約限定 | 未対応 | API key 不可、契約限定。transport としては閉じている | 3（遠隔） |
| Reason Network | daemon、iroh、CLI | push / turn / pull | Reason の独自プロトコル | session ID、repo、branch | ack、receipt | エンジンは OSS、CLI は proprietary | 未対応 | 独自プロトコル。ブリッジは互換を名乗らない | 3（ブリッジ） |

## この表から言えること

- 「全CLI」は、同じ1つの仕組みでは届かない。push / turn / pull の3段に分かれる。
- 公式の hooks / plugin がある製品は、比較的安定して対応できる。Claude Code、Codex、Grok CLI、opencode、Cursor、Gemini CLI、Copilot CLI、Pi、Amp。
- 内部ファイル/APIに依存する製品は、法務と保守の危険が高い。Claude Code の socket、Codex Desktop の IPC、Grok の active_sessions、Grok Bot の玄関口。
- 最初の3製品は、公式性と現行資産で選ぶ。Claude Code、Codex、Grok CLI。opencode は第4候補。
- 遠隔の第一候補は、Grok Bot の webhook（既に実会話で往復）と Dot の MCP Events（試作）。Claude Remote Control は Anthropic 契約に閉じるので、一般の transport にはしない。
- A2Aを外側の共通言語にする場合、各製品の「セッション」をA2AのAgentとして見せる。A2AはHTTP前提なので、ローカルの push は hooks/plugin のまま。A2Aは遠隔と外部クライアントの入口に使う。

## 未確認（推測で埋めない）

- Cursor、Gemini CLI、Copilot CLI のセッション ID の取得方法。
- opencode の plugin API が、外部プロセスからの push を受けられるか。
- Dot の MCP Events が、2026-10時点で標準か草稿か。
- Claude Remote Control を、Anthropic 以外のクライアントから使えるか。
- Reason の独自プロトコルを、A2Aにブリッジできるか。
