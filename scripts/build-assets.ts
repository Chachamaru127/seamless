#!/usr/bin/env node
// The published package runs from dist/ alone: src/ does not travel in the tarball (issue #42).
//
// `tsc -p tsconfig.build.json` emits against the repository root, so its JS lands in dist/src and dist/packages. This step
// finishes the layout:
//
//   dist/src/*                      -> dist/*                       the entry and adapters that `bin` and the hooks name
//   dist/packages/opencode-plugin/* -> packages/opencode-plugin/   src/adapters/opencode.ts imports the plugin as
//                                                                   ../../packages/opencode-plugin/index.js, the same
//                                                                   shape it has in the checkout
//   src/manifests/*                 -> dist/manifests/*             setup.ts and core/manifest.ts read them next to their
//                                                                   own module; `adapter` names the compiled .js file
import { chmod, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

// Every entry keeps the relative shape it has under src/, because the imports between them do not change.
async function lift(from: string, to: string): Promise<void> {
  try {
    await readdir(from);
  } catch {
    return; // already lifted (the build step ran twice without a fresh tsc)
  }
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    await rm(join(to, name), { recursive: true, force: true });
    await rename(join(from, name), join(to, name));
  }
  await rm(from, { recursive: true, force: true });
}

async function manifests(): Promise<void> {
  const to = join(dist, 'manifests');
  await rm(to, { recursive: true, force: true });
  // `antigravity.json` is a symlink to `phase2/antigravity.json`; the copy is made real so the rewrite stays in dist.
  await cp(join(root, 'src', 'manifests'), to, { recursive: true, dereference: true });
  for (const path of await readdir(to, { recursive: true })) {
    if (!path.endsWith('.json')) continue;
    const file = join(to, path);
    const value = JSON.parse(await readFile(file, 'utf8')) as { adapter?: unknown };
    if (typeof value.adapter !== 'string' || !value.adapter.endsWith('.ts')) continue;
    await writeFile(file, `${JSON.stringify({ ...value, adapter: `${value.adapter.slice(0, -3)}.js` }, null, 2)}\n`);
  }
}

await lift(join(dist, 'src'), dist);
await lift(join(dist, 'packages', 'opencode-plugin'), join(root, 'packages', 'opencode-plugin'));
await rm(join(dist, 'packages'), { recursive: true, force: true });
await manifests();
await chmod(join(dist, 'cli.js'), 0o755);
