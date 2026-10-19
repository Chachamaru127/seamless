#!/usr/bin/env node
// T13: every file in the published set must be runnable from the tarball alone. A relative import that points at a file
// `npm pack` leaves out makes the package break only after publishing, so this check fails on it here.
// The published set is what `npm pack --dry-run --json` lists (package.json "files"), not the repository.
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
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`, `${base}/index.ts`, `${base}/index.tsx`];
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts');
  return candidates.find(candidate => packed.has(candidate)) ?? null;
}

const files = packedFiles();
const packed = new Set(files);
let imports = 0;
const missing: string[] = [];
for (const file of files.filter(path => path.endsWith('.ts'))) {
  let source: string;
  try {
    source = readFileSync(posix.join(root, file), 'utf8');
  } catch {
    console.error(`pack-check: 失敗（同梱物を読めない: ${file}）`);
    process.exit(1);
  }
  for (const specifier of specifiers(source)) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    imports++;
    if (resolveInside(file, specifier, packed) === null) missing.push(`${file} -> ${specifier}`);
  }
}
if (missing.length > 0) {
  for (const line of missing) console.error(`pack-check: 同梱物の外を import: ${line}`);
  console.error(`pack-check: 失敗（${missing.length} 件）`);
  process.exit(1);
}
console.log(`pack-check: ok（${files.length} ファイル、相対 import ${imports} 件が同梱物の中）`);
