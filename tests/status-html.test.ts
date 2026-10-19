import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderStatusHtml} from '../scripts/status-html.ts';

// Fixed text: the renderer must never carry a body into the reply T3 Code draws (AC15).
const BODY = '試験で固定した本文 8f4c1d';
const AT = '2026-10-19T12:00:00.000Z';
const stages = (...observed: string[]) => [
  { stage: 'accepted', status: observed.includes('accepted') ? 'observed' : 'unobserved', evidence: observed.includes('accepted') ? ['reservation:submitted'] : [], at: observed.includes('accepted') ? AT : null },
  { stage: 'reached', status: observed.includes('reached') ? 'observed' : 'unobserved', evidence: observed.includes('reached') ? ['uuid-1'] : [], at: observed.includes('reached') ? AT : null },
  { stage: 'processing', status: observed.includes('processing') ? 'observed' : 'unobserved', evidence: observed.includes('processing') ? ['uuid-2'] : [], at: observed.includes('processing') ? AT : null },
  { stage: 'replied', status: observed.includes('replied') ? 'observed' : 'unobserved', evidence: observed.includes('replied') ? ['uuid-3'] : [], at: observed.includes('replied') ? AT : null },
  { stage: 'unknown', status: observed.includes('unknown') ? 'observed' : 'unobserved', evidence: observed.includes('unknown') ? ['reservation:unknown'] : [], at: observed.includes('unknown') ? AT : null },
];
const record = (observed: string[], extra: Record<string, unknown> = {}) => ({
  status: 'ok', id: 'req-1', delivery: 'submitted',
  target: { provider: 'claude', nativeId: 'sess-10142', generation: '10142@1750000000000' },
  at: AT, stages: stages(...observed), ...extra,
});

test('the last observed stage is the only current one; reached is marked once and the other four are not', () => {
  const html = renderStatusHtml(record(['accepted', 'reached']));
  assert.equal(html.match(/data-stage="reached" data-current="true"/g)?.length, 1);
  assert.equal(html.match(/data-current="true"/g)?.length, 1);
  for (const stage of ['accepted', 'processing', 'replied', 'unknown']) {
    assert.equal(html.match(new RegExp(`data-stage="${stage}" data-current="false"`, 'g'))?.length, 1, stage);
  }
  // The stage names of the record and the display agree, and accepted/reached are drawn as observed.
  assert.equal(html.match(/data-stage="/g)?.length, 5);
  assert.equal(html.match(/data-status="observed"/g)?.length, 2);
  assert.match(html, /渡った/);
});

test('no body text and no evidence is drawn, even when the status JSON carries them', () => {
  const html = renderStatusHtml(record(['accepted', 'reached'], {
    text: BODY, body: BODY, message: { text: BODY },
    stages: stages('accepted', 'reached').map(s => ({ ...s, evidence: [...s.evidence, BODY], text: BODY })),
  }));
  assert.equal(html.includes(BODY), false);
  assert.equal(html.includes('uuid-1'), false);
  assert.equal(html.includes('試験で固定した本文'), false);
});

test('nothing observed leaves all five stages not current; delivered state and reason are drawn as codes', () => {
  const none = renderStatusHtml(record([]));
  assert.equal(none.match(/data-current="true"/g)?.length ?? 0, 0);
  assert.equal(none.match(/data-current="false"/g)?.length, 5);
  const held = renderStatusHtml(record(['accepted'], { state: 'held', reason: 'claude_hold' }));
  assert.match(held, /data-state="held"/);
  assert.match(held, /保留中/);
  assert.match(held, /claude_hold/);
  assert.equal(held.match(/data-stage="accepted" data-current="true"/g)?.length, 1);
});

test('ids are escaped and the page is self contained', () => {
  const html = renderStatusHtml(record(['accepted'], { id: 'x"><script>alert(1)</script>' }));
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /https?:|fetch\s*\(|XMLHttpRequest|innerHTML/);
});

test('the documented pipeline renders stdin from the command line', async () => {
  const script = fileURLToPath(new URL('../scripts/status-html.ts', import.meta.url));
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(record(['accepted', 'reached'])));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.match(/data-stage="reached" data-current="true"/g)?.length, 1);
  assert.equal(result.stdout.includes(BODY), false);
});
test('invalid JSON exits non-zero without writing a page', async () => {
  const script = fileURLToPath(new URL('../scripts/status-html.ts', import.meta.url));
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout, stderr }));
    child.stdin.end('not json');
  });
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /invalid_status_json/);
});
