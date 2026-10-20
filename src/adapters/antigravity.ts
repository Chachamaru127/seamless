import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Antigravity CLI is a phase 2 product (spec.md S5): T3 Code starts it from ~/.t3-ja/tools/antigravity-acp/, and no
// official port for finding a conversation or injecting a request was confirmed. Until one is confirmed the product is
// only detected: doctor reports the executable and the hooks, and this adapter lists the product as `unverified` when
// the executable exists. Without an executable there is nothing to list.
//
// The declaration is src/manifests/antigravity.json. The core manifest loader (src/core/manifest.ts) does not know the
// antigravity provider, so a phase 2 product cannot be registered there yet; the file is kept
// outside that registry (src/manifests/phase2/) and is read by this adapter instead. When the provider set grows, the
// same data moves into the core registry without changing what this adapter lists.
export const ANTIGRAVITY_MANIFEST_PATH = fileURLToPath(new URL('../manifests/antigravity.json', import.meta.url));
export const ANTIGRAVITY_STATUS = 'unverified' as const;
export const MAX_MANIFEST_BYTES = 65_536;

export type AntigravityManifest = {
  schemaVersion: 1;
  phase: 2;
  product: 'antigravity';
  provider: 'antigravity';
  displayName: string;
  status: typeof ANTIGRAVITY_STATUS;
  adapter: string;
  discovery: {kind: 'hook'; source: string};
  write: {channel: 'inbox_file'; target: string};
  operations: ['read'];
  install: {hook: null; steps: string[]};
};

export type AntigravityDoctorView = {binary: string|null; hooks: boolean};
// What a listing row says: the executable doctor found, and nothing beyond `unverified` (S5 forbids claiming a state
// the product cannot prove). `versionStatus` uses the word the rest of the listing uses for an unconfirmed version.
export type AntigravityListing = {
  id: 'antigravity';
  product: 'antigravity';
  provider: 'antigravity';
  displayName: string;
  status: typeof ANTIGRAVITY_STATUS;
  versionStatus: typeof ANTIGRAVITY_STATUS;
  binary: string;
  hooks: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max: number): string|null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value ? value : null;
}
function invalid(): never {
  throw new Error('manifest_invalid');
}

// The declaration is data, not permission. Three rules are enforced so a later edit cannot widen it by accident:
// the product stays phase 2, it may only be read (no send while S5 is open), and it names no hook file it does not ship.
export function parseAntigravityManifest(value: unknown): AntigravityManifest {
  if (!isRecord(value)) invalid();
  if (value.schemaVersion !== 1 || value.phase !== 2) invalid();
  if (value.product !== 'antigravity' || value.provider !== 'antigravity') invalid();
  if (value.status !== ANTIGRAVITY_STATUS) invalid();
  // The declaration names the compiled adapter as well, because the published package carries dist/, not src/ (issue #42).
  if (value.adapter !== '../adapters/antigravity.ts' && value.adapter !== '../adapters/antigravity.js') invalid();
  const displayName = text(value.displayName, 80);
  if (!displayName) invalid();
  const discovery = value.discovery, write = value.write, permissions = value.permissions, install = value.install;
  if (!isRecord(discovery) || discovery.kind !== 'hook') invalid();
  const source = text(discovery.source, 256);
  if (!source) invalid();
  if (!isRecord(write) || write.channel !== 'inbox_file') invalid();
  const target = text(write.target, 256);
  if (!target) invalid();
  const operations = isRecord(permissions) ? permissions.operations : null;
  if (!Array.isArray(operations) || operations.length !== 1 || operations[0] !== 'read') invalid();
  if (!isRecord(permissions) || permissions.approvalMark !== 'limits.markUnapproved') invalid();
  if (!isRecord(install) || install.hook !== null) invalid();
  const steps = install.steps;
  if (!Array.isArray(steps) || steps.length !== 1 || steps[0] !== 'node src/cli.ts setup') invalid();
  return {
    schemaVersion: 1,
    phase: 2,
    product: 'antigravity',
    provider: 'antigravity',
    displayName,
    status: ANTIGRAVITY_STATUS,
    adapter: value.adapter,
    discovery: {kind: 'hook', source},
    write: {channel: 'inbox_file', target},
    operations: ['read'],
    install: {hook: null, steps: ['node src/cli.ts setup']},
  };
}

export async function readAntigravityManifest(path = ANTIGRAVITY_MANIFEST_PATH): Promise<AntigravityManifest> {
  const raw = await readFile(path, 'utf8');
  if (raw.length > MAX_MANIFEST_BYTES) invalid();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid();
  }
  return parseAntigravityManifest(value);
}

// `doctor --json` already answers "is the executable there, and are hooks wired"; the listing only decides whether that
// answer becomes a row. The executable may be on PATH or under T3 Code's ~/.t3-ja/tools/antigravity-acp/ (S5), and
// doctor checks both. Hooks are reported with the row, not required for it: a missing hook is a reason the product
// stays phase 2, not a reason to hide an executable that is present.
export function listAntigravity(doctor: AntigravityDoctorView, manifest: AntigravityManifest): AntigravityListing[] {
  if (!doctor.binary) return [];
  return [{
    id: 'antigravity',
    product: 'antigravity',
    provider: 'antigravity',
    displayName: manifest.displayName,
    status: ANTIGRAVITY_STATUS,
    versionStatus: ANTIGRAVITY_STATUS,
    binary: doctor.binary,
    hooks: doctor.hooks,
  }];
}
