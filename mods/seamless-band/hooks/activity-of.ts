import { clip, oneLine } from './text'

const MAX_DETAIL_CHARS = 60

/**
 * Says in a few words what a tool call is doing, for What's Agent Doing.
 *
 * @param tool the tool's name; a string, as the declared names are only the
 *   tools of the build that wrote the types (Grep and Glob are on some only)
 * @param args the call's arguments, whole or as far as they have streamed
 * @returns a short label such as `Reading register.tsx`
 */
function purposeOf(tool: string, args: Record<string, unknown>): string {
  const arg = (key: string): string => {
    const value = args[key]

    return typeof value === 'string' ? clip(oneLine(value), MAX_DETAIL_CHARS) : ''
  }

  const file = (key: string): string => baseName(arg(key))

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return arg('description') || `コマンドを実行: ${arg('command')}`
    case 'Read':
      return `ファイルを読む: ${file('file_path')}`
    case 'Edit':
      return `ファイルを編集: ${file('file_path')}`
    case 'Write':
      return `ファイルを書く: ${file('file_path')}`
    case 'NotebookEdit':
      return `ノートを編集: ${file('notebook_path')}`
    case 'Grep':
      return `内容を検索: "${arg('pattern')}"`
    case 'Glob':
      return `ファイルを探す: ${arg('pattern')}`
    case 'WebFetch':
      return `ページを取得: ${hostOf(arg('url'))}`
    case 'WebSearch':
      return `ウェブを検索: "${arg('query')}"`
    case 'Agent':
    case 'Task':
      return `子エージェントを実行: ${arg('description')}`
    case 'TodoWrite':
      return '作業一覧を更新'
    case 'AskUserQuestion':
      return '回答待ち'
    case 'Skill':
      return `skill を使う: ${arg('skill')}`
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
    const [, server = '', name = ''] = tool.split('__')

    return `${server} を使う: ${name}`
  }

  return `${tool} を使う`
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

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function activityOf(tool: string, args: Record<string, unknown>): string {
  return `道具を使っている: ${purposeOf(tool, args)}`
}
