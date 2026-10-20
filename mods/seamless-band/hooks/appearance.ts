// Single-color marks from the agreed 2026-10-03 Claude band mockup.
export const palette = {
  background: '#1d1d1b', text: '#e9e7e2', meso: '#b5b2aa', muted: '#8d8b85', active: '#8070f0',
  green: '#38c68e', orange: '#f9a437', red: '#fe3a52', badge: '#2a2a27', divider: '#2e2e2b',
} as const

/**
 * The agreed brand mark (specs/202610-brand/mark.svg, 2026-10-20): a lower-case
 * s drawn in one unbroken stroke. Its group and path, fill="currentColor"
 * included, are the file's own, untouched.
 */
export const brandMark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g transform="translate(4.994 2.000) scale(0.039391) translate(-44 1184) scale(.1 -.1)" fill="currentColor"><path d="M9640 11800 c-47 -21 -96 -43 -110 -50 -14 -6 -65 -27 -115 -47 -49 -19 -94 -39 -100 -43 -5 -4 -26 -13 -45 -18 -19 -6 -66 -22 -105 -37 -38 -14 -88 -33 -110 -40 -22 -8 -71 -26 -110 -40 -38 -15 -86 -31 -105 -36 -19 -5 -51 -16 -70 -23 -19 -8 -73 -26 -120 -40 -47 -15 -128 -40 -180 -57 -96 -31 -142 -44 -375 -104 -71 -18 -184 -48 -250 -65 -66 -17 -147 -38 -180 -45 -33 -8 -112 -26 -175 -40 -63 -14 -151 -33 -195 -42 -44 -8 -109 -21 -145 -28 -36 -7 -101 -20 -145 -28 -44 -9 -134 -25 -200 -37 -66 -11 -151 -27 -190 -35 -38 -8 -104 -20 -145 -25 -41 -6 -110 -17 -152 -25 -151 -29 -233 -44 -278 -50 -81 -11 -447 -77 -555 -100 -38 -8 -103 -20 -144 -25 -136 -19 -551 -105 -701 -145 -30 -9 -73 -20 -95 -25 -55 -13 -164 -44 -265 -75 -47 -15 -107 -33 -135 -40 -356 -99 -888 -322 -1280 -538 -998 -548 -1759 -1345 -2078 -2177 -388 -1010 -188 -2054 533 -2781 540 -545 1152 -806 2155 -921 200 -23 756 -17 985 10 847 100 1325 300 1640 687 49 60 69 90 120 175 87 146 116 360 71 521 -71 255 -254 392 -521 393 -165 0 -228 -27 -465 -196 -114 -82 -226 -153 -289 -182 -112 -52 -143 -66 -152 -66 -5 0 -31 -9 -59 -19 -322 -124 -805 -155 -1170 -75 -1154 253 -1648 1245 -1103 2218 355 633 1181 1240 2118 1555 240 81 447 145 540 166 30 7 109 27 175 44 252 64 416 101 595 135 1190 225 1469 300 1872 502 609 305 1229 909 1794 1746 152 225 152 230 14 168z M6725 7794 c-397 -19 -985 -134 -1375 -269 -58 -20 -123 -42 -145 -50 -128 -43 -408 -183 -528 -263 -503 -337 -669 -894 -358 -1202 227 -226 506 -219 836 19 186 135 292 198 467 280 561 263 1378 294 1903 71 678 -287 995 -878 809 -1507 -190 -643 -893 -1266 -1806 -1602 -32 -11 -82 -30 -110 -40 -235 -86 -757 -222 -1073 -280 -242 -44 -332 -60 -380 -66 -27 -4 -86 -13 -130 -21 -84 -14 -227 -35 -410 -59 -60 -8 -195 -26 -300 -40 -104 -14 -243 -32 -308 -40 -205 -25 -576 -81 -732 -110 -410 -78 -608 -130 -762 -200 -17 -8 -34 -15 -37 -15 -15 0 -251 -121 -346 -178 -408 -244 -1018 -832 -1335 -1287 -53 -76 -88 -126 -135 -194 -33 -45 -33 -78 -2 -66 34 13 430 134 552 169 544 152 1295 310 1955 410 273 42 1092 149 1340 175 174 19 311 36 540 66 61 8 211 26 335 40 124 15 302 38 395 52 358 53 411 61 435 67 14 4 66 13 115 21 148 23 276 50 510 109 137 34 244 63 280 74 17 6 71 23 120 37 50 15 126 40 171 55 146 51 324 120 454 178 25 11 77 34 115 50 104 46 334 165 430 223 17 10 46 28 65 39 19 11 49 29 65 40 17 11 43 27 59 36 34 19 92 59 221 153 587 426 976 898 1235 1496 336 774 302 1607 -94 2305 -14 25 -34 61 -45 80 -65 117 -285 376 -420 492 -646 558 -1484 803 -2576 752z"/></g></svg>'

/** The lockup's height, the mark's size, the gap after it (half the mark's width), and the drawing's width. */
export const BRAND_LOCKUP = { height: 22, mark: 14, gap: 7, width: 90 } as const

/**
 * The brand lockup at the band's left end: the 14px mark, 7px (half the mark's
 * width), then the wordmark "seamless" in the system font, 12px, weight 500,
 * its letters 0.14em apart. All of it sits inside 22px.
 *
 * The mark keeps the file's currentColor, made the palette's meso here: one
 * quiet tone, never a state's. The wordmark takes the same tone, because an Svg
 * cannot follow the app's theme keys and #e9e7e2 disappears on the light card.
 */
export function brandLockup(markColor: string = palette.meso, wordColor: string = palette.meso): string {
  // The file's own svg is nested at 14px: only where it sits is added to it.
  const mark = brandMark.replace('<svg ', `<svg x="0" y="${(BRAND_LOCKUP.height - BRAND_LOCKUP.mark) / 2}" width="${BRAND_LOCKUP.mark}" height="${BRAND_LOCKUP.mark}" color="${markColor}" `)
  const word = `<text x="${BRAND_LOCKUP.mark + BRAND_LOCKUP.gap}" y="14.5" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text','Hiragino Sans',Helvetica,Arial,sans-serif" font-size="12" font-weight="500" letter-spacing="0.14em" fill="${wordColor}">seamless</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BRAND_LOCKUP.width}" height="${BRAND_LOCKUP.height}" viewBox="0 0 ${BRAND_LOCKUP.width} ${BRAND_LOCKUP.height}">${mark}${word}</svg>`
}

export function logoSvg(provider: 'codex' | 'claude' | 'grok', color: string): string {
  const source = provider === 'grok' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8"/><path d="M6 18 18 6"/></svg>' : provider === 'codex' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3.2a4.4 4.4 0 0 1 4.3 3.4 4.4 4.4 0 0 1 3.9 6.3 4.4 4.4 0 0 1-3.6 7.3 4.4 4.4 0 0 1-7.3.6 4.4 4.4 0 0 1-5.4-5 4.4 4.4 0 0 1 1.3-7.6A4.4 4.4 0 0 1 12 3.2z"/><circle cx="12" cy="12" r="2.6"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.8 4h3.1l6 16h-3.1zM7.1 4h3.3l6 16h-3.2l-1.3-3.5H5.6L4.3 20H1.1zm-.5 9.7h4.3L8.7 7.9z"/></svg>'
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
const BRAND = { codex: '#10a37f', claude: '#d97757', grok: '#5b5b58' } as const
export function brandSvg(provider: 'codex' | 'claude' | 'grok'): string {
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

// The fourth band (design-v4, 2026-10-07) names a peer by its conversation,
// not its company: a grey monogram stands for the company, and colour is
// kept for the state of an exchange alone.

/**
 * The company's monogram: two letters in a grey disc, the same tone for both
 * companies. The disc is the idle grey: 3.4:1 on the light card, 5:1 on the
 * dark one, and the dark letters read at 4.9:1 on it (checked 2026-10-07).
 */
export function avatarSvg(provider: 'codex' | 'claude' | 'grok', size: 14 | 24 = 14): string {
  const word = provider === 'codex' ? 'Cx' : provider === 'grok' ? 'Gk' : 'Cl'
  const font = size === 24 ? 10 : 6.5
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${tone.idle}"/><text x="50%" y="50%" dy=".36em" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,Arial,sans-serif" font-size="${font}" font-weight="700" fill="#1d1d1b">${word}</text></svg>`
}

/** A request's way as four dots joined by bars, in the state colours: one small drawing for the closed band. */
export function trackSvg(states: readonly ('done' | 'now' | 'todo' | 'bad')[]): string {
  const step = 11, r = 3.2, w = step * (states.length - 1) + 8
  const fill = { done: tone.ok, now: tone.attn, bad: tone.fail, todo: 'none' } as const
  const parts = states.map((state, i) => {
    const cx = 4 + i * step
    // The bar into a dot takes that dot's standing: grey up to a step not yet reached, as the open band draws it.
    const bar = i === 0 ? '' : `<line x1="${cx - step + r}" y1="4" x2="${cx - r}" y2="4" stroke="${state === 'todo' ? tone.idle : tone.ok}" stroke-width="1"/>`
    const dot = state === 'todo' ? `<circle cx="${cx}" cy="4" r="${r - 0.6}" fill="none" stroke="${tone.idle}" stroke-width="1.2"/>` : `<circle cx="${cx}" cy="4" r="${r}" fill="${fill[state]}"/>`
    return bar + dot
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 8">${parts.join('')}</svg>`
}
