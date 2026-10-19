// The state colours of the exchanges, kept in the published set so `status-exchanges.ts` imports nothing from `mods/`
// (Plans 1 章 5: the band mod stays internal). Same values as mods/seamless-band/hooks/appearance.ts.
export const palette = {
  background: '#1d1d1b', text: '#e9e7e2', muted: '#8d8b85', active: '#8070f0',
  green: '#38c68e', orange: '#f9a437', red: '#fe3a52', badge: '#2a2a27', divider: '#2e2e2b',
} as const
