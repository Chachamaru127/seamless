import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { BRAND_LOCKUP, brandLockup, brandMark, palette, tone } from '../hooks/appearance'

const BAND = {
  plugin: 'seamless-band',
  surface: 'desktop',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

/** The engine's own band, which draws nothing here. */
function seat(on: On) {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

const STATE_COLORS = [tone.live, tone.ok, tone.attn, tone.fail, palette.active, palette.green, palette.orange, palette.red]

test('the brand mark is the agreed drawing in one colour, never a state colour', () => {
  expect(brandMark).toContain('viewBox="0 0 48 48"')
  expect(brandMark).toContain('fill="currentColor"')
  for (const state of STATE_COLORS) expect(brandMark).not.toContain(state)
})

test('the lockup holds the 14px mark, 7px after it, and the wordmark inside 22px', () => {
  const lockup = brandLockup()
  expect(lockup).toContain('height="22"')
  expect(lockup).toContain('viewBox="0 0 48 48"')
  expect(lockup).toContain('width="14" height="14"')
  expect(lockup).toContain(`color="${palette.meso}"`)
  expect(BRAND_LOCKUP.gap).toBe(BRAND_LOCKUP.mark / 2)
  expect(lockup).toContain(`x="${BRAND_LOCKUP.mark + BRAND_LOCKUP.gap}"`)
  expect(lockup).toContain('font-size="12"')
  expect(lockup).toContain('font-weight="500"')
  expect(lockup).toContain('letter-spacing="0.14em"')
  expect(lockup).toContain('>seamless</text>')
  // One quiet tone for the whole lockup: an Svg cannot follow the app's theme keys, so a
  // theme-only text colour would vanish on the light card.
  expect(lockup).toContain(`fill="${palette.meso}">seamless</text>`)
  expect(new Set(lockup.match(/#[0-9a-f]{6}/g))).toEqual(new Set([palette.meso]))
  // The 22px is a bound, not just an attribute: the mark and the wordmark's line sit inside it.
  const placed = new RegExp(`<svg x="0" y="([\\d.]+)" width="${BRAND_LOCKUP.mark}" height="${BRAND_LOCKUP.mark}"`).exec(lockup)
  expect(placed).not.toBeNull()
  const top = Number(placed?.[1])
  expect(top).toBeGreaterThanOrEqual(0)
  expect(top + BRAND_LOCKUP.mark).toBeLessThanOrEqual(BRAND_LOCKUP.height)
  const baseline = Number(new RegExp(`<text x="${BRAND_LOCKUP.mark + BRAND_LOCKUP.gap}" y="([\\d.]+)"`).exec(lockup)?.[1])
  expect(baseline).toBeLessThanOrEqual(BRAND_LOCKUP.height)
  expect(baseline - 12 * 0.8).toBeGreaterThanOrEqual(0)
  // No class carries a state's paint: the one colour is the mark's own.
  expect(lockup).not.toContain('class=')
  for (const state of STATE_COLORS) expect(lockup).not.toContain(state)
})

test('the desktop band opens at its left end with the brand lockup, the state mark keeping its colour', async ($, on) => {
  seat(on)
  const ui = await $.ui.mount(BAND)
  const activity = await ui.find({ key: 'activity' })
  const brand = await ui.find({ key: 'brand' })
  const drawn = brand?.children[0] as { type: string; props: Record<string, unknown> }
  // The brand box is the row's first child; an Svg keeps no key of its own in the kit, so the row is read by type.
  expect((activity?.children[0] as { props?: { key?: string } })?.props?.key).toBe('brand')
  expect(drawn.type).toBe('Svg')
  expect(drawn.props).toMatchObject({ width: BRAND_LOCKUP.width, height: 22, alt: 'seamless' })
  expect(drawn.props.source).toContain('viewBox="0 0 48 48"')
  expect(drawn.props.source).toContain(`color="${palette.meso}"`)
  expect(drawn.props.source).toContain('>seamless</text>')
  for (const state of STATE_COLORS) expect(drawn.props.source).not.toContain(state)
  const stateMark = activity?.children.find(child => (child as { type?: string }).type === 'Svg') as { props: Record<string, unknown> } | undefined
  expect(stateMark?.props.source).toContain(tone.idle)
})
