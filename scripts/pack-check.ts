#!/usr/bin/env node
// T13: every file in the published set must be runnable from the tarball alone. A relative import that points at a file
// `npm pack` leaves out makes the package break only after publishing, so this check fails on it here.
// The published set is what `npm pack --dry-run --json` lists (package.json "files"), not the repository.
//
// Issue #42 moved the published entry to the build: when the set carries `dist/`, its `.js` files and the modules the
// manifests name are the ones that must close inside the tarball. Without a build (a source-only copy of the repository)
// the earlier check on the shipped `.ts` files still applies.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = posix.dirname(posix.dirname(fileURLToPath(import.meta.url)));

function packedFiles(): string[] {
  let output: string;
  try {
    output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    console.error('pack-check: 失敗（npm pack --dry-run --json を実行できない）');
    process.exit(1);
  }
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error('pack-check: 失敗（同梱物の一覧が空）');
    process.exit(1);
  }
  const files = (parsed[0] as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    console.error('pack-check: 失敗（同梱物の一覧の形が違う）');
    process.exit(1);
  }
  return files.flatMap(entry => {
    const path = (entry as { path?: unknown }).path;
    return typeof path === 'string' ? [path] : [];
  });
}

/** Quoted specifiers after `from`, a bare `import`, or a dynamic `import(`. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** The file a relative specifier names: the path as written, or with the extensions and index files Node's loader tries. */
function resolveInside(file: string, specifier: string, packed: Set<string>): string | null {
  const base = posix.normalize(posix.join(posix.dirname(file), specifier));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`];
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts');
  return candidates.find(candidate => packed.has(candidate)) ?? null;
}

function read(file: string): string {
  try {
    return readFileSync(posix.join(root, file), 'utf8');
  } catch {
    console.error(`pack-check: 失敗（同梱物を読めない: ${file}）`);
    process.exit(1);
  }
}

const files = packedFiles();
const packed = new Set(files);
const missing: string[] = [];
let checked = 0;

if (files.some(path => path.startsWith('dist/'))) {
  // The bin target and the two hook scripts the tarball ships; a hook whose compiled file is absent would exit silently.
  for (const entry of ['dist/cli.js', 'dist/adapters/cursor.js', 'dist/grok-hook.js']) {
    if (!packed.has(entry)) missing.push(`${entry}（同梱物に無い）`);
  }
  for (const file of files.filter(path => path.startsWith('dist/') && path.endsWith('.js'))) {
    for (const specifier of specifiers(read(file))) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
      checked++;
      if (resolveInside(file, specifier, packed) === null) missing.push(`${file} -> ${specifier}`);
    }
  }
  // A manifest is a path as data: its adapter module must also be in the same tarball (src/ is no longer shipped). The
  // phase2/ declaration is read by the antigravity adapter and is not registered as a module (its `adapter` field is not
  // loaded), so only the registered manifests are resolved here.
  for (const file of files.filter(path => /^dist\/manifests\/[^/]+\.json$/.test(path))) {
    const adapter = (JSON.parse(read(file)) as { adapter?: unknown }).adapter;
    if (typeof adapter !== 'string' || (!adapter.startsWith('./') && !adapter.startsWith('../'))) continue;
    checked++;
    if (resolveInside(file, adapter, packed) === null) missing.push(`${file} -> ${adapter}`);
  }
} else {
  for (const file of files.filter(path => path.endsWith('.ts'))) {
    for (const specifier of specifiers(read(file))) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
      checked++;
      if (resolveInside(file, specifier, packed) === null) missing.push(`${file} -> ${specifier}`);
    }
  }
}

if (missing.length > 0) {
  for (const line of missing) console.error(`pack-check: 同梱物の外を指す: ${line}`);
  console.error(`pack-check: 失敗（${missing.length} 件）`);
  process.exit(1);
}
console.log(`pack-check: ok（${files.length} ファイル、相対参照 ${checked} 件が同梱物の中）`);
