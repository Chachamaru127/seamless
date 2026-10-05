import { clip, oneLine } from './text'

const MAX_DETAIL_CHARS = 60

/** Kana and kanji: the text a model wrote is shown only when it is Japanese. */
const JAPANESE = /[぀-ヿ㐀-鿿]/

/**
 * The Latin a shown text may hold: a file name, a few product names, and
 * numbers and marks with no letters. Anything else, a command, an address
 * or a key among them, sends the text back to a fixed phrase.
 */
const FILE_NAME = /^[A-Za-z_-][\w-]*\.(tsx?|jsx?|mjs|json|md|sh|py|html|css|txt|ya?ml|toml)$/
const PRODUCT_NAMES = new Set(['Claude', 'Codex', 'GitHub', 'seamless', 'MCP', 'UI', 'PR'])

function isAllowedLatin(run: string): boolean {
  const word = run.replace(/^[(\[「『"']+|[)\]」』"'.,:;!?、。]+$/g, '')

  // Numbers up to three digits and n/m: a longer number may be an argument or a key.
  if (!/[A-Za-z]/.test(word)) return /^\d{1,3}\/\d{1,3}$/.test(word) || (!/\d{4,}/.test(run) && !/[/\\:@`$=<>|{}]/.test(run))

  return FILE_NAME.test(word) || PRODUCT_NAMES.has(word)
}

/** True when `text` has kana or kanji in it. */
export function isJapanese(text: string): boolean {
  return JAPANESE.test(text)
}

/** Text the model wrote, as it may be shown: Japanese, with no command, address or key in it; else empty. */
export function plainText(text: unknown): string {
  if (typeof text !== 'string') return ''
  const flat = oneLine(text)

  const latin = flat.match(/[\x21-\x7e]+/g) ?? []

  return isJapanese(flat) && latin.every(isAllowedLatin) ? flat : ''
}

/** A subagent's name: its description when plain Japanese, else its handle (an identifier such as `reviewer`), else a fixed word. */
export function agentNameOf(description: unknown, handle?: unknown): string {
  const said = plainText(description)

  if (said !== '') return said
  if (typeof handle === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(handle)) return handle

  return '子エージェント'
}

/**
 * Says in plain Japanese what a tool call is doing, for What's Agent Doing.
 * Text the model wrote (a command's description, an agent's description, a
 * search) is shown only when it is Japanese; otherwise a fixed phrase stands.
 *
 * @param tool the tool's name; a string, as the declared names are only the
 *   tools of the build that wrote the types (Grep and Glob are on some only)
 * @param args the call's arguments, whole or as far as they have streamed
 * @returns a short label such as `register.tsx を読む`
 */
function purposeOf(tool: string, args: Record<string, unknown>): string {
  const arg = (key: string): string => {
    const value = args[key]

    return typeof value === 'string' ? clip(oneLine(value), MAX_DETAIL_CHARS) : ''
  }

  const file = (key: string): string => baseName(arg(key))
  const said = (key: string): string => clip(plainText(args[key]), MAX_DETAIL_CHARS)

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return said('description') || commandPurpose(typeof args['command'] === 'string' ? args['command'] : '')
    case 'Read':
      return `${file('file_path') || 'ファイル'} を読む`
    case 'Edit':
      return `${file('file_path') || 'ファイル'} を直す`
    case 'Write':
      return `${file('file_path') || 'ファイル'} を書く`
    case 'NotebookEdit':
      return `${file('notebook_path') || 'ノート'} を直す`
    case 'Grep':
      return said('pattern') ? `「${said('pattern')}」をファイルの中から探す` : 'ファイルの中を探す'
    case 'Glob':
      return 'ファイルを探す'
    case 'WebFetch':
      return 'ウェブのページを読む'
    case 'WebSearch':
      return said('query') ? `「${said('query')}」をウェブで調べる` : 'ウェブで調べる'
    case 'Agent':
    case 'Task':
      return said('description') ? `子エージェントに頼む: ${said('description')}` : '子エージェントに頼む'
    case 'TodoWrite':
      return '作業一覧を更新する'
    case 'AskUserQuestion':
      return 'あなたの回答を待っている'
    case 'Skill':
      return arg('skill') ? `手順書を使う: ${arg('skill')}` : '手順書を使う'
    case 'ToolSearch':
      return '使う道具を用意する'
    case 'SendUserFile':
      return 'あなたにファイルを送る'
    case 'Monitor':
      return '様子を見張る'
    case 'advisor':
      return '助言を聞く'
  }

  // seamless's own tools, said as what they do between the conversations.
  const seamless: Record<string, string> = {
    mcp__seamless__sessions: '相手の会話を探す',
    mcp__seamless__send: arg('track') ? '依頼の届き方を確かめる' : '相手の会話に送る',
    mcp__seamless__read: '相手の会話を読む',
    mcp__seamless__limits: 'seamless の制限を見る',
  }
  if (seamless[tool] !== undefined) return seamless[tool]

  if (tool.startsWith('mcp__')) {
    return serverPurpose(tool.split('__')[1] ?? '')
  }

  return '道具を使う'
}

/** What an MCP server's tools do, by the server's name. */
function serverPurpose(server: string): string {
  if (/browser|chrome|playwright/i.test(server)) return 'ブラウザを操作する'
  if (/computer-use/i.test(server)) return '画面を操作する'
  if (/^harness$/i.test(server)) return '記憶を探す'
  if (/^ccd_/i.test(server)) return 'アプリを操作する'
  if (/^[0-9a-f]{8}-/i.test(server) || server === '') return '外部の道具を使う'

  return `外部の道具を使う（${server}）`
}

/**
 * What a shell command does, in a fixed phrase. The command itself is never
 * shown: it can carry URLs, tokens and environment values.
 */
export function commandPurpose(command: string): string {
  const segments = command.split(/&&|\|\||[|;\n]/)

  for (const segment of segments) {
    const words = segment.trim().split(/\s+/).filter(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) && word !== 'sudo')
    const purpose = phraseOf(words)

    if (purpose !== null) return purpose
  }

  return 'コマンドを動かす'
}

function phraseOf(words: string[]): string | null {
  const [head = '', sub = ''] = words
  const name = baseName(head)

  if (name === '' || name === 'cd') return null
  if (['bash', 'sh', 'zsh', 'env', 'time', 'npx', 'bunx'].includes(name)) return phraseOf(words.slice(1)) ?? (name === 'npx' || name === 'bunx' ? 'スクリプトを動かす' : null)

  if (name === 'git') {
    const git: Record<string, string> = {
      status: '変更の状況を見る', diff: '変更の中身を見る', log: '履歴を見る', show: '履歴を見る',
      add: '保存する変更を選ぶ', commit: '変更を履歴に保存する', push: 'GitHub に送る',
      pull: '最新を取り込む', fetch: '最新を取り込む', checkout: 'ブランチを切り替える', switch: 'ブランチを切り替える',
    }

    return git[sub] ?? 'git を使う'
  }

  if (/verify\.sh$/.test(name) || name === 'vitest' || name === 'jest') return '試験を走らせる'
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
    if (sub === 'test' || words.includes('test')) return '試験を走らせる'
    if (sub === 'install' || sub === 'i' || sub === 'add') return '部品を入れる'

    return 'スクリプトを動かす'
  }
  if (name === 'tsc') return '型を確かめる'
  if (['cat', 'head', 'tail', 'sed', 'less', 'wc', 'awk'].includes(name)) return 'ファイルを読む'
  if (['grep', 'rg', 'ag'].includes(name)) return 'ファイルの中を探す'
  if (['ls', 'find', 'tree', 'fd'].includes(name)) return 'ファイルの一覧を見る'
  if (name === 'mkdir') return 'フォルダを作る'
  if (name === 'rm') return 'ファイルを消す'
  if (name === 'cp') return 'ファイルを写す'
  if (name === 'mv') return 'ファイルを移す'
  if (name === 'curl' || name === 'wget') return 'ネットから取ってくる'
  if (name === 'codex') return 'Codex に頼む'
  if (name === 'claude') return 'Claude Code を使う'
  if (name === 'gh') return 'GitHub を見る'
  if (name === 'sleep') return '待つ'
  if (['node', 'python', 'python3', 'deno', 'tsx'].includes(name) || /\.(sh|py|js|ts|mjs)$/.test(name)) return 'スクリプトを動かす'

  return null
}

/**
 * The string arguments a tool call's input has streamed so far, read from
 * its partial JSON: enough to name the file or command before it is whole.
 */
export function partialArgsOf(json: string): Record<string, unknown> {
  const args: Record<string, unknown> = {}

  for (const match of json.matchAll(/"([a-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)/g)) {
    const [, key = '', raw = ''] = match

    args[key] ??= unescaped(raw)
  }

  return args
}

function unescaped(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function activityOf(tool: string, args: Record<string, unknown>): string {
  return `道具を使っている: ${purposeOf(tool, args)}`
}
