// Single-color marks from the agreed 2026-10-03 Claude band mockup.
export const palette = {
  background: '#1d1d1b', text: '#e9e7e2', muted: '#8d8b85', active: '#8070f0',
  green: '#38c68e', orange: '#f9a437', red: '#fe3a52', badge: '#2a2a27', divider: '#2e2e2b',
} as const
export function logoSvg(provider: 'codex' | 'claude', color: string): string {
  const source = provider === 'codex' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3.2a4.4 4.4 0 0 1 4.3 3.4 4.4 4.4 0 0 1 3.9 6.3 4.4 4.4 0 0 1-3.6 7.3 4.4 4.4 0 0 1-7.3.6 4.4 4.4 0 0 1-5.4-5 4.4 4.4 0 0 1 1.3-7.6A4.4 4.4 0 0 1 12 3.2z"/><circle cx="12" cy="12" r="2.6"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.8 4h3.1l6 16h-3.1zM7.1 4h3.3l6 16h-3.2l-1.3-3.5H5.6L4.3 20H1.1zm-.5 9.7h4.3L8.7 7.9z"/></svg>'
  return source.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replaceAll('currentColor', color)
}

// The second band (design-v2, 2026-10-05) draws inside the app's own card:
// text takes the app's theme keys, so light and dark follow the app; the
// marks are SVG in mid tones that read on both.

/** Theme keys of the app's palette, as the Desktop app draws them. */
export const theme = { text: 'text', meso: 'inactive', subtle: 'subtle', success: 'success', warning: 'warning', error: 'error' } as const

/** Mid tones for the SVG marks, legible on the light and the dark card. */
export const tone = { live: '#8070f0', ok: '#2f8f5b', attn: '#d9752b', fail: '#d64545', idle: '#8d8b85' } as const

/** Brand tiles for the right side: a white mark on the company's color, legible on the light and the dark card. */
const BRAND = { codex: '#10a37f', claude: '#d97757' } as const
export function brandSvg(provider: 'codex' | 'claude'): string {
  // The mark's paint (fill, stroke) sits on its <svg> tag: carry it onto the group that replaces the tag.
  const source = logoSvg(provider, '#ffffff')
  const paint = (source.match(/^<svg ([^>]*)>/)?.[1] ?? '').replace(/\s*(xmlns|viewBox)="[^"]*"/g, '')
  const mark = source.replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${BRAND[provider]}"/><g transform="translate(4 4) scale(.6667)" ${paint.trim()}>${mark}</g></svg>`
}

/** A state color of the exchanges (the first band's palette) as a theme key and a mark tone. */
export function stateTone(color: string): { key: string; mark: string } {
  if (color === palette.green) return { key: theme.success, mark: tone.ok }
  if (color === palette.orange) return { key: theme.warning, mark: tone.attn }
  if (color === palette.red) return { key: theme.error, mark: tone.fail }
  return { key: theme.subtle, mark: tone.idle }
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14">${body}</svg>`

/** The 14px marks: the state of the line, and of each plan item. */
export const marks = {
  live: svg(`<circle cx="7" cy="7" r="4" fill="${tone.live}"/><circle cx="7" cy="7" r="6" fill="none" stroke="${tone.live}" stroke-opacity=".35"/>`),
  idle: svg(`<circle cx="7" cy="7" r="3.5" fill="${tone.idle}"/>`),
  ok: svg(`<circle cx="7" cy="7" r="7" fill="${tone.ok}"/><path d="M4 7.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  attn: svg(`<circle cx="7" cy="7" r="7" fill="${tone.attn}"/><path d="M7 3.6v4.2" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="7" cy="10.2" r=".95" fill="#fff"/>`),
  fail: svg(`<circle cx="7" cy="7" r="7" fill="${tone.fail}"/><path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`),
  stopped: svg(`<circle cx="7" cy="7" r="7" fill="${tone.idle}"/><rect x="4.6" y="4.6" width="4.8" height="4.8" rx=".8" fill="#fff"/>`),
  tick: svg(`<path d="M3.5 7.3l2.3 2.3 4.7-4.9" fill="none" stroke="${tone.ok}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  cross: svg(`<path d="M4.3 4.3l5.4 5.4M9.7 4.3l-5.4 5.4" stroke="${tone.fail}" stroke-width="1.5" stroke-linecap="round"/>`),
  denied: svg(`<circle cx="7" cy="7" r="4.6" fill="none" stroke="${tone.attn}" stroke-width="1.4"/><path d="M3.9 10.1l6.2-6.2" stroke="${tone.attn}" stroke-width="1.4" stroke-linecap="round"/>`),
  halt: svg(`<rect x="4" y="4" width="6" height="6" rx="1" fill="${tone.idle}"/>`),
  pending: svg(`<circle cx="7" cy="7" r="5" fill="none" stroke="${tone.idle}"/>`),
} as const

const dot = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">${body}</svg>`

/** The 8px dots of a request's way: a step seen, the step it stands at, one to come, one that failed. */
export const dots = {
  done: dot(`<circle cx="4" cy="4" r="3.5" fill="${tone.ok}"/>`),
  now: dot(`<circle cx="4" cy="4" r="3.5" fill="${tone.attn}"/>`),
  todo: dot(`<circle cx="4" cy="4" r="3" fill="none" stroke="${tone.idle}" stroke-width="1.2"/>`),
  bad: dot(`<circle cx="4" cy="4" r="3.5" fill="${tone.fail}"/>`),
} as const
