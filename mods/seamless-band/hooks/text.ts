/** Collapses runs of whitespace, newlines included, to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cuts `text` to `max` characters, marking the cut with an ellipsis. */
export function clip(text: string, max: number): string {
  const points = Array.from(text)
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : text
}

/**
 * The sentence Claude is thinking right now: the tail of the thought so far,
 * with the sentence before it when the current one has barely started.
 *
 * @param thought the thinking block's text so far
 * @param max the longest snippet, cut from the front
 */
export function thoughtOf(thought: string, max: number): string {
  const flat = oneLine(thought.replace(/[*_`#>]/g, ''))

  if (flat === '') {
    return ''
  }

  const sentences = flat.split(/(?<=[.!?:])\s+|(?<=[。！？])/).filter(Boolean)
  const last = sentences.at(-1) ?? ''
  const before = sentences.at(-2)
  const tail = last.length < 25 && before !== undefined ? `${before} ${last}` : last

  return tail.length > max ? `…${tail.slice(-(max - 1))}` : tail
}

/** `840 B`, `2.3 KB`, `1.1 MB`. */
export function sizeOf(chars: number): string {
  if (chars < 1024) {
    return `${chars} B`
  }

  if (chars < 1024 * 1024) {
    return `${(chars / 1024).toFixed(1)} KB`
  }

  return `${(chars / 1024 / 1024).toFixed(1)} MB`
}

/** Whole seconds, compact minutes after one minute. */
export function durationOf(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

/**
 * A label safe to draw: control, format and line-separator characters out
 * (the engine refuses a drawing holding one), whitespace collapsed, and cut
 * to `max`. Labels carry paths, commands and thoughts the model wrote.
 */
export function printable(text: string, max: number): string {
  return clip(visible(text), max)
}

/** The text as drawn: control and separator characters spaced out, invisible ones dropped, whitespace collapsed. */
export function visible(text: string): string {
  return oneLine(text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, ''))
}

/** The characters a streamed chunk adds, spaces left out: Japanese has no words to count. */
export function charsIn(chunk: string): number {
  return Array.from(chunk.replace(/\s+/g, '')).length
}

/**
 * A reply that only lets work go on — 「やっていいよ」「進めて」「承認」「A,進める」 — carries no aim of its own,
 * so the band keeps the last instruction that did (design v5). Anything with a word of its own, such as
 * 「別件も直して」, is a new aim.
 */
const ACKNOWLEDGMENTS = /^(やって(いい|ok|オッケー)?よ?|やっていい|進めて(ください|いい|ok)?|進める|続けて(ください)?|続ける|ok|okay|オッケー|おけ|はい|うん|ええ|お願い(します)?|よろしく(お願いします)?|承認(する|します)?|いいよ|いいね|いいです|それで(お願い(します)?|いい|ok)?|推奨で|推奨どおり|go|yes|y|了解(です)?|りょうかい|どうぞ|やって|完了させて|やった|yatta|外す|外した|可|否|後で|あとで)$/
export function isAcknowledgment(prompt: string): boolean {
  const parts = prompt.toLowerCase().split(/[\s\n]+/).map(p => p.replace(/[。、．，,.!！?？「」『』"'（）()・…〜~ー-]+$/g, '')).filter(Boolean)
  if (parts.length === 0) return false
  // A choice answered by its letter or number (「A,進める」「B,１往復した後」) is a decision on the AI's question, not a new aim.
  return parts.every(p => ACKNOWLEDGMENTS.test(p.replace(/[。、．，,.!！?？]/g, '')) || /^[a-z0-9０-９][,、:：.．]\S{0,16}$/.test(p))
}
