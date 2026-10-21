// Draws the README images under docs/brand from the brand mark (specs/202610-brand/mark.svg) and the band's palette.
// Each file carries its own background, so it reads the same on GitHub's light and dark themes and on npm.
//   node scripts/build-brand.ts
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'brand');
const palette = {bg: '#141413', card: '#1d1d1b', card2: '#232321', line: '#2e2e2b', text: '#e9e7e2', meso: '#b5b2aa', idle: '#8d8b85', live: '#8070f0', ok: '#2f8f5b', attn: '#d9752b', fail: '#d64545', light: '#f0efee'};
const sans = 'SF Pro Text, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif';
const mono = 'SF Mono, Menlo, Consolas, Liberation Mono, monospace';

const markFile = await readFile(join(root, 'specs', '202610-brand', 'mark.svg'), 'utf8');
const inner = markFile.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const mark = (x: number, y: number, size: number, color: string) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 48 48" color="${color}">${inner}</svg>`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function markOnly(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" color="${color}">${inner}</svg>\n`;
}

function hero(): string {
  const w = 1200, h = 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="seamless">
<rect width="${w}" height="${h}" rx="18" fill="${palette.bg}"/>
${mark(96, 92, 120, palette.text)}
<text x="252" y="186" font-family="${sans}" font-size="96" font-weight="500" letter-spacing="13" fill="${palette.text}">seamless</text>
<text x="256" y="246" font-family="${sans}" font-size="26" fill="${palette.meso}">One message from the AI conversation you are in to the one next to it.</text>
<text x="256" y="282" font-family="${sans}" font-size="26" fill="${palette.meso}">Delivered through each product's own path. Verified from the other side.</text>
</svg>
`;
}

function terminal(): string {
  const w = 960, h = 472;
  const rows: Array<{stage: string; state: string; evidence: string; at: string; color: string}> = [
    {stage: 'accepted', state: 'observed', evidence: 'reservation written before the native write', at: '10:17:05', color: palette.ok},
    {stage: 'reached', state: 'observed', evidence: "read from the peer's own session record", at: '10:17:06', color: palette.ok},
    {stage: 'processing', state: 'observed', evidence: 'the peer started a turn on this request', at: '10:17:07', color: palette.ok},
    {stage: 'replied', state: 'observed', evidence: 'reply envelope carries replyTo = this id', at: '10:17:41', color: palette.ok},
    {stage: 'unknown', state: 'unobserved', evidence: 'nothing was lost between the stages', at: '', color: palette.idle},
  ];
  const line = (y: number, s: string, color = palette.text, size = 17) => `<text x="40" y="${y}" font-family="${mono}" font-size="${size}" fill="${color}" xml:space="preserve">${esc(s)}</text>`;
  let y = 96;
  const parts: string[] = [];
  parts.push(line(y, '$ seamless "run the failing test and tell me what you see"', palette.text)); y += 30;
  parts.push(line(y, '{"status":"ok","id":"req_8f2c","target":"codex:019a…","delivery":"submitted"}', palette.meso, 15)); y += 48;
  parts.push(line(y, '$ seamless status req_8f2c --wait 60', palette.text)); y += 38;
  for (const r of rows) {
    const dot = r.state === 'observed'
      ? `<circle cx="52" cy="${y - 6}" r="7" fill="${r.color}"/><path d="M48 ${y - 6} l3 3 l6 -6" stroke="${palette.bg}" stroke-width="2" fill="none"/>`
      : `<circle cx="52" cy="${y - 6}" r="6" fill="none" stroke="${r.color}" stroke-width="2"/>`;
    parts.push(dot);
    parts.push(`<text x="76" y="${y}" font-family="${mono}" font-size="17" fill="${palette.text}">${r.stage}</text>`);
    parts.push(`<text x="220" y="${y}" font-family="${mono}" font-size="17" fill="${r.color}">${r.state}</text>`);
    parts.push(`<text x="356" y="${y}" font-family="${mono}" font-size="15" fill="${palette.meso}">${esc(r.evidence)}</text>`);
    parts.push(`<text x="${w - 40}" y="${y}" text-anchor="end" font-family="${mono}" font-size="15" fill="${palette.idle}">${r.at}</text>`);
    y += 40;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="seamless status output, drawn as a trail of five stages">
<rect width="${w}" height="${h}" rx="14" fill="${palette.card}"/>
<rect width="${w}" height="52" rx="14" fill="${palette.card2}"/><rect y="38" width="${w}" height="14" fill="${palette.card2}"/>
<line x1="0" y1="52" x2="${w}" y2="52" stroke="${palette.line}"/>
${mark(22, 15, 22, palette.meso)}
<text x="54" y="33" font-family="${sans}" font-size="15" font-weight="500" letter-spacing="2" fill="${palette.meso}">seamless</text>
<text x="${w - 24}" y="33" text-anchor="end" font-family="${sans}" font-size="13" fill="${palette.idle}">Claude Code → Codex, same workspace</text>
${parts.join('\n')}
<line x1="40" y1="${y - 12}" x2="${w - 40}" y2="${y - 12}" stroke="${palette.line}"/>
<text x="40" y="${y + 18}" font-family="${sans}" font-size="14" fill="${palette.idle}">Every stage is observed or unobserved, with the evidence that showed it. The sender never writes "reached" about itself.</text>
</svg>
`;
}

await mkdir(out, {recursive: true});
await writeFile(join(out, 'mark-light.svg'), markOnly(palette.text));
await writeFile(join(out, 'mark-dark.svg'), markOnly(palette.bg));
await writeFile(join(out, 'hero.svg'), hero());
await writeFile(join(out, 'terminal.svg'), terminal());
console.log('brand: wrote docs/brand/{mark-light,mark-dark,hero,terminal}.svg');
