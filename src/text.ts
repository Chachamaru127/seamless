// The text helpers `status-exchanges.ts` uses, kept in the published set so it imports nothing from `mods/`
// (Plans 1 章 5: the band mod stays internal). Same implementations as mods/seamless-band/hooks/text.ts.

/** Collapses runs of whitespace, newlines included, to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cuts `text` to `max` characters, marking the cut with an ellipsis. */
export function clip(text: string, max: number): string {
  const points = Array.from(text)
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : text
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
