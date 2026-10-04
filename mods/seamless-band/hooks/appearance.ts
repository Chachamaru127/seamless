// Single-color marks from the agreed 2026-10-03 Claude band mockup.
export const palette = {
  background: '#1d1d1b', text: '#e9e7e2', muted: '#8d8b85', active: '#8070f0',
  green: '#38c68e', orange: '#f9a437', red: '#fe3a52', badge: '#2a2a27', divider: '#2e2e2b',
} as const
export function logoSvg(provider: 'codex' | 'claude', color: string): string {
  const source = provider === 'codex' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3.2a4.4 4.4 0 0 1 4.3 3.4 4.4 4.4 0 0 1 3.9 6.3 4.4 4.4 0 0 1-3.6 7.3 4.4 4.4 0 0 1-7.3.6 4.4 4.4 0 0 1-5.4-5 4.4 4.4 0 0 1 1.3-7.6A4.4 4.4 0 0 1 12 3.2z"/><circle cx="12" cy="12" r="2.6"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.8 4h3.1l6 16h-3.1zM7.1 4h3.3l6 16h-3.2l-1.3-3.5H5.6L4.3 20H1.1zm-.5 9.7h4.3L8.7 7.9z"/></svg>'
  return source.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replaceAll('currentColor', color)
}
